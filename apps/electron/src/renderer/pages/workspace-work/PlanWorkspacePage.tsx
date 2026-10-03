import { useState, lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { useStore } from 'jotai'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { workspaceProjectContextsAtom } from '@/atoms/workspace-context'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '@/lib/open-workspace-tool'
import { ShellSidebarPortal } from '@/components/app-shell/ShellSidebarPortal'
import { WorkspacePlanView } from './WorkspacePlanView'
const Meetings = lazy(() => import('@/pages/MeetingsPage'))

export default function PlanWorkspacePage({ selectedId }: { selectedId?: string | null }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { activeWorkspaceId } = useAppShellContext()
  const store = useStore()
  const projects = useAtomValue(workspaceProjectContextsAtom)
  const [section, setSection] = useState<'calendar' | 'meetings'>(selectedId ? 'meetings' : 'calendar')
  useEffect(() => { if (selectedId) setSection('meetings') }, [selectedId])
  if (!activeWorkspaceId) return null
  return <div className="flex h-full min-h-0 flex-col">
    <ShellSidebarPortal className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      {(['calendar', 'meetings'] as const).map(value => <button type="button" key={value} aria-current={section === value ? 'page' : undefined}
        className={`rounded px-3 py-2 text-left text-sm ${section === value ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}
        onClick={() => { setSection(value); if (value === 'calendar') void navigate(routes.view.meetings(), { primary: true, skipAutoSelect: true }) }}>{t(`navigation.planSections.${value}`)}</button>)}
      <button type="button" disabled className="rounded px-3 py-2 text-left text-sm text-muted-foreground/60">{t('navigation.planSections.calls')} · {t('navigation.soon')}</button>
      <button type="button" className="rounded px-3 py-2 text-left text-sm" onClick={() => { void navigate(routes.view.screen('dossier'), { primary: true }) }}>{t('extraScreens.dossier.title')}</button>
      <button type="button" className="rounded px-3 py-2 text-left text-sm" onClick={() => { void navigate(routes.view.screen('decisions'), { primary: true }) }}>{t('extraScreens.decisions.title')}</button>
    </ShellSidebarPortal>
    <div className="min-h-0 flex-1">
      {section === 'calendar' ? <WorkspacePlanView workspaceId={activeWorkspaceId} projectId={projects[activeWorkspaceId] ?? undefined} onOpenTask={id => {
        const intent = captureWorkspaceToolOpen(store, { workspaceId: activeWorkspaceId,
          projectId: projects[activeWorkspaceId] ?? undefined, tool: 'tasks' })
        if (intent) openWorkspaceTool(store, intent, routes.view.tasks(id))
      }} /> : <Suspense fallback={<div role="status">{t('common.loading')}</div>}><Meetings selectedId={selectedId} /></Suspense>}
    </div>
  </div>
}
