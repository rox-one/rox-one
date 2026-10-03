import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom, focusedPanelRouteAtom } from '@/atoms/panel-stack'
import { useNavigation } from '@/contexts/NavigationContext'
import { useModalRegistry } from '@/context/ModalContext'
import { useDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import * as storage from '@/lib/local-storage'
import type { CapabilityId, CapabilitySnapshot, EngineSnapshot, Phase, RuntimeState, SafeReason, TourBinding, TourDefinition, TourEffect, TourId, TourInput, TourProgress, TourScope, TourTargetRegistration, WindowLease } from '../contracts'
import { initialRuntimeState, transition } from '../core'
import { productTourCatalogue } from '../catalogue'
import { createTargetRegistry, SpotlightOverlay, TourErrorBoundary } from '../ui'
import { createProgressRepository, createLeaseRepository, createLearningProfileRepository, createLearningScopeKey, LearningLeaseLostError, type LearningPreferences } from '../persistence'
import { createLearningDiagnosticsRepository, type LearningEventName } from '../analytics'
import { clearChatObservations } from '../adapters/chat'
import { TourRuntimeContext, TourPanelScope, type TourRuntimePort } from './hooks'
import { subscribeTourSignals } from './bridge'
import { clearCollectionViewChanges, hasCollectionViewChange } from './collection-view-observation'
import { navigationEntity, prerequisiteRoute, resolveTourRoute } from './routes'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'

const INACTIVE: readonly Phase[] = ['idle', 'paused', 'blocked', 'finished']
const READY = { state: 'ready' } as const
const UNAVAILABLE = { state: 'unavailable', reason: 'api-unavailable' } as const
export interface LearningController {
  enabled: boolean
  ready: boolean
  setEnabled(value: boolean): void
  state: RuntimeState
  progress: Readonly<Partial<Record<TourId, TourProgress>>>
  preferences: LearningPreferences
  setPreferences(value: Partial<LearningPreferences>): Promise<void>
  storageStatus: 'saved' | 'memory-only' | 'failed'
  pendingTour: TourId | null
  start(id: TourId, mode?: 'new' | 'resume' | 'replay'): Promise<void>
  pause(reason?: SafeReason): void
  reset(): Promise<void>
  capabilities: CapabilitySnapshot
}
const LearningContext = createContext<LearningController | null>(null)
const TourPresentationContext = createContext<ReactNode>(null)
export function useProductLearning() { return useContext(LearningContext) }

function baseCapabilities(shellReady: boolean, binding: TourScope): CapabilitySnapshot {
  const api = window.electronAPI
  const available = (method: unknown) => typeof method === 'function' ? READY : UNAVAILABLE
  return {
    'shell.ready': shellReady ? READY : { state: 'pending', reason: 'api-unavailable' },
    'sessions.available': available(api?.getSessionMessages),
    'attachments.available': available(api?.storeAttachment),
    'filesystem.selector': available(api?.openFolderDialog),
    'agent-center.available': available(api?.getSessions),
    'projects.available': available(api?.getProjects),
    'personal-tasks.available': available(api?.personalTasksPut),
    'task.delegation-available': available(api?.createSession),
    'notes.available': available(api?.listNotes),
    'memory.available': available(api?.listMemoryLessons),
    'memory.write-available': available(api?.addMemoryLesson),
    'pages.available': available(api?.getPages),
    'pages.entity-present': binding.entityId ? READY : { state: 'pending', reason: 'missing-entity' },
    'search.available': available(api?.searchNotes),
    'sources.list': available(api?.getSources),
    'sources.ready': { state: 'pending', reason: 'not-connected' },
    'skills.available': available(api?.getSkills),
    'inbox.available': available(api?.getSessions),
    'feed.available': available(api?.feedList),
    'meetings.available': available(api?.listMeetings),
    'meeting.artifact-present': { state: 'pending', reason: 'missing-entity' },
    'automations.available': available(api?.getAutomations),
    'automation.entity-present': binding.entityId ? READY : { state: 'pending', reason: 'missing-entity' },
    'connection-fabric.available': available(api?.workgraph?.listConnections),
    'labels.available': available(api?.listLabels),
    'permissions.pending': { state: 'pending', reason: 'missing-entity' },
    'voice.available': { state: 'pending', reason: 'api-unavailable' },
  }
}

export function ProductTourProvider({ children, workspaceId, shellReady, welcomeSessionId }: { children: ReactNode; workspaceId: string | null; shellReady: boolean; welcomeSessionId?: string | null }) {
  const { t } = useTranslation()
  const nav = useNavigation()
  const panelId = useAtomValue(focusedPanelIdAtom) ?? 'shell'
  const panelRoute = useAtomValue(focusedPanelRouteAtom)
  const modal = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  const [enabled, updateEnabled] = useState(() => storage.get(storage.KEYS.featureProductTourV1, false))
  const [state, updateState] = useState<RuntimeState>(initialRuntimeState)
  const stateRef = useRef(state)
  const observationOwner = useRef<object>({})
  const context = { workspaceId: workspaceId ?? '', panelId, ...navigationEntity(nav.navigationState) }
  const contextRef = useRef(context); contextRef.current = context
  const navRef = useRef(nav); navRef.current = nav
  const enabledRef = useRef(enabled); enabledRef.current = enabled
  const [progress, setProgress] = useState<Partial<Record<TourId, TourProgress>>>({})
  const [preferences, updatePreferences] = useState<LearningPreferences>({ invitationsEnabled: false, diagnosticsEnabled: false })
  const preferencesRef = useRef(preferences); preferencesRef.current = preferences
  const [storageStatus, setStorageStatus] = useState<'saved' | 'memory-only' | 'failed'>('saved')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [pendingTour, setPendingTour] = useState<TourId | null>(null)
  const [launchReason, setLaunchReason] = useState<SafeReason | null>(null)
  const pendingMode = useRef<'new' | 'resume' | 'replay'>('new')
  const [target, setTarget] = useState<TourTargetRegistration | null>(null)
  const [capRevision, setCapRevision] = useState(0)
  const capabilityRecords = useRef(new Map<string, { token: object; value: CapabilitySnapshot[CapabilityId]; projects?: Map<object, NonNullable<CapabilitySnapshot[CapabilityId]>> }>())
  const repositories = useMemo(() => enabled ? {
    progress: createProgressRepository(), lease: createLeaseRepository({ allowMemoryOnlyLease: true }), profile: createLearningProfileRepository(), diagnostics: createLearningDiagnosticsRepository(),
  } : null, [enabled])
  const profileRef = useRef<string | null>(null); profileRef.current = profileId
  const leaseRef = useRef<WindowLease | null>(null)
  const progressWrites = useRef(new Set<Promise<unknown>>())
  const leaseReleaseBarrier = useRef<Promise<void>>(Promise.resolve())
  const leaseAcquisitionBarrier = useRef<Promise<void>>(Promise.resolve())
  const ownerWindowId = useRef(crypto.randomUUID())
  const lifetime = useRef(0)
  const launchSequence = useRef(0)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tourNavigation = useRef(false)
  const navigationAnchor = useRef<{ runToken: string; navigator: string } | null>(null)
  const [layerRevision, setLayerRevision] = useState(0)
  const [foreground, setForeground] = useState(true)
  const foregroundRef = useRef(foreground); foregroundRef.current = foreground
  const activeScope = state.attempt?.binding ?? context
  const capabilityWorkspace = activeScope.workspaceId
  const capabilityPanel = activeScope.panelId
  const capabilityEntity = activeScope.entityId
  const capabilities = useMemo<CapabilitySnapshot>(() => {
    const values = { ...baseCapabilities(shellReady, { workspaceId: capabilityWorkspace, panelId: capabilityPanel, entityId: capabilityEntity }) }
    for (const [key, record] of capabilityRecords.current) {
      const [ws, panel, id] = JSON.parse(key) as [string, string, CapabilityId]
      if (ws !== capabilityWorkspace || panel !== capabilityPanel) continue
      // A successful list read cannot mask a failed detail read or absent writer.
      // Keep the existing single-producer policy for every other capability.
      const contributions = record.projects ? [...record.projects.values()] : null
      values[id] = contributions
        ? contributions.find(value => value.state === 'denied' || value.state === 'unavailable')
          ?? contributions.find(value => value.state === 'pending') ?? contributions[0] ?? record.value
        : record.value
    }
    return values
  }, [shellReady, capabilityWorkspace, capabilityPanel, capabilityEntity, capRevision])
  const snapshotRef = useRef<EngineSnapshot | null>(null)
  const registry = useMemo(() => createTargetRegistry({ getTargetScope: id => {
    const current = stateRef.current
    return current.definition?.steps.find(item => item.id === current.attempt?.stepId && item.target === id)?.scope ?? 'bound-panel'
  } }), [])
  const cancelTimeout = useCallback(() => { if (timeout.current) clearTimeout(timeout.current); timeout.current = null }, [])
  const releaseLease = useCallback(() => {
    const lease = leaseRef.current; leaseRef.current = null
    const profile = profileRef.current
    if (lease && profile && repositories) {
      // Accepted writes commit before release; a new attempt waits for this barrier.
      leaseReleaseBarrier.current = Promise.allSettled([...progressWrites.current]).then(() => repositories.lease.release(profile, lease)).catch(() => {})
    }
  }, [repositories])
  const acquireLease = useCallback((profile: string, isCurrent: () => boolean) => {
    // Serialize ownership changes so a cancelled request cannot release a later request's fence.
    const acquiring = leaseAcquisitionBarrier.current.then(async () => {
      await leaseReleaseBarrier.current
      if (!repositories || !isCurrent()) return null
      const lease = await repositories.lease.acquire(profile, ownerWindowId.current, Date.now())
      if (lease && !isCurrent()) { await repositories.lease.release(profile, lease); return null }
      return lease
    })
    leaseAcquisitionBarrier.current = acquiring.then(() => {}, () => {})
    return acquiring
  }, [repositories])
  const sendRef = useRef<(input: TourInput) => void>(() => {})
  const valid = useCallback((binding: TourBinding) => enabledRef.current && !!leaseRef.current && leaseRef.current.expiresAt > Date.now() && stateRef.current.attempt?.binding.runToken === binding.runToken && contextRef.current.workspaceId === binding.workspaceId && contextRef.current.panelId === binding.panelId, [])
  const locate = useCallback(() => {
    const current = stateRef.current
    if (!current.attempt || !current.definition || !valid(current.attempt.binding)) return
    const requestedCollection = current.attempt.stepId === 'workflow.board' && !INACTIVE.includes(current.phase)
      && navRef.current.navigationState.navigator === 'sessions' && navRef.current.navigationState.filter.kind === 'allSessions'
      && !navRef.current.navigationState.details
      && hasCollectionViewChange(observationOwner.current, current.attempt.binding, contextRef.current, navRef.current.navigationState.viewMode ?? 'list')
    if (current.phase !== 'locating' && !requestedCollection) return
    const step = current.definition.steps.find(item => item.id === current.attempt?.stepId)
    if (!step) return
    const result = registry.resolve(step.target, current.attempt.binding)
    if (result.status === 'ready') {
      setTarget(result.target)
      // Refresh the replacement target without manufacturing another shown/evidence event.
      if (current.phase === 'locating') sendRef.current({ type: 'TARGET_READY', runToken: current.attempt.binding.runToken, stepId: step.id })
    }
  }, [registry, valid])
  const runEffects = useCallback((effects: readonly TourEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'RESOLVE_VIEW': {
          const stepId = stateRef.current.attempt?.stepId
          const activatedAt = stateRef.current.stepActivatedAt
          if (!stepId || !valid(effect.binding)) break
          const selectedEntity = effect.routeKey === 'selected-source' && navRef.current.navigationState.navigator === 'sources' ? contextRef.current.entityId : effect.binding.entityId
          const route = resolveTourRoute(effect.routeKey, { ...effect.binding, entityId: selectedEntity })
          void (async () => {
            if (route && route !== panelRoute) {
              tourNavigation.current = true
              navigationAnchor.current = { runToken: effect.binding.runToken, navigator: parseRouteToNavigationState(route)?.navigator ?? navRef.current.navigationState.navigator }
              try { await navRef.current.navigate(route, { skipAutoSelect: true }) }
              finally {
                tourNavigation.current = false
              }
            }
            requestAnimationFrame(() => {
              if (!valid(effect.binding) || stateRef.current.attempt?.stepId !== stepId || stateRef.current.stepActivatedAt !== activatedAt) return
              sendRef.current({ type: 'VIEW_READY', runToken: effect.binding.runToken, stepId, navigationRevision: navRef.current.navigationRevision })
              locate()
            })
          })().catch(() => { if (valid(effect.binding)) sendRef.current({ type: 'PAUSE', runToken: effect.binding.runToken, reason: 'api-unavailable' }) })
          break
        }
        case 'LOCATE': locate(); break
        case 'STORE': {
          const lease = leaseRef.current
          const profile = profileRef.current
          if (!repositories || !profile || !lease || lease.expiresAt <= Date.now()) break
          const generation = lifetime.current
          const guard = { profileId: profile, lease, memoryOnly: repositories.lease.getStorageStatus() === 'memory-only' }
          const write = repositories.progress.apply(effect.scopeKey, effect.tour, effect.mutation, guard).then(result => {
            if (generation !== lifetime.current) return
            setStorageStatus(result.status)
            if (result.status !== 'failed' && effect.scopeKey === createLearningScopeKey(profileRef.current ?? '', contextRef.current.workspaceId)) setProgress(previous => ({ ...previous, [effect.tour.id]: result.value }))
          }).catch(error => {
            if (generation !== lifetime.current) return
            if (error instanceof LearningLeaseLostError) {
              // Dismiss/finish can already be inactive when its fenced write is rejected.
              setLaunchReason('lease-lost')
              const attempt = stateRef.current.attempt
              if (attempt && !INACTIVE.includes(stateRef.current.phase)) sendRef.current({ type: 'PAUSE', runToken: attempt.binding.runToken, reason: 'lease-lost' })
            } else setStorageStatus('failed')
          })
          progressWrites.current.add(write)
          void write.finally(() => progressWrites.current.delete(write))
          break
        }
        case 'ARM_TIMEOUT':
          cancelTimeout()
          timeout.current = setTimeout(() => {
            if (foregroundRef.current && stateRef.current.phase !== 'handed-off') sendRef.current({ type: 'TIMEOUT', runToken: effect.runToken, stepId: effect.stepId })
          }, effect.milliseconds)
          break
        case 'CANCEL_TIMEOUT': cancelTimeout(); break
        case 'HIDE': setTarget(null); break
        case 'CLEANUP': cancelTimeout(); setTarget(null); releaseLease(); clearChatObservations(); clearCollectionViewChanges(observationOwner.current); break
        case 'PRESENT': break
        case 'ANNOUNCE': break
      }
    }
  }, [cancelTimeout, locate, panelRoute, releaseLease, repositories, valid])
  const send = useCallback((input: TourInput) => {
    const attempt = stateRef.current.attempt
    if (attempt && (input.type === 'SIGNAL' || ['ACK', 'BACK', 'SKIP', 'RETRY', 'HANDOFF_OPEN', 'HANDOFF_CLOSED'].includes(input.type)) && !valid(attempt.binding)) {
      if (!INACTIVE.includes(stateRef.current.phase)) sendRef.current({ type: 'PAUSE', runToken: attempt.binding.runToken, reason: 'lease-lost' })
      return
    }
    const previous = stateRef.current
    const result = transition(previous, input)
    if (INACTIVE.includes(result.state.phase) || previous.attempt?.binding.runToken !== result.state.attempt?.binding.runToken
      || previous.attempt?.stepId !== result.state.attempt?.stepId) clearCollectionViewChanges(observationOwner.current)
    stateRef.current = result.state
    updateState(result.state)
    runEffects(result.effects)
    if (repositories && preferencesRef.current.diagnosticsEnabled && result.state.definition) {
      const tour = result.state.definition
      for (const effect of result.effects) {
        if (effect.type !== 'STORE') continue
        const mutation = effect.mutation
        const eventName: LearningEventName = mutation.kind === 'evidence' ? `step-${mutation.level}`
          : mutation.kind === 'skip' ? 'step-skipped' : mutation.kind === 'not-applicable' ? 'step-not-applicable'
            : mutation.kind === 'dismiss' ? 'tour-dismissed' : 'tour-finished'
        void repositories.diagnostics.append({ eventName, tourId: tour.id, tourVersion: tour.version, phase: result.state.phase,
          ...('stepId' in mutation ? { stepId: mutation.stepId, stepVersion: mutation.stepVersion } : {}),
          ...('reason' in mutation ? { reason: mutation.reason } : {}),
          ...(mutation.kind === 'evidence' && mutation.level !== 'shown' ? { evidenceLevel: mutation.level } : {}),
        }).catch(() => {})
      }
    }
  }, [runEffects, repositories, valid])
  sendRef.current = send
  const pause = useCallback((reason: SafeReason = 'user-paused') => {
    launchSequence.current += 1
    const attempt = stateRef.current.attempt
    if (attempt) sendRef.current({ type: 'PAUSE', runToken: attempt.binding.runToken, reason })
    cancelTimeout(); releaseLease(); clearChatObservations(); clearCollectionViewChanges(observationOwner.current)
  }, [cancelTimeout, releaseLease])

  useEffect(() => {
    if (!enabled || !repositories || !workspaceId) return
    const generation = ++lifetime.current
    void (async () => {
      const profile = await repositories.profile.read()
      if (generation !== lifetime.current) return
      setStorageStatus(profile.status)
      if (profile.status === 'failed') return
      setProfileId(profile.value.clientProfileId); updatePreferences(profile.value.preferences)
      const key = createLearningScopeKey(profile.value.clientProfileId, workspaceId)
      const loaded = await Promise.all(productTourCatalogue.map(async tour => [tour.id, await repositories.progress.read(key, tour.id)] as const))
      if (generation !== lifetime.current) return
      const values: Partial<Record<TourId, TourProgress>> = {}
      for (const [id, result] of loaded) {
        if (result.status !== 'saved') setStorageStatus(result.status)
        if (result.status !== 'failed' && result.value) values[id] = result.value
      }
      setProgress(values)
    })().catch(() => setStorageStatus('failed'))
    return () => { lifetime.current += 1; launchSequence.current += 1; pause('scope-changed'); setPendingTour(null); setProgress({}); setProfileId(null) }
  }, [enabled, repositories, workspaceId, pause])

  useEffect(() => {
    if (!enabled) return
    const records = capabilityRecords.current
    const collectionOwner = observationOwner.current
    const offSignals = subscribeTourSignals(signal => sendRef.current({ type: 'SIGNAL', signal }))
    const offTargets = registry.subscribe(locate)
    const offModals = modal.subscribe(() => setLayerRevision(value => value + 1))
    const offLayers = layers.subscribe(() => setLayerRevision(value => value + 1))
    const onBlur = () => { foregroundRef.current = false; setForeground(false); if (stateRef.current.phase !== 'handed-off') pause('focus-lost') }
    const onFocus = () => { foregroundRef.current = true; setForeground(true) }
    window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus)
    const onVisibility = () => { if (document.hidden) onBlur(); else onFocus() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      offSignals(); offTargets(); offModals(); offLayers()
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility)
      cancelTimeout(); releaseLease(); clearChatObservations(); clearCollectionViewChanges(collectionOwner); records.clear()
    }
  }, [enabled, registry, locate, modal, layers, pause, cancelTimeout, releaseLease])

  useEffect(() => {
    if (!enabled || !state.attempt) return
    const attempt = state.attempt
    if (context.workspaceId !== attempt.binding.workspaceId || context.panelId !== attempt.binding.panelId) { pause('scope-changed'); return }
    const anchor = navigationAnchor.current
    const requestedCollection = attempt.stepId === 'workflow.board' && nav.navigationState.navigator === 'sessions'
      && nav.navigationState.filter.kind === 'allSessions' && !nav.navigationState.details
      && hasCollectionViewChange(observationOwner.current, attempt.binding, { workspaceId: context.workspaceId, panelId: context.panelId, sessionId: context.sessionId, entityId: context.entityId }, nav.navigationState.viewMode ?? 'list')
    const expectedActionNavigation = requestedCollection || attempt.stepId === 'parallel.new' || attempt.stepId === 'parallel.return' || attempt.stepId === 'search.open' || attempt.stepId === 'tasks.delegate'
    if (!tourNavigation.current && !INACTIVE.includes(state.phase) && anchor?.runToken === attempt.binding.runToken && !expectedActionNavigation) {
      if (nav.navigationState.navigator !== anchor.navigator ||
        (anchor.navigator === 'sessions' && attempt.binding.sessionId && context.sessionId !== attempt.binding.sessionId) ||
        (attempt.binding.entityId && context.entityId !== attempt.binding.entityId)) { pause('scope-changed'); return }
    }
    const step = state.definition?.steps.find(item => item.id === attempt.stepId)
    const otherLayers = [...modal.getSnapshot(), ...layers.getSnapshot()].filter(layer => !layer.id.startsWith('product-tour-'))
    if (otherLayers.length && !INACTIVE.includes(state.phase)) {
      if (step?.handoff) { cancelTimeout(); sendRef.current({ type: 'HANDOFF_OPEN', runToken: attempt.binding.runToken, stepId: attempt.stepId }) }
      else pause('modal-open')
    } else if (!otherLayers.length && state.phase === 'handed-off') sendRef.current({ type: 'HANDOFF_CLOSED', runToken: attempt.binding.runToken, stepId: attempt.stepId })
  }, [enabled, context.workspaceId, context.panelId, context.sessionId, context.entityId, nav.navigationState, layerRevision, state.phase, state.attempt, state.definition, modal, layers, pause, cancelTimeout])

  useEffect(() => {
    const snapshot: EngineSnapshot = { enabled, shellReady, navigationReady: nav.isReady, navigationRevision: nav.navigationRevision, foreground, blockers: [], capabilities }
    snapshotRef.current = snapshot
    sendRef.current({ type: 'SNAPSHOT', snapshot })
  }, [enabled, shellReady, nav.isReady, nav.navigationRevision, foreground, capabilities])

  const active = enabled && !INACTIVE.includes(state.phase)
  useEffect(() => {
    if (!active || !repositories || !profileId) return
    let expiryTimer: ReturnType<typeof setTimeout>
    const armExpiry = () => {
      clearTimeout(expiryTimer)
      expiryTimer = setTimeout(() => pause('lease-lost'), Math.max(0, (leaseRef.current?.expiresAt ?? 0) - Date.now()))
    }
    armExpiry()
    const renew = async () => {
      const lease = leaseRef.current
      if (!lease) { pause('lease-lost'); return }
      const next = await repositories.lease.renew(profileId, lease, Date.now())
      if (leaseRef.current !== lease) return
      if (!next) pause('lease-lost'); else { leaseRef.current = next; armExpiry() }
    }
    const interval = setInterval(() => { void renew().catch(() => pause('lease-lost')) }, 5000)
    return () => { clearInterval(interval); clearTimeout(expiryTimer) }
  }, [active, repositories, profileId, pause])

  const start = useCallback(async (id: TourId, mode: 'new' | 'resume' | 'replay' = 'new') => {
    const tour = productTourCatalogue.find(item => item.id === id)
    if (!tour || !enabledRef.current || !repositories || !profileRef.current || !shellReady) return
    setLaunchReason(null)
    const prerequisite = prerequisiteRoute(tour, navRef.current.navigationState)
    if (prerequisite) {
      pendingMode.current = mode; setPendingTour(id)
      await navRef.current.navigate(prerequisite, { skipAutoSelect: true })
      return
    }
    pause('user-paused')
    const sequence = ++launchSequence.current
    const profile = profileRef.current
    const scope = { ...contextRef.current, entityId: ['OBT-16', 'OBT-23'].includes(id) || (id === 'OBT-22' && navRef.current.navigationState.navigator === 'meetings') ? contextRef.current.entityId : undefined }
    const key = createLearningScopeKey(profile, scope.workspaceId)
    const previous = await repositories.progress.read(key, id)
    if (sequence !== launchSequence.current || !enabledRef.current || scope.workspaceId !== contextRef.current.workspaceId || scope.panelId !== contextRef.current.panelId) return
    const isCurrent = () => sequence === launchSequence.current && enabledRef.current && profileRef.current === profile
      && scope.workspaceId === contextRef.current.workspaceId && scope.panelId === contextRef.current.panelId
      && (scope.entityId === undefined || scope.entityId === contextRef.current.entityId)
      && (scope.sessionId === undefined || scope.sessionId === contextRef.current.sessionId)
    const lease = await acquireLease(profile, isCurrent)
    if (!isCurrent()) return
    if (!lease || previous.status === 'failed') {
      if (lease) await repositories.lease.release(profile, lease)
      setStorageStatus(previous.status === 'failed' ? 'failed' : repositories.lease.getStorageStatus())
      setLaunchReason(previous.status === 'failed' ? 'storage-unavailable' : 'lease-lost')
      return
    }
    leaseRef.current = lease
    const binding: TourBinding = { ...scope, clientProfileId: profile, runToken: crypto.randomUUID() }
    navigationAnchor.current = { runToken: binding.runToken, navigator: navRef.current.navigationState.navigator }
    setPendingTour(null); setStorageStatus(previous.status === 'saved' ? repositories.lease.getStorageStatus() : previous.status)
    clearChatObservations()
    if (snapshotRef.current) sendRef.current({ type: 'SNAPSHOT', snapshot: snapshotRef.current })
    sendRef.current({ type: 'START', binding, tour, progress: previous.value, startMode: mode, at: Date.now() })
  }, [repositories, shellReady, pause, acquireLease])
  useEffect(() => {
    if (pendingTour) {
      const tour = productTourCatalogue.find(item => item.id === pendingTour)
      if (tour && !prerequisiteRoute(tour, nav.navigationState)) void start(pendingTour, pendingMode.current)
    }
  }, [pendingTour, nav.navigationRevision, nav.navigationState, start])

  const port = useMemo<TourRuntimePort>(() => ({
    enabled,
    attemptToken: state.attempt?.binding.runToken,
    observationOwner: observationOwner.current,
    capture(scope) {
      const current = stateRef.current
      const binding = current.attempt?.binding
      const parallel = current.attempt?.stepId === 'parallel.new' || current.attempt?.stepId === 'parallel.return'
      if (!enabledRef.current || !binding || !valid(binding) || INACTIVE.includes(current.phase) || scope.workspaceId !== binding.workspaceId || scope.panelId !== binding.panelId || (!parallel && binding.sessionId && scope.sessionId && binding.sessionId !== scope.sessionId) || (binding.entityId && scope.entityId && binding.entityId !== scope.entityId)) return null
      return { binding, operationToken: crypto.randomUUID(), at: Date.now() }
    },
    emit: signal => sendRef.current({ type: 'SIGNAL', signal }),
    handoff(observation, open) {
      const current = stateRef.current
      const step = current.definition?.steps.find(item => item.id === current.attempt?.stepId)
      if (!observation || !current.attempt || observation.binding.runToken !== current.attempt.binding.runToken || !step?.handoff || !valid(observation.binding)) return
      sendRef.current({ type: open ? 'HANDOFF_OPEN' : 'HANDOFF_CLOSED', runToken: observation.binding.runToken, stepId: current.attempt.stepId })
    },
    register: targetRegistration => registry.register(targetRegistration),
    setCapability(scope, id, capability) {
      const key = JSON.stringify([scope.workspaceId, scope.panelId, id]); const token = {}
      if (id === 'projects.available') {
        const contributions = capabilityRecords.current.get(key)?.projects ?? new Map<object, NonNullable<CapabilitySnapshot[CapabilityId]>>()
        contributions.set(token, capability)
        capabilityRecords.current.set(key, { token, value: capability, projects: contributions })
        setCapRevision(value => value + 1)
        return () => {
          if (capabilityRecords.current.get(key)?.projects !== contributions || !contributions.delete(token)) return
          if (!contributions.size) capabilityRecords.current.delete(key)
          setCapRevision(value => value + 1)
        }
      }
      capabilityRecords.current.set(key, { token, value: capability }); setCapRevision(value => value + 1)
      return () => { if (capabilityRecords.current.get(key)?.token === token) { capabilityRecords.current.delete(key); setCapRevision(value => value + 1) } }
    },
  }), [enabled, registry, state.attempt?.binding.runToken, valid])

  const setEnabled = useCallback((value: boolean) => {
    if (!value) pause('user-paused')
    storage.set(storage.KEYS.featureProductTourV1, value); updateEnabled(value)
  }, [pause])
  const setPreferences = useCallback(async (value: Partial<LearningPreferences>) => {
    if (!repositories) return
    const result = await repositories.profile.updatePreferences(value)
    setStorageStatus(result.status)
    if (result.status !== 'failed') updatePreferences(result.value.preferences)
    if (value.diagnosticsEnabled === false) await repositories.diagnostics.clear()
  }, [repositories])
  const dismiss = useCallback(async () => {
    const current = stateRef.current
    const binding = current.attempt?.binding
    setPendingTour(null); setLaunchReason(null)
    if (!binding || !repositories || !enabledRef.current || current.phase === 'finished') return
    const profile = profileRef.current
    if (!profile || profile !== binding.clientProfileId) return
    const generation = lifetime.current
    const sequence = ++launchSequence.current
    const isCurrent = () => generation === lifetime.current && sequence === launchSequence.current
      && enabledRef.current && profileRef.current === profile && contextRef.current.workspaceId === binding.workspaceId
      && contextRef.current.panelId === binding.panelId && stateRef.current.attempt?.binding.runToken === binding.runToken
    if (!isCurrent()) { setLaunchReason('scope-changed'); return }
    let lease = leaseRef.current
    if (!lease || lease.expiresAt <= Date.now()) lease = await acquireLease(profile, isCurrent)
    if (!isCurrent()) return
    if (!lease) { setLaunchReason('lease-lost'); return }
    leaseRef.current = lease
    sendRef.current({ type: 'DISMISS', runToken: binding.runToken })
  }, [repositories, acquireLease])
  const reset = useCallback(async () => {
    const profile = profileRef.current
    const scope = { ...contextRef.current }
    const generation = lifetime.current
    pause('user-paused')
    if (!repositories || !profile || !scope.workspaceId) return
    const sequence = ++launchSequence.current
    const isCurrent = () => generation === lifetime.current && sequence === launchSequence.current
      && profileRef.current === profile && contextRef.current.workspaceId === scope.workspaceId && contextRef.current.panelId === scope.panelId
    const lease = await acquireLease(profile, isCurrent)
    if (!isCurrent()) return
    if (!lease) { setLaunchReason('lease-lost'); return }
    leaseRef.current = lease
    const guard = { profileId: profile, lease, memoryOnly: repositories.lease.getStorageStatus() === 'memory-only' }
    const write = repositories.progress.resetScope(createLearningScopeKey(profile, scope.workspaceId), guard)
    progressWrites.current.add(write)
    try {
      const result = await write
      if (!isCurrent()) return
      setStorageStatus(result.status)
      if (result.status !== 'failed') { setProgress({}); stateRef.current = initialRuntimeState; updateState(initialRuntimeState); setPendingTour(null); setLaunchReason(null) }
    } catch (error) {
      if (!isCurrent()) return
      if (error instanceof LearningLeaseLostError) setLaunchReason('lease-lost')
      else setStorageStatus('failed')
    } finally {
      progressWrites.current.delete(write)
      if (leaseRef.current === lease) releaseLease()
    }
  }, [pause, repositories, acquireLease, releaseLease])
  const controller: LearningController = { enabled, ready: !!profileId && !!workspaceId, setEnabled, state, progress, preferences, setPreferences, storageStatus, pendingTour, start, pause, reset, capabilities }
  const step = state.definition?.steps.find(item => item.id === state.attempt?.stepId)
  const evidence = step ? state.attemptEvidence[step.id] : undefined
  const canNext = step?.completion.kind === 'ack' || !!(evidence?.level && (step?.completion.evidence === 'observed' || evidence.level === 'verified'))
  const input = (type: 'ACK' | 'BACK' | 'SKIP' | 'RETRY') => { if (state.attempt) sendRef.current({ type, runToken: state.attempt.binding.runToken, stepId: state.attempt.stepId, at: Date.now() }) }
  const presentation = <>
      {enabled && welcomeSessionId && preferences.invitationsEnabled && !active && !progress['OBT-01'] && context.sessionId === welcomeSessionId && modal.getSnapshot().length === 0 && <aside data-testid="learning-welcome-invitation" className="fixed bottom-4 right-4 z-40 rounded-xl border bg-background p-3 shadow-modal-small"><button type="button" onClick={() => void start('OBT-01')}>{t('productTour.welcomeInvitation')}</button></aside>}
      <TourErrorBoundary key={enabled ? state.attempt?.binding.runToken ?? 'enabled' : 'disabled'} onError={() => pause('operation-failed')}>
        {active && target && step && state.attempt && (state.phase === 'presenting' || state.phase === 'waiting-action') && <SpotlightOverlay target={target} step={step} binding={state.attempt.binding} onPause={pause} onNext={() => input('ACK')} onBack={() => input('BACK')} onSkip={() => input('SKIP')} onDismiss={() => void dismiss()} canNext={canNext} />}
      </TourErrorBoundary>
      {enabled && (state.phase === 'paused' || state.phase === 'blocked' || pendingTour || launchReason) && <aside data-testid="product-tour-status" role="status" className="fixed bottom-4 right-4 z-40 max-w-xs rounded-xl border bg-background p-3 text-sm shadow-modal-small">
        <p>{t(pendingTour ? 'productTour.chooseEntity' : `productTour.reasons.${launchReason ?? state.attempt?.reason ?? 'user-paused'}`)}</p>
        {!pendingTour && state.definition && <button type="button" className="mr-3" onClick={() => void start(state.definition!.id, 'resume')}>{t('productTour.controls.resume')}</button>}
        <button type="button" onClick={() => void dismiss()}>{t('productTour.controls.dismiss')}</button>
      </aside>}
</>
  return <LearningContext.Provider value={controller}><TourRuntimeContext.Provider value={port}>
    <TourPanelScope {...context}><TourPresentationContext.Provider value={presentation}>
      {children}
    </TourPresentationContext.Provider></TourPanelScope>
  </TourRuntimeContext.Provider></LearningContext.Provider>
}

/** One host in the ready application branch; presentation owns no product actions. */
export function ProductTourHost() { return <>{useContext(TourPresentationContext)}</> }
