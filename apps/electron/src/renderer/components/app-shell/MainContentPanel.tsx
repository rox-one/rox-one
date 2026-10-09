import * as React from 'react'
import { TourPanelScope, useTourSignals } from '@/features/product-tour/runtime/hooks'
import { navigationEntity } from '@/features/product-tour/runtime/routes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { navigate, routes } from '@/lib/navigate'
import { MemoryScreen } from '../memory/MemoryScreen'
import { MemoryRepoScreen } from '../memory/MemoryRepoScreen'
import { LearningScreen } from '../learning/LearningScreen'
import { ProjectsHomeInMain } from './ProjectsHomeInMain'
import { MultiSelectPanel } from './MultiSelectPanel'
import { CollectionBulkBar } from './collection/CollectionBulkBar'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '@/atoms/runtime-trace'
import { useSession } from '@/hooks/useSession'
import { loadRuntimeTrace, type RuntimeTraceAPI } from '@/event-processor/runtime-trace-ingress'
import { runtimeCatalogCapabilities, runtimeCatalogScope } from '@/lib/runtime-catalog-capabilities'
import { StoplightProvider } from '@/context/StoplightContext'
import { panelRouteKey } from './panel-route-key'
import {
  useNavigationState,
  useNavigation,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isMemoryNavigation,
  isClipboardHistoryNavigation,
  isLearningNavigation,
  isTasksNavigation,
  isInboxNavigation,
  isFeedNavigation,
  isNotesNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isPagesNavigation,
  isBrowserNavigation,
  isKnowledgeNavigation,
  isDiffNavigation,
  isExtensionNavigation,
  isConnectionsNavigation,
  isHomeNavigation,
  isDriveNavigation,
  isCloudRunNavigation,
  isTerminalNavigation,
} from '@/contexts/NavigationContext'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { isScreenNavigation, isSurfaceNavigation, type LoadedSource, type LoadedSkill, type NavigationState } from '../../../shared/types'
import { buildRouteFromNavigationState } from '../../../shared/route-parser'
import ChatPage from '@/pages/ChatPage'
import { HomeFrontPage } from '@/platform/HomeFrontPage'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { SettingsOverviewPage } from '@/pages/settings/SettingsOverviewPage'
import { recordRecentSetting } from '@/lib/settings-recent'
import { PageView } from '../pages/PageView'
import { SessionHeatmapHost } from './session-heatmap/SessionHeatmapHost'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import {
  knowledgeActiveViewIdAtom,
  knowledgeHomeViewAtom,
} from '../../knowledge/KnowledgeHome'

import { lazyRoutePage, RouteErrorBoundary } from '@/lib/route-recovery'
import { endRouteSwitch } from '@/lib/startup-perf'
import { RetainedSurfacePane, surfaceKeepAliveCapacity, useKeepAliveSurfaces } from '@/lib/surface-keepalive'
import { ROUTE_PAGE_LOADERS } from './route-pages'
export { lazyRoutePage } from '@/lib/route-recovery'

function UnavailableAutomationTour({ workspaceId }: { workspaceId: string | null }) {
  const signals = useTourSignals({ workspaceId: workspaceId ?? '' })
  useEffect(() => {
    const capability = { state: 'unavailable', reason: 'missing-entity' } as const
    const removeAvailable = signals.capability('automations.available', capability)
    const removeEntity = signals.capability('automation.entity-present', capability)
    return () => { removeEntity(); removeAvailable() }
  }, [signals])
  return null
}


// PERF-10 (#1577): every lazy page comes from the shared registry so
// `preloadRoute()` can warm the chunk before the user navigates to it.
const SearchPage = lazyRoutePage(ROUTE_PAGE_LOADERS.search)
const NotesPage = lazyRoutePage(ROUTE_PAGE_LOADERS.notes)
const ConnectionsPage = lazyRoutePage(ROUTE_PAGE_LOADERS.connections)
const ExtraScreenHost = lazyRoutePage(ROUTE_PAGE_LOADERS.extraScreens)
const DrivePage = lazyRoutePage(() => import('@/pages/DrivePage'))
// W1-07 (#1504): unified mode roots; reachable only while their mode flag is on.
const SurfaceHost = lazyRoutePage(ROUTE_PAGE_LOADERS.surfaces)
const TasksPage = lazyRoutePage(ROUTE_PAGE_LOADERS.tasks)
const AgentsWorkspacePage = lazyRoutePage(ROUTE_PAGE_LOADERS.agentsWorkspace)
const InboxPage = lazyRoutePage(ROUTE_PAGE_LOADERS.inbox)
const FeedPage = lazyRoutePage(ROUTE_PAGE_LOADERS.feed)
const ClipboardHistoryPage = lazyRoutePage(ROUTE_PAGE_LOADERS.clipboardHistory)
const KnowledgeEntityPage = lazyRoutePage(ROUTE_PAGE_LOADERS.knowledgeEntity)
const SkillInfoPage = lazyRoutePage(ROUTE_PAGE_LOADERS.skillInfo)
const SourceInfoPage = lazyRoutePage(ROUTE_PAGE_LOADERS.sourceInfo)
const SkillsCatalogPage = lazyRoutePage(ROUTE_PAGE_LOADERS.skillsCatalog)
const IntegrationsCatalogPage = lazyRoutePage(ROUTE_PAGE_LOADERS.integrationsCatalog)
const ProjectInfoPage = lazyRoutePage(ROUTE_PAGE_LOADERS.projectInfo)
const BrowserPanelPage = lazyRoutePage(ROUTE_PAGE_LOADERS.browser)
const ExtensionSurfacePage = lazyRoutePage(ROUTE_PAGE_LOADERS.extensionSurface)
const TerminalSurfacePage = lazyRoutePage(ROUTE_PAGE_LOADERS.terminal)
const CloudRunSurfacePage = lazyRoutePage(ROUTE_PAGE_LOADERS.cloudRun)
const PagesHome = lazyRoutePage(ROUTE_PAGE_LOADERS.pagesHome)
const KanbanBoardContainer = lazyRoutePage(ROUTE_PAGE_LOADERS.kanban)
const SessionTableHost = lazyRoutePage(ROUTE_PAGE_LOADERS.sessionTable)
const AutomationEditor = lazyRoutePage(ROUTE_PAGE_LOADERS.automationEditor)
const KnowledgeDiff = lazyRoutePage(ROUTE_PAGE_LOADERS.knowledgeDiff)
const KnowledgeHome = lazyRoutePage(ROUTE_PAGE_LOADERS.knowledgeHome)
const KnowledgeProposals = lazyRoutePage(ROUTE_PAGE_LOADERS.knowledgeProposals)

type SelectedResourceStatus = 'loading' | 'ready' | 'missing' | 'unavailable'

/** Observe canonical source/skill snapshots without changing the selected URL. */
function useSelectedResourceAvailability(
  workspaceId: string | null | undefined,
  kind: 'source' | 'skill' | null,
  slug: string | null,
  workingDirectory?: string,
): { status: SelectedResourceStatus; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const identity = JSON.stringify([workspaceId, kind, slug, workingDirectory])
  const [state, setState] = useState<{
    identity: string
    status: SelectedResourceStatus
    editableSkill?: boolean
  }>({
    identity,
    status: kind ? 'loading' : 'ready',
  })
  useEffect(() => {
    if (!kind || !slug) return
    let active = true
    let revision = 0
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!workspaceId || !api || (kind === 'source' ? !api.getSources : !api.getSkills)) {
      setState({ identity, status: 'unavailable' })
      return
    }
    const load = async (background = false) => {
      const request = ++revision
      // Keep a mounted editor while a background snapshot is pending. An
      // invalidation alone does not prove that its entity was deleted.
      if (!background) setState({ identity, status: 'loading' })
      try {
        const rows = kind === 'source'
          ? await api.getSources(workspaceId)
          : await api.getSkills(workspaceId, workingDirectory)
        if (!Array.isArray(rows)) throw new Error('Invalid resource snapshot')
        if (!active || request !== revision) return
        if (kind === 'source') {
          const exists = (rows as LoadedSource[]).some((source) => source.config.slug === slug)
          setState({ identity, status: exists ? 'ready' : 'missing' })
        } else {
          const skill = (rows as LoadedSkill[]).find((skill) => skill.slug === slug)
          setState({
            identity, status: skill ? 'ready' : 'missing',
            editableSkill: skill?.source === 'workspace',
          })
        }
      } catch {
        if (active && request === revision) {
          setState((previous) => background && previous.identity === identity
            && previous.status === 'ready' && previous.editableSkill
            ? previous : { identity, status: 'unavailable' })
        }
      }
    }
    const off = kind === 'source'
      ? api.onSourcesChanged?.((changedWorkspaceId, sources) => {
          if (!active || changedWorkspaceId !== workspaceId) return
          revision += 1
          const valid = Array.isArray(sources) && sources.every((source) => typeof source?.config?.slug === 'string')
          setState({ identity, status: valid ? (sources.some((source) => source.config.slug === slug) ? 'ready' : 'missing') : 'unavailable' })
        })
      : api.onSkillsChanged?.((changedWorkspaceId) => {
          if (!active || changedWorkspaceId !== workspaceId) return
          // Workspace watcher payloads need not contain project/global skills.
          // Re-read the same resolution context as the selected skill host.
          void load(true)
        })
    void load()
    return () => { active = false; revision += 1; off?.() }
  }, [identity, workspaceId, kind, slug, workingDirectory, attempt])
  return {
    status: state.identity === identity ? state.status : kind ? 'loading' : 'ready',
    retry: () => setAttempt((value) => value + 1),
  }
}

export interface MainContentPanelProps {
  isSidebarAndNavigatorHidden?: boolean
  className?: string
  navStateOverride?: import('../../../shared/types').NavigationState | null
  panelId?: string
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
  panelId,
}: MainContentPanelProps) {
  const globalNavState = useNavigationState()
  const { isSessionsReady = true, unavailableWorkspaceSlug } = useNavigation()
  const requestedNavState = unavailableWorkspaceSlug ? globalNavState : navStateOverride ?? globalNavState
  const { activeWorkspaceId, workspaces, activeSessionWorkingDirectory } = useAppShellContext()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const selectedSession = isSessionsNavigation(requestedNavState) && requestedNavState.details
    ? sessionMetaMap.get(requestedNavState.details.sessionId) : undefined
  const remoteWorkspaceId = workspaces.find(workspace => workspace.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
  // PanelSlot supplies its own route state, including for unfocused panels.
  // Validate that state here before a foreign session can mount its ChatPage.
  const navState: NavigationState = isSessionsReady && selectedSession && activeWorkspaceId
    && selectedSession.workspaceId !== activeWorkspaceId && (!remoteWorkspaceId || selectedSession.workspaceId !== remoteWorkspaceId)
    ? { navigator: 'unavailable', route: buildRouteFromNavigationState(requestedNavState), reason: 'workspace-mismatch',
        ...(requestedNavState.rightSidebar ? { rightSidebar: requestedNavState.rightSidebar } : {}) }
    : requestedNavState

  // Detail state belongs to its workspace and entity, including project-level skills.
  // W1-07 (#1504): the surface id joins the key (unified mode roots).
  const routeKey = panelRouteKey(navState, { activeWorkspaceId, unavailableWorkspaceSlug, activeSessionWorkingDirectory })
  // PERF-01: route switch painted (pairs with startRouteSwitch in navigate()).
  useEffect(() => {
    endRouteSwitch(navState.navigator)
  }, [routeKey])

  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  // PERF-10 (#1577): the last visited surfaces stay mounted (hidden) and are
  // reused on the way back; capacity is 5 (3 on low memory, 1 when disabled).
  const [keepAliveCapacity] = useState(() => surfaceKeepAliveCapacity())
  const activeSurface = (
    <SurfaceRoutePanel
      navState={navState}
      requestedNavState={requestedNavState}
      routeKey={routeKey}
      panelId={panelId}
      className={className}
      isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
      openSendDialog={openSendDialog}
    />
  )
  const retainedSurfaces = useKeepAliveSurfaces(routeKey, activeSurface, keepAliveCapacity)
  return (
    <>
      {retainedSurfaces.map(entry => (
        <RetainedSurfacePane key={entry.key} active={entry.key === routeKey}>
          {entry.node}
        </RetainedSurfacePane>
      ))}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
    </>
  )
}

interface SurfaceRoutePanelProps {
  navState: NavigationState
  requestedNavState: NavigationState
  routeKey: string
  panelId?: string
  className?: string
  isSidebarAndNavigatorHidden: boolean
  openSendDialog: (type: SendResourceType, ids: Set<string>) => void
}

/** One surface: the route chain plus its providers. Memoized, so a retained
 * surface only re-renders when it is activated (its recorded props) or its own
 * data changes — never because a sibling's route moved. */
const SurfaceRoutePanel = React.memo(function SurfaceRoutePanel({
  navState,
  requestedNavState,
  routeKey,
  panelId,
  className,
  isSidebarAndNavigatorHidden,
  openSendDialog,
}: SurfaceRoutePanelProps) {
  const { t } = useTranslation()
  const {
    activeWorkspaceId,
    workspaces,
    sessionStatuses,
    projects,
    loadedProjects,
    labels,
    activeSessionWorkingDirectory,
    localMcpEnabled,
    skills,
  } = useAppShellContext()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const remoteWorkspaceId = workspaces.find(workspace => workspace.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
  const { isSessionsReady = true } = useNavigation()
  const [sessionSelection] = useSession()
  const store = useStore()
  const catalogSessionId = sessionSelection.selected
  const catalogScope = isSkillsNavigation(navState) || isSourcesNavigation(navState)
    ? runtimeCatalogScope(activeWorkspaceId, catalogSessionId, catalogSessionId ? sessionMetaMap.get(catalogSessionId)?.workspaceId : undefined, remoteWorkspaceId) : undefined
  const catalogTrace = useAtomValue(runtimeTraceSessionAtomFamily(catalogScope ? runtimeTraceScopeKey(catalogScope) : 'catalog:no-session'))
  const catalogCapabilities = useMemo(() => runtimeCatalogCapabilities(catalogTrace, catalogScope, skills), [catalogTrace, catalogScope?.workspaceId, catalogScope?.sessionId, skills])
  useEffect(() => {
    if (!catalogScope || !isSkillsNavigation(navState) && !isSourcesNavigation(navState)) return
    // Reuse canonical snapshot/cursor ingress; the catalog adds no live listener.
    void loadRuntimeTrace(store, catalogScope, window.electronAPI as unknown as RuntimeTraceAPI)
  }, [store, catalogScope?.workspaceId, catalogScope?.sessionId, navState.navigator])
  const visibleSessionIds = useMemo(
    () =>
      [...sessionMetaMap.values()]
        .filter((meta) => !activeWorkspaceId || meta.workspaceId === activeWorkspaceId || meta.workspaceId === remoteWorkspaceId)
        .map((meta) => meta.id),
    [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId],
  )
  const automations = useAtomValue(automationsAtom)
  const setKnowledgeHomeView = useSetAtom(knowledgeHomeViewAtom)
  const setKnowledgeActiveViewId = useSetAtom(knowledgeActiveViewIdAtom)

  useEffect(() => {
    if (!isKnowledgeNavigation(navState)) return
    if (navState.details?.type === 'knowledge-view') {
      setKnowledgeActiveViewId(navState.details.viewId)
      setKnowledgeHomeView('view')
      return
    }
    setKnowledgeActiveViewId(null)
    setKnowledgeHomeView('search')
  }, [navState, setKnowledgeActiveViewId, setKnowledgeHomeView])

  useEffect(() => {
    if (!isSettingsNavigation(navState) || navState.subpage === null || !activeWorkspaceId) return
    const controller = new AbortController()
    void recordRecentSetting(activeWorkspaceId, navState.subpage, { signal: controller.signal })
    return () => { controller.abort() }
  }, [navState, activeWorkspaceId])

  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  const resourceKind = isSourcesNavigation(navState) && navState.details
    ? 'source'
    : isSkillsNavigation(navState) && navState.details?.type === 'skill' ? 'skill' : null
  const resourceSlug = isSourcesNavigation(navState) && navState.details
    ? navState.details.sourceSlug
    : isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null
  const { status: resourceStatus, retry: retryResource } = useSelectedResourceAvailability(
    activeWorkspaceId, resourceKind, resourceSlug,
    resourceKind === 'skill' ? activeSessionWorkingDirectory : undefined,
  )
  const hasOtherWorkspaces = workspaces.length > 1

  const skillPhaseSummary = (['selected', 'loaded', 'applied'] as const).map(phase => ({
    phase,
    refs: catalogCapabilities[phase].filter(ref => phase === 'applied'
      || !catalogCapabilities.applied.some(applied => applied.kind === ref.kind && applied.scope === ref.scope && applied.id === ref.id))
      .filter(ref => phase !== 'selected'
        || !catalogCapabilities.loaded.some(loaded => loaded.kind === ref.kind && loaded.scope === ref.scope && loaded.id === ref.id)),
  })).filter(group => group.refs.length)

  const pageFallback = (
    <Panel variant="grow" className={className}>
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    </Panel>
  )

  const wrapWithStoplight = (content: React.ReactNode) => (
    <TourPanelScope workspaceId={activeWorkspaceId ?? ''} panelId={panelId ?? 'shell'} {...navigationEntity(navState)}>
    <StoplightProvider key={routeKey} value={isSidebarAndNavigatorHidden}>
      <RouteErrorBoundary key={routeKey} fallback={(retry) => (
        <Panel variant="grow" className={className}>
          <div role="alert" data-testid="route-error" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-muted-foreground">{t('common.errorLoadingContent')}</p>
            <button type="button" onClick={retry} className="rounded-md border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('common.retry')}
            </button>
          </div>
        </Panel>
      )}>
        <React.Suspense fallback={pageFallback}>{content}</React.Suspense>
      </RouteErrorBoundary>
    </StoplightProvider>
    </TourPanelScope>
  )

  const resourceMultiSelect = resourceKind === 'source' ? isSourceMultiSelectActive : isSkillMultiSelectActive
  if (resourceKind && !resourceMultiSelect && resourceStatus !== 'ready') {
    const message = resourceStatus === 'loading'
      ? t('common.loading')
      : resourceStatus === 'missing'
        ? t(resourceKind === 'source' ? 'sourceInfo.notFound' : 'skillInfo.notFound')
        : t('common.unavailable')
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div
          className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground"
          role="status"
          aria-live="polite"
          data-testid={`route-resource-${resourceStatus}`}
          data-route-resource={resourceKind}
          data-route-entity={resourceSlug}
        >
          <p className="text-sm">{message}</p>
          {resourceStatus !== 'loading' && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="route-resource-retry"
              onClick={retryResource}
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      </Panel>
    )
  }

  if (isSettingsNavigation(navState)) {
    if (navState.subpage === null) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SettingsOverviewPage />
        </Panel>
      )
    }
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage sourceSlug={navState.details.sourceSlug} workspaceId={activeWorkspaceId || ''} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <IntegrationsCatalogPage
          workspaceId={activeWorkspaceId || ''}
          workspaceRootPath={workspaces.find(workspace => workspace.id === activeWorkspaceId)?.rootPath}
          sourceFilter={navState.filter}
          localMcpEnabled={localMcpEnabled}
          usedCapabilities={catalogCapabilities.usedCapabilities}
        />
      </Panel>
    )
  }

  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex h-full min-h-0 flex-col">
          {!!skillPhaseSummary.length && <div role="status" aria-label={t('capabilityCatalog.usedInRun')} data-testid="catalog-skill-runtime-phases" className="shrink-0 space-y-1 border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
            {skillPhaseSummary.map(group => <p key={group.phase} data-skill-phase={group.phase}>
              <span className="font-medium">{t(`runtimeMap.skill.${group.phase}`)}</span>{': '}
              {group.refs.map(ref => ref.label).join(', ')}
            </p>)}
          </div>}
          <div className="min-h-0 flex-1">
            <SkillsCatalogPage
              workspaceId={activeWorkspaceId || ''}
              workspaceRootPath={workspaces.find(workspace => workspace.id === activeWorkspaceId)?.rootPath}
              workingDirectory={activeSessionWorkingDirectory}
              usedCapabilities={catalogCapabilities.usedCapabilities}
            />
          </div>
        </div>
      </Panel>
    )
  }

  if (isMemoryNavigation(navState)) {
    if (navState.tab === 'repo' || navState.tab === 'dream') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MemoryRepoScreen workspaceId={activeWorkspaceId ?? undefined} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <MemoryScreen workspaceId={activeWorkspaceId ?? undefined} />
      </Panel>
    )
  }

  if (isClipboardHistoryNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ClipboardHistoryPage />
      </Panel>
    )
  }

  if (isLearningNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <LearningScreen workspaceId={activeWorkspaceId ?? undefined} />
      </Panel>
    )
  }

  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    const automation = navState.details
      ? automations.find(h => h.id === navState.details!.automationId)
      : undefined
    if (automation) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <AutomationEditor key={automation.id} automation={automation} workspaceId={activeWorkspaceId} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex h-full items-center justify-center p-8" data-testid="automations-empty-editor">
          <UnavailableAutomationTour workspaceId={activeWorkspaceId} />
          <div className="max-w-sm text-center text-sm text-muted-foreground">
            <p className="text-base text-foreground">
              {/* A stale selection (e.g. just deleted) falls back to the picker once the list has loaded. */}
              {navState.details && automations.length === 0 ? t('common.loading') : t('automations.pickOne')}
            </p>
            <p className="mt-2">{t('automations.emptyDescription')}</p>
          </div>
        </div>
      </Panel>
    )
  }

  if (isPagesNavigation(navState)) {
    if (navState.details?.type === 'page') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <PageView key={navState.details.pageSlug} pageSlug={navState.details.pageSlug} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <PagesHome />
      </Panel>
    )
  }

  if (isProjectsNavigation(navState)) {
    const projectDetails = navState.details
    if (projectDetails && projectDetails.type === 'project') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ProjectInfoPage projectSlug={projectDetails.projectSlug} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ProjectsHomeInMain projects={loadedProjects ?? []} workspaceId={activeWorkspaceId || ''} />
      </Panel>
    )
  }

  if (isBrowserNavigation(navState)) {
    const instanceId = navState.details?.type === 'browser' ? navState.details.id : null
    if (instanceId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <BrowserPanelPage instanceId={instanceId} panelId={panelId} persist />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t('browser.noInstanceSelected')}</p>
        </div>
      </Panel>
    )
  }

  if (isKnowledgeNavigation(navState)) {
    const details = navState.details?.type === 'knowledge' ? navState.details : null
    if (details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <KnowledgeEntityPage kind={details.kind} id={details.id} panelId={panelId} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <KnowledgeHome />
      </Panel>
    )
  }

  if (isExtensionNavigation(navState)) {
    const details = navState.details?.type === 'extension' ? navState.details : null
    if (details?.extensionId && details.viewId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ExtensionSurfacePage extensionId={details.extensionId} viewId={details.viewId} panelId={panelId} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t('extensions.surface.noViewSelected')}</p>
        </div>
      </Panel>
    )
  }

  // terminal/{id} + cloud-run/{runId}: honest hosts — never mute-fallthrough to selectConversation
  if (isTerminalNavigation(navState)) {
    const terminalId = navState.details?.type === 'terminal' ? navState.details.id : null
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <TerminalSurfacePage terminalId={terminalId} />
      </Panel>
    )
  }

  if (isCloudRunNavigation(navState)) {
    const runId = navState.details?.type === 'cloud-run' ? navState.details.runId : null
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <CloudRunSurfacePage runId={runId} />
      </Panel>
    )
  }

  if (isDiffNavigation(navState)) {
    const proposalId = navState.details?.type === 'diff' ? navState.details.proposalId : null
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        {proposalId ? <KnowledgeDiff proposalId={proposalId} /> : <KnowledgeProposals className="h-full" />}
      </Panel>
    )
  }

  if (isHomeNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <HomeFrontPage />
      </Panel>
    )
  }

  if (isDriveNavigation(navState)) {
    const folderId = navState.details?.type === 'folder' ? navState.details.folderId : undefined
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <DrivePage workspaceId={activeWorkspaceId ?? ''} folderId={folderId} />
      </Panel>
    )
  }

  if (isTasksNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <TasksPage
          selectedId={navState.details?.taskId ?? null}
        />
      </Panel>
    )
  }

  if (isInboxNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <InboxPage selectedId={navState.details?.itemId ?? null} />
      </Panel>
    )
  }

  if (isFeedNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <FeedPage selectedId={navState.details?.itemId ?? null} />
      </Panel>
    )
  }

  if (isSurfaceNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SurfaceHost surface={navState.surface} meetingId={navState.meetingId ?? null} />
      </Panel>
    )
  }

  if (isScreenNavigation(navState) && navState.screen === 'agents') return wrapWithStoplight(<Panel variant="grow" className={className}><AgentsWorkspacePage /></Panel>)

  if (isScreenNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ExtraScreenHost screen={navState.screen} itemId={navState.details?.itemId ?? null} />
      </Panel>
    )
  }

  if (isConnectionsNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ConnectionsPage />
      </Panel>
    )
  }

  if (navState.navigator === 'search') {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SearchPage initialQuery={navState.query} />
      </Panel>
    )
  }

  if (isNotesNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <NotesPage selectedNoteId={navState.details?.type === 'note' ? navState.details.noteId : null} />
      </Panel>
    )
  }

  if (isSessionsNavigation(navState)) {
    if (navState.viewMode === 'board') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <KanbanBoardContainer />
        </Panel>
      )
    }
    if (navState.viewMode === 'table') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SessionTableHost />
        </Panel>
      )
    }
    if (navState.viewMode === 'heatmap') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SessionHeatmapHost />
        </Panel>
      )
    }
    const sessionsBulkBar = (
      <CollectionBulkBar
        workspaceId={activeWorkspaceId}
        visibleSessionIds={visibleSessionIds}
        statuses={sessionStatuses}
        projects={projects}
        labels={labels}
      />
    )
    if (navState.details) {
      const sessionId = navState.details.sessionId
      const meta = sessionMetaMap.get(sessionId)
      const belongsToWorkspace = !!meta && !!activeWorkspaceId && (
        meta.workspaceId === activeWorkspaceId || meta.workspaceId === remoteWorkspaceId
      )
      if (!isSessionsReady || !belongsToWorkspace) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <div role="status" aria-live="polite" data-testid={isSessionsReady ? 'route-session-missing' : 'route-session-loading'} data-route-entity={sessionId}
              className="flex h-full items-center justify-center p-4 text-muted-foreground">
              <div data-testid={isSessionsReady ? 'route-session-unavailable' : undefined} data-session-id={sessionId}>
                <p className="text-sm">{t(isSessionsReady ? 'chat.sessionNoLongerExists' : 'common.loading')}</p>
              </div>
            </div>
            {sessionsBulkBar}
          </Panel>
        )
      }
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={sessionId} />
          {sessionsBulkBar}
        </Panel>
      )
    }
    // Focus mode or an explicitly added empty tile still offers a useful action.
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <EntityListEmptyScreen icon={<MessageSquarePlus />} title={t('session.noSessionSelected')} description={t('session.selectConversation')} className="h-full">
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            const params = navState.filter.kind === 'state' ? { status: navState.filter.stateId }
              : navState.filter.kind === 'label' ? { label: navState.filter.labelId } : undefined
            navigate(routes.action.newSession(params))
          }}>{t('session.newSession')}</Button>
        </EntityListEmptyScreen>
        {sessionsBulkBar}
      </Panel>
    )
  }

  // A stale route stays unavailable instead of falling back to session.selectConversation.
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div
        role="status"
        className="flex items-center justify-center h-full text-muted-foreground"
        data-testid="route-unavailable"
        data-route={navState.navigator === 'unavailable' ? navState.route : undefined}
      >
        {/* Unknown/stale deep links must not masquerade as an unrelated chat route. */}
        {navState.navigator === 'unavailable' && navState.reason === 'workspace-mismatch'
          && isSessionsNavigation(requestedNavState) && requestedNavState.details ? (
          <div data-testid="route-session-missing" data-route-entity={requestedNavState.details.sessionId}>
            <div data-testid="route-session-unavailable" data-session-id={requestedNavState.details.sessionId}>
              <p className="text-sm">{t('common.unavailable')}</p>
            </div>
          </div>
        ) : <p className="text-sm">{t('common.unavailable')}</p>}
      </div>
    </Panel>
  )
})
