import * as React from 'react'
import { TourPanelScope, useTourSignals } from '@/features/product-tour/runtime/hooks'
import { navigationEntity } from '@/features/product-tour/runtime/routes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MemoryScreen } from '../memory/MemoryScreen'
import { ProjectsHomeInMain } from './ProjectsHomeInMain'
import { MultiSelectPanel } from './MultiSelectPanel'
import { CollectionBulkBar } from './collection/CollectionBulkBar'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isMemoryNavigation,
  isTasksNavigation,
  isMeetingsNavigation,
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
  isCloudRunNavigation,
  isTerminalNavigation,
} from '@/contexts/NavigationContext'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { isScreenNavigation } from '../../../shared/types'
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

const RouteRecoveryContext = React.createContext<object>({})

/** Cache across suspended renders; replace the promise only for a new attempt. */
export function lazyRoutePage<Component extends React.ComponentType<any>>(loadPage: () => Promise<{ default: Component }>) {
  const attempts = new WeakMap<object, React.LazyExoticComponent<Component>>()
  return function LazyRoutePage(props: React.ComponentProps<Component>) {
    const scope = React.useContext(RouteRecoveryContext)
    let LazyPage = attempts.get(scope)
    if (!LazyPage) {
      LazyPage = React.lazy(loadPage)
      attempts.set(scope, LazyPage)
    }
    const Page = LazyPage as React.ComponentType<React.ComponentProps<Component>>
    return <Page {...props} />
  }
}

class RouteErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: (retry: () => void) => React.ReactNode
}, { failed: boolean; attempt: number; scope: object }> {
  state = { failed: false, attempt: 0, scope: {} }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  private retry = () => {
    this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1, scope: {} }))
  }

  render() {
    if (this.state.failed) return this.props.fallback(this.retry)
    return (
      <RouteRecoveryContext.Provider value={this.state.scope}>
        <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
      </RouteRecoveryContext.Provider>
    )
  }
}

const SearchPage = lazyRoutePage(() => import('@/pages/SearchPage'))
const NotesPage = lazyRoutePage(() => import('@/pages/NotesPage'))
const ConnectionsPage = lazyRoutePage(() => import('@/pages/ConnectionsPage'))
const ExtraScreenHost = lazyRoutePage(() => import('@/pages/extra-screens/ExtraScreenHost'))
const TasksPage = lazyRoutePage(() => import('@/pages/TasksPage'))
const MeetingsPage = lazyRoutePage(() => import('@/pages/MeetingsPage'))
const InboxPage = lazyRoutePage(() => import('@/pages/InboxPage'))
const FeedPage = lazyRoutePage(() => import('@/pages/FeedPage'))
const KnowledgeEntityPage = lazyRoutePage(() => import('@/pages/KnowledgeEntityPage'))
const SkillInfoPage = lazyRoutePage(() => import('@/pages/SkillInfoPage'))
const SourceInfoPage = lazyRoutePage(() => import('@/pages/SourceInfoPage'))
const ProjectInfoPage = lazyRoutePage(() => import('@/pages/ProjectInfoPage'))
const BrowserPanelPage = lazyRoutePage(() => import('@/pages/BrowserPanelPage'))
const ExtensionSurfacePage = lazyRoutePage(() => import('@/pages/ExtensionSurfacePage'))
const TerminalSurfacePage = lazyRoutePage(() => import('@/pages/TerminalSurfacePage'))
const CloudRunSurfacePage = lazyRoutePage(() => import('@/pages/CloudRunSurfacePage'))
const PagesHome = lazyRoutePage(() =>
  import('../pages/PagesHome').then((m) => ({ default: m.PagesHome })),
)
const KanbanBoardContainer = lazyRoutePage(() =>
  import('./kanban/KanbanBoardContainer').then((m) => ({ default: m.KanbanBoardContainer })),
)
const SessionTableHost = lazyRoutePage(() =>
  import('./session-table/SessionTableHost').then((m) => ({ default: m.SessionTableHost })),
)
const AutomationEditor = lazyRoutePage(() =>
  import('../automations/AutomationEditor').then((m) => ({ default: m.AutomationEditor })),
)
const KnowledgeDiff = lazyRoutePage(() =>
  import('../../knowledge/KnowledgeDiff').then((m) => ({ default: m.KnowledgeDiff })),
)
const KnowledgeHome = lazyRoutePage(() =>
  import('../../knowledge/KnowledgeHome').then((m) => ({ default: m.KnowledgeHome })),
)
const KnowledgeProposals = lazyRoutePage(() =>
  import('../../knowledge/KnowledgeProposals').then((m) => ({ default: m.KnowledgeProposals })),
)

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
  const [state, setState] = useState<{ identity: string; status: SelectedResourceStatus }>({
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
    const load = async () => {
      const request = ++revision
      setState({ identity, status: 'loading' })
      try {
        const exists = kind === 'source'
          ? (await api.getSources(workspaceId)).some((source) => source.config.slug === slug)
          : (await api.getSkills(workspaceId, workingDirectory)).some((skill) => skill.slug === slug)
        if (active && request === revision) setState({ identity, status: exists ? 'ready' : 'missing' })
      } catch {
        if (active && request === revision) setState({ identity, status: 'unavailable' })
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
          void load()
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
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    sessionStatuses,
    projects,
    loadedProjects,
    labels,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const visibleSessionIds = useMemo(
    () =>
      [...sessionMetaMap.values()]
        .filter((meta) => !activeWorkspaceId || meta.workspaceId === activeWorkspaceId)
        .map((meta) => meta.id),
    [sessionMetaMap, activeWorkspaceId],
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
  // Keep session hosts mounted when only their list filter changes. A different
  // entity/workspace must start with fresh state, including pending async work.
  const routeIdentity = JSON.stringify([
    activeWorkspaceId, navState.navigator,
    isScreenNavigation(navState) ? navState.screen : null,
    isSettingsNavigation(navState) ? navState.subpage : null,
    isSessionsNavigation(navState) ? navState.viewMode : null,
    'details' in navState ? navState.details : null,
  ])

  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const pageFallback = (
    <Panel variant="grow" className={className}>
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    </Panel>
  )

  const wrapWithStoplight = (content: React.ReactNode) => (
    <TourPanelScope workspaceId={activeWorkspaceId ?? ''} panelId={panelId ?? 'shell'} {...navigationEntity(navState)}>
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      <RouteErrorBoundary key={routeIdentity} fallback={(retry) => (
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
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
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
        <div className="flex items-center justify-center h-full text-muted-foreground">
          {/* Detail pane placeholder; the list owns the real «none configured» state. */}
          <p className="text-sm">{t("sourcesList.selectSource")}</p>
        </div>
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
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("skillsList.selectSkill")}</p>
        </div>
      </Panel>
    )
  }

  if (isMemoryNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <MemoryScreen workspaceId={activeWorkspaceId ?? undefined} />
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

  if (isTasksNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <TasksPage selectedId={navState.details?.taskId ?? null} />
      </Panel>
    )
  }

  if (isMeetingsNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <MeetingsPage selectedId={navState.details?.meetingId ?? null} />
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
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
          {sessionsBulkBar}
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.noSessionSelected")}</p>
        </div>
        {sessionsBulkBar}
      </Panel>
    )
  }

  // Historical regression sentinel: terminal/cloud-run precede the generic
  // branch that formerly rendered session.selectConversation.
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div
        role="status"
        className="flex items-center justify-center h-full text-muted-foreground"
        data-testid="route-unavailable"
      >
        {/* Unknown/stale deep links must not masquerade as an unrelated chat route. */}
        <p className="text-sm">{t('common.unavailable')}</p>
      </div>
    </Panel>
  )
}
