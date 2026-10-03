import * as React from 'react'
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

const SearchPage = React.lazy(() => import('@/pages/SearchPage'))
const NotesPage = React.lazy(() => import('@/pages/NotesPage'))
const ConnectionsPage = React.lazy(() => import('@/pages/ConnectionsPage'))
const ExtraScreenHost = React.lazy(() => import('@/pages/extra-screens/ExtraScreenHost'))
const TasksPage = React.lazy(() => import('@/pages/TasksPage'))
const MeetingsPage = React.lazy(() => import('@/pages/MeetingsPage'))
const InboxPage = React.lazy(() => import('@/pages/InboxPage'))
const FeedPage = React.lazy(() => import('@/pages/FeedPage'))
const KnowledgeEntityPage = React.lazy(() => import('@/pages/KnowledgeEntityPage'))
const SkillInfoPage = React.lazy(() => import('@/pages/SkillInfoPage'))
const SourceInfoPage = React.lazy(() => import('@/pages/SourceInfoPage'))
const ProjectInfoPage = React.lazy(() => import('@/pages/ProjectInfoPage'))
const BrowserPanelPage = React.lazy(() => import('@/pages/BrowserPanelPage'))
const ExtensionSurfacePage = React.lazy(() => import('@/pages/ExtensionSurfacePage'))
const TerminalSurfacePage = React.lazy(() => import('@/pages/TerminalSurfacePage'))
const CloudRunSurfacePage = React.lazy(() => import('@/pages/CloudRunSurfacePage'))
const PagesHome = React.lazy(() =>
  import('../pages/PagesHome').then((m) => ({ default: m.PagesHome })),
)
const KanbanBoardContainer = React.lazy(() =>
  import('./kanban/KanbanBoardContainer').then((m) => ({ default: m.KanbanBoardContainer })),
)
const SessionTableHost = React.lazy(() =>
  import('./session-table/SessionTableHost').then((m) => ({ default: m.SessionTableHost })),
)
const AutomationEditor = React.lazy(() =>
  import('../automations/AutomationEditor').then((m) => ({ default: m.AutomationEditor })),
)
const KnowledgeDiff = React.lazy(() =>
  import('../../knowledge/KnowledgeDiff').then((m) => ({ default: m.KnowledgeDiff })),
)
const KnowledgeHome = React.lazy(() =>
  import('../../knowledge/KnowledgeHome').then((m) => ({ default: m.KnowledgeHome })),
)
const KnowledgeProposals = React.lazy(() =>
  import('../../knowledge/KnowledgeProposals').then((m) => ({ default: m.KnowledgeProposals })),
)

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

  // Detail state belongs to its workspace and entity, including project-level skills.
  const routeKey = JSON.stringify([
    activeWorkspaceId,
    navState.navigator,
    'details' in navState ? navState.details : null,
    isSettingsNavigation(navState) ? navState.subpage : null,
    isScreenNavigation(navState) ? navState.screen : null,
    navState.navigator === 'search' ? navState.query : null,
    isSkillsNavigation(navState) ? activeSessionWorkingDirectory : null,
  ])
  const selectedSourceSlug = isSourcesNavigation(navState) ? navState.details?.sourceSlug : undefined
  const selectedSkillSlug = isSkillsNavigation(navState) && navState.details?.type === 'skill'
    ? navState.details.skillSlug : undefined
  const [missingEntity, setMissingEntity] = useState<{ routeKey: string; missing: boolean } | null>(null)
  useEffect(() => {
    setMissingEntity(null)
    if (!activeWorkspaceId || (!selectedSourceSlug && !selectedSkillSlug)) return
    let cancelled = false
    // These snapshots are authoritative only for the selected workspace. Keep the
    // route selected after deletion so its missing state survives subsequent events.
    const cleanup = selectedSourceSlug
      ? window.electronAPI?.onSourcesChanged?.((workspaceId, sources) => {
        if (cancelled || workspaceId !== activeWorkspaceId) return
        setMissingEntity({ routeKey, missing: !sources.some(source => source.config.slug === selectedSourceSlug) })
      })
      : window.electronAPI?.onSkillsChanged?.((workspaceId, skills) => {
        if (cancelled || workspaceId !== activeWorkspaceId) return
        setMissingEntity({ routeKey, missing: !skills.some(skill => skill.slug === selectedSkillSlug) })
      })
    return () => { cancelled = true; cleanup?.() }
  }, [activeWorkspaceId, selectedSourceSlug, selectedSkillSlug, routeKey])
  const selectedEntityMissing = missingEntity?.routeKey === routeKey && missingEntity.missing

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
    <StoplightProvider key={routeKey} value={isSidebarAndNavigatorHidden}>
      <React.Suspense fallback={pageFallback}>
        {content}
      </React.Suspense>
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
  )

  const missingEntityPanel = (family: 'source' | 'skill', message: string) => wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div
        role="status"
        className="flex h-full items-center justify-center text-muted-foreground"
        data-testid="route-entity-missing"
        data-route-family={family}
      >
        <p className="text-sm">{message}</p>
      </div>
    </Panel>,
  )

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
      if (selectedEntityMissing) return missingEntityPanel('source', t('sourceInfo.notFound'))
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
      if (selectedEntityMissing) return missingEntityPanel('skill', t('skillInfo.notFound'))
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

  // A stale route stays unavailable instead of falling back to session.selectConversation.
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div
        className="flex items-center justify-center h-full text-muted-foreground"
        data-testid="route-unavailable"
      >
        {/* Unknown/stale deep links must not masquerade as an unrelated chat route. */}
        <p className="text-sm">{t('common.unavailable')}</p>
      </div>
    </Panel>
  )
}
