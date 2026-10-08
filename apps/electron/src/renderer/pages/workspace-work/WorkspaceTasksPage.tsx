import { useState, useEffect, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { useWorkspaceProjectContext } from '@/atoms/workspace-context'
import { ShellSidebarContext } from '@/components/app-shell/ShellSidebarPortal'
import { WorkspaceTasksView } from './WorkspaceTasksView'

const PersonalTasks = lazy(() => import('@/pages/TasksPage'))
export default function WorkspaceTasksPage({ selectedId }: { selectedId?: string | null }) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const projectId = useWorkspaceProjectContext(activeWorkspaceId)
  const [scope, setScope] = useState<'personal' | 'workspace'>(selectedId?.startsWith('task_') ? 'workspace' : 'personal')
  useEffect(() => { if (selectedId) setScope(selectedId.startsWith('task_') ? 'workspace' : 'personal') }, [selectedId])
  return <div className="flex h-full min-h-0 flex-col">
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-foreground/5 px-3 py-2">
      {(['personal', 'workspace'] as const).map(value => <button role="tab" type="button" key={value} aria-selected={scope === value} onClick={() => setScope(value)} className={`rounded px-3 py-1.5 text-xs ${scope === value ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>{t(`navigation.taskScopes.${value}`)}</button>)}
    </div>
    <div className="min-h-0 flex-1">
      <ShellSidebarContext.Provider value={null}>
        <Suspense fallback={<div role="status">{t('common.loading')}</div>}>
          {scope === 'personal' ? <PersonalTasks selectedId={selectedId} /> : activeWorkspaceId && <WorkspaceTasksView workspaceId={activeWorkspaceId} projectId={projectId} selectedTaskId={selectedId ?? undefined} />}
        </Suspense>
      </ShellSidebarContext.Provider>
    </div>
  </div>
}
