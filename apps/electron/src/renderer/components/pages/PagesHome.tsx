import * as React from 'react'
import { PanelsTopLeft, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '@/lib/open-workspace-tool'
import { workspaceProjectContextsAtom } from '@/atoms/workspace-context'
import { pagesContextFilter, pagesCreationProject, pagesFilterContextKeyAtom, pagesProjectContext } from '@/lib/pages-project-context'
import { pagesAtom, pagesProjectFilterAtom, PAGES_UNASSIGNED_PROJECT } from '@/atoms/pages'
import { projectsAtom } from '@/atoms/projects'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import {
  ProjectMultiSelectFilter,
  type ProjectFilterOption,
} from '../app-shell/ProjectMultiSelectFilter'
import { PageTile, type PageTileProject } from './PageTile'
import { DeletePageDialog } from './DeletePageDialog'
import type { LoadedPage } from '@rox/shared/pages/types'

/**
 * Pages library — the full-width home grid (mirrors the Kanban board pane).
 * Header carries the controlled Project filter (with an Unassigned sentinel)
 * and the New Page action; tiles open the embedded page render.
 */
export function PagesHome() {
  const { activeWorkspaceId, onCreateSession, onInputChange, panelId } = useAppShellContext()
  const store = useStore()
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const pages = useAtomValue(pagesAtom)
  const projects = useAtomValue(projectsAtom)
  const [projectFilter, setProjectFilter] = useAtom(pagesProjectFilterAtom)
  const [workspaceProjects, setWorkspaceProjects] = useAtom(workspaceProjectContextsAtom)
  const [syncedContextKey, setSyncedContextKey] = useAtom(pagesFilterContextKeyAtom)
  const selectedProjectId = activeWorkspaceId ? workspaceProjects[activeWorkspaceId] ?? null : null
  const [pendingDelete, setPendingDelete] = React.useState<LoadedPage | null>(null)

  // External workspace/project choices update this library without navigating
  // an open page. Keep advanced multi/unassigned filters when echoing our own change.
  const projectContextKey = JSON.stringify([activeWorkspaceId, selectedProjectId])
  React.useEffect(() => {
    if (syncedContextKey === projectContextKey) return
    setSyncedContextKey(projectContextKey)
    setProjectFilter(pagesContextFilter(selectedProjectId))
  }, [projectContextKey, selectedProjectId, syncedContextKey, setSyncedContextKey, setProjectFilter])

  const changeProjectFilter = React.useCallback((ids: string[]) => {
    setProjectFilter(ids)
    if (!activeWorkspaceId) return
    const projectId = pagesProjectContext(ids, PAGES_UNASSIGNED_PROJECT)
    setSyncedContextKey(JSON.stringify([activeWorkspaceId, projectId]))
    setWorkspaceProjects(current => ({ ...current, [activeWorkspaceId]: projectId }))
  }, [activeWorkspaceId, setProjectFilter, setSyncedContextKey, setWorkspaceProjects])

  const projectOptions = React.useMemo<ProjectFilterOption[]>(
    () => projects.map(p => ({ id: p.config.id, name: p.config.name, color: p.config.color })),
    [projects],
  )

  const projectsById = React.useMemo(() => {
    const map = new Map<string, PageTileProject>()
    for (const project of projects) {
      map.set(project.config.id, { name: project.config.name, color: project.config.color })
    }
    return map
  }, [projects])

  const visiblePages = React.useMemo(() => {
    let list = pages
    if (projectFilter.length > 0) {
      const allow = new Set(projectFilter)
      list = pages.filter(page => {
        const projectId = page.config.projectId
        if (projectId === undefined) return allow.has(PAGES_UNASSIGNED_PROJECT)
        return allow.has(projectId)
      })
    }
    return [...list].sort((a, b) => b.config.updatedAt - a.config.updatedAt)
  }, [pages, projectFilter])

  const openPage = React.useCallback(
    (slug: string) => navigate(routes.view.pages(slug)),
    [navigate],
  )

  // Blank page, bound to the first selected (real) project so it stays
  // visible under an active filter — mirrors the board's create behavior.
  const handleCreatePage = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    const boundProjectId = pagesCreationProject(projectFilter, projects.map(project => project.config.id))
    if (projectFilter.some(id => id !== PAGES_UNASSIGNED_PROJECT) && !boundProjectId) {
      toast.error(t('navigation.notes.scopeCreateUnavailable'))
      return
    }
    try {
      const created = await window.electronAPI.createPage(activeWorkspaceId, {
        name: t('pages.newPage'),
        kind: 'interactive',
        ...(boundProjectId ? { projectId: boundProjectId } : {}),
      })
      navigate(routes.view.pages(created.slug))
    } catch (err) {
      toast.error(t('toast.pageCreateFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [activeWorkspaceId, projectFilter, projects, t, navigate])

  const [askingAgent, setAskingAgent] = React.useState(false)
  const handleAskAgent = React.useCallback(async () => {
    if (!activeWorkspaceId || askingAgent) return
    const projectId = pagesCreationProject(projectFilter, projects.map(project => project.config.id)) ?? selectedProjectId ?? undefined
    if (projectId && !projects.some(project => project.config.id === projectId)) {
      toast.error(t('navigation.notes.scopeCreateUnavailable'))
      return
    }
    const intent = captureWorkspaceToolOpen(store, { workspaceId: activeWorkspaceId, projectId, tool: 'agent', originPanelId: panelId })
    if (!intent) return
    setAskingAgent(true)
    try {
      const created = await onCreateSession(activeWorkspaceId, { projectId })
      onInputChange(created.id, t('pages.askAgentPrompt'))
      openWorkspaceTool(store, intent, routes.view.allSessions(created.id))
    } catch (error) {
      toast.error(t('common.error'), { description: error instanceof Error ? error.message : String(error) })
    } finally { setAskingAgent(false) }
  }, [activeWorkspaceId, askingAgent, projectFilter, projects, selectedProjectId, store, panelId, onCreateSession, onInputChange, t])

  const handleConfirmDelete = React.useCallback(async () => {
    if (!activeWorkspaceId || !pendingDelete) return
    const { slug, name } = pendingDelete.config
    setPendingDelete(null)
    try {
      const result = await window.electronAPI.deletePage(activeWorkspaceId, slug)
      if (result?.publicCopyMayRemain) {
        toast.warning(t('toast.pageDeleted', { name }), {
          description: t('toast.pagePublicCopyMayRemain'),
        })
      } else {
        toast.success(t('toast.pageDeleted', { name }))
      }
    } catch (err) {
      toast.error(t('toast.pageDeleteFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [activeWorkspaceId, pendingDelete, t])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Sticky header: title + count, project filter, primary action */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-sm font-medium">{t('sidebar.pages')}</span>
          <span className="text-xs text-foreground/40">{pages.length}</span>
          {(projectOptions.length > 0 || projectFilter.length > 0) && (
            <ProjectMultiSelectFilter
              projects={projectOptions}
              value={projectFilter}
              onChange={changeProjectFilter}
              unassignedId={PAGES_UNASSIGNED_PROJECT}
            />
          )}
        </div>
        <button
          type="button"
          onClick={handleCreatePage}
          disabled={!activeWorkspaceId}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-foreground/[0.06] px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.1] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('pages.newPage')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <EntityListEmptyScreen
            icon={<PanelsTopLeft />}
            title={t('pages.emptyTitle')}
            description={t('pages.emptyDescription')}
          >
            <button
              onClick={() => { void handleAskAgent() }}
              disabled={askingAgent}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-foreground/[0.02] px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.05]"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t('pages.askAgent')}
            </button>
            <button
              onClick={handleCreatePage}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-foreground/[0.02] px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.05]"
            >
              <Plus className="h-3.5 w-3.5" /> {t('pages.createBlank')}
            </button>
          </EntityListEmptyScreen>
        ) : visiblePages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground/50">
            {t('pages.noMatches')}
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-5">
            {visiblePages.map(page => (
              <PageTile
                key={page.config.id}
                page={page}
                project={page.config.projectId ? projectsById.get(page.config.projectId) : undefined}
                onOpen={() => openPage(page.config.slug)}
                onDelete={() => setPendingDelete(page)}
              />
            ))}
          </div>
        )}
      </div>

      <DeletePageDialog
        pageName={pendingDelete?.config.name ?? null}
        shared={Boolean(pendingDelete?.config.share)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
