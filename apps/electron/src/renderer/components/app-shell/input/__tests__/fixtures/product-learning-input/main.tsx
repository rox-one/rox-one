// Test-only composition. Controls, target registry, layer providers and engine are production implementations.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@rox/ui'
import { InputContainer } from '../../../InputContainer'
import { FreeFormInput } from '../../../FreeFormInput'
import { AppShellProvider } from '../../../../../../context/AppShellContext'
import { ModalProvider, useModalRegistry } from '../../../../../../context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '../../../../../../context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '../../../../../../context/EscapeInterruptContext'
import { TourRuntimeContext, TourPanelScope, type TourRuntimePort } from '../../../../../../features/product-tour/runtime/hooks'
import { createTargetRegistry } from '../../../../../../features/product-tour/ui/target-registry'
import { transition, initialRuntimeState } from '../../../../../../features/product-tour/core'
import { productTourCatalogue } from '../../../../../../features/product-tour/catalogue'
import type { TourBinding, TourInput, TargetId } from '../../../../../../features/product-tour/contracts'

const f = (window as any).learningInput = { mounted: false, compact: false, kind: 'permission', rawTargets: new Map(), signals: [] as any[], effects: [] as any[], responses: [] as any[], selections: [] as any[], engine: initialRuntimeState, rotateOnCapture: false, activeRun: 'run-a', nativeLayers: () => 0 }
const registry = createTargetRegistry({ getPreferredVariant: () => f.compact ? 'compact' : 'regular' })
const binding: TourBinding = { workspaceId: 'workspace-a', panelId: 'panel-a', sessionId: 'session-a', clientProfileId: 'profile-a', runToken: 'run-a' }
const tour = productTourCatalogue.find(tour => tour.slug === 'models') ?? productTourCatalogue.find(tour => tour.steps[0]?.id === 'models.picker')!
function input(event: TourInput) {
  const result = transition(f.engine, event)
  f.engine = result.state
  f.effects.push(...result.effects)
}
function startEngine() {
  f.engine = initialRuntimeState
  input({ type: 'SNAPSHOT', snapshot: { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 1, foreground: true, blockers: [], capabilities: { 'shell.ready': { state: 'ready' }, 'sessions.available': { state: 'ready' } } } })
  input({ type: 'START', tour, binding: { ...binding, runToken: f.activeRun }, progress: null, startMode: 'new', at: Date.now() })
  input({ type: 'VIEW_READY', runToken: f.activeRun, stepId: 'models.picker', navigationRevision: 1 })
  input({ type: 'TARGET_READY', runToken: f.activeRun, stepId: 'models.picker' })
  f.effects = []
}
Object.assign(window, { electronAPI: { getAutoCapitalisation: async () => false, getSendMessageKey: async () => 'enter', getSpellCheck: async () => false, getHomeDir: async () => '', onPreferencesChanged: () => () => {} } })

function Harness({ compact, kind }: { compact: boolean; kind: string }) {
  const modals = useModalRegistry(), layers = useDismissibleLayerRegistry()
  f.nativeLayers = () => modals.getSnapshot().length + layers.getSnapshot().length
  const runtime = React.useMemo<TourRuntimePort>(() => ({
    enabled: true,
    capture(scope) {
      const observation = { binding: { ...binding, ...scope, runToken: f.activeRun }, operationToken: crypto.randomUUID(), at: Date.now() }
      if (f.rotateOnCapture) { f.activeRun = 'run-b'; startEngine() }
      return observation
    },
    emit(signal) {
      f.signals.push({ signal, nativeLayers: f.nativeLayers(), phaseBeforeSignal: f.engine.phase })
      if (signal.binding.runToken === f.activeRun) input({ type: 'SIGNAL', signal })
    },
    handoff(observation, open) {
      if (observation.binding.runToken === f.activeRun) input({ type: open ? 'HANDOFF_OPEN' : 'HANDOFF_CLOSED', runToken: observation.binding.runToken, stepId: f.engine.attempt!.stepId })
    },
    register(target) {
      f.rawTargets.set(target.registrationToken, target)
      const unregister = registry.register(target)
      return () => { f.rawTargets.delete(target.registrationToken); unregister() }
    },
    setCapability: () => () => {},
  }), [])
  React.useEffect(() => { f.mounted = true; return () => { f.mounted = false } }, [])
  const props = { sessionId: 'session-a', workspaceId: 'workspace-a', currentModel: 'claude-sonnet-4-6', compactMode: compact, enableCompactModelPicker: compact, onSubmit: () => f.selections.push('submit'), onModelChange: (...args: any[]) => f.selections.push(args) }
  return <TourRuntimeContext.Provider value={runtime}><TourPanelScope {...binding}>
    {kind === 'models' ? <FreeFormInput {...props} /> : <InputContainer {...props} structuredInput={kind === 'permission'
      ? { type: 'permission', data: { sessionId: 'session-a', requestId: 'request-a', toolName: 'bash', description: 'Inspect this operation', command: 'printf fixture' } as any }
      : { type: 'admin_approval', data: { appName: 'Fixture', reason: 'Inspect this operation', command: 'printf fixture' } }} onStructuredResponse={response => f.responses.push(response)} />}
  </TourPanelScope></TourRuntimeContext.Provider>
}
const shell = { activeWorkspaceId: 'workspace-a', workspaces: [], llmConnections: [], isFocusedPanel: true, sessionStatuses: [], getDraft: () => '', refreshLlmConnections: async () => {} } as any
const root = createRoot(document.getElementById('root')!)
Object.assign(f, {
mount: (compact: boolean, kind: string) => {
  f.compact = compact; f.kind = kind; f.mounted = false; f.responses = []; f.selections = []; f.signals = []; f.activeRun = 'run-a'; f.rotateOnCapture = false
  startEngine()
  root.render(<React.StrictMode><ModalProvider><DismissibleLayerProvider><EscapeInterruptProvider><AppShellProvider value={shell}><TooltipProvider><Harness key={String(compact)+kind} compact={compact} kind={kind} /></TooltipProvider></AppShellProvider></EscapeInterruptProvider></DismissibleLayerProvider></ModalProvider></React.StrictMode>)
},
resolve: (id: TargetId) => {
  const result = registry.resolve(id, binding)
  return { status: result.status, reason: result.status === 'blocked' ? result.reason : null, variant: result.status === 'ready' ? result.target.variant : null, count: [...f.rawTargets.values()].filter((target: any) => target.id === id).length }
},
inspect: () => ({ signals: f.signals, phase: f.engine.phase, stepId: f.engine.attempt?.stepId, effects: f.effects, nativeLayers: f.nativeLayers(), responses: f.responses, selections: f.selections }),
openModel: () => { const result = registry.resolve('composer.model', binding); if (result.status !== 'ready') throw new Error(JSON.stringify(result)); result.target.element.setAttribute('data-fixture-model-trigger', '') }

})
