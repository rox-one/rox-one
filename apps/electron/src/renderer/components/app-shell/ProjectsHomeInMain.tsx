import * as React from 'react'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ProjectsListPanel } from './ProjectsListPanel'
import { CreateProjectDialog } from '../projects/CreateProjectDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate as navigateRoute, routes } from '@/lib/navigate'
import {
  collectionFiltersAtom,
  collectionFilterKeyAtom,
} from '@/atoms/collection-filters'

/** Full-width Projects library (PagesHome pattern) when middle nav is hidden. */
export function ProjectsHomeInMain({
  projects,
  workspaceId,
}: {
  projects: NonNullable<ReturnType<typeof useAppShellContext>['projects']>
  workspaceId: string
}) {
  const { t } = useTranslation()
  const [createOpen, setCreateOpen] = useState(false)
  const setCollectionFilters = useSetAtom(collectionFiltersAtom)
  const setCollectionFilterKey = useSetAtom(collectionFilterKeyAtom)

  const openAdd = React.useCallback(() => {
    if (!workspaceId) return
    setCreateOpen(true)
  }, [workspaceId])

  const handleCreate = React.useCallback(
    async (name: string) => {
      if (!workspaceId) return
      setCreateOpen(false)
      try {
        const project = await window.electronAPI.createProject(workspaceId, { name })
        navigateRoute(routes.view.projects(project.slug))
      } catch (err) {
        console.error('[ProjectsHomeInMain] Failed to create project:', err)
        toast.error(t('projectsList.createFailed'))
      }
    },
    [workspaceId, t],
  )

  const handleJumpToSessions = React.useCallback(
    (projectId: string) => {
      setCollectionFilterKey('allSessions')
      setCollectionFilters(prev => ({
        ...prev,
        projectId: [projectId],
      }))
      navigateRoute(routes.view.allSessions())
    },
    [setCollectionFilters, setCollectionFilterKey],
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-sm font-medium">{t('sidebar.allProjects')}</span>
          <span className="text-xs text-foreground/40">{projects.length}</span>
        </div>
        <button
          type="button"
          onClick={openAdd}
          disabled={!workspaceId}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
        >
          {t('projectsList.addProject')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ProjectsListPanel
          projects={projects}
          workspaceId={workspaceId}
          onProjectClick={(slug) => navigateRoute(routes.view.projects(slug))}
          onAddProject={openAdd}
          onJumpToSessions={handleJumpToSessions}
          selectedProjectSlug={null}
          className="h-full"
        />
      </div>
      <CreateProjectDialog
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  )
}
