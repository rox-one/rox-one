import { useState, lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { useStore } from 'jotai'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { usePanelWorkspaceLayout } from '@/hooks/usePanelWorkspaceLayout'
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
  const { mode } = usePanelWorkspaceLayout()
  const store = useStore()
  const projects = useAtomValue(workspaceProjectContextsAtom)
  const [section, setSection] = useState<'calendar' | 'meetings'>(selectedId ? 'meetings' : 'calendar')
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (selectedId) setSection('meetings') }, [selectedId])
  if (!activeWorkspaceId) return null
  // auto keeps the tab switch; focus shows the active section alone; the grid modes place calendar and meetings side by side once the pane is wide enough (below 720px the two columns cannot hold their minimum widths, so they fall back to the single-section tabs).
  const sideBySide = (mode === 'grid-2' || mode === 'columns' || mode === 'grid-3') && width >= 720
  const calendar = <WorkspacePlanView workspaceId={activeWorkspaceId} projectId={projects[activeWorkspaceId] ?? undefined} onOpenTask={id => {
    const intent = captureWorkspaceToolOpen(store, { workspaceId: activeWorkspaceId,
      projectId: projects[activeWorkspaceId] ?? undefined, tool: 'tasks' })
    if (intent) openWorkspaceTool(store, intent, routes.view.tasks(id))
  }} />
  const meetings = <Suspense fallback={<div role="status">{t('common.loading')}</div>}><Meetings selectedId={selectedId} /></Suspense>
  return <div ref={root} data-mode-layout={mode} className="flex h-full min-h-0 min-w-0 flex-col">
    <ShellSidebarPortal className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      {(['calendar', 'meetings'] as const).map(value => <button type="button" key={value} aria-current={section === value ? 'page' : undefined}
        className={`rounded px-3 py-2 text-left text-sm ${section === value ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}
        onClick={() => { setSection(value); if (value === 'calendar') void navigate(routes.view.meetings(), { primary: true, skipAutoSelect: true }) }}>{t(`navigation.planSections.${value}`)}</button>)}
      <button type="button" disabled className="rounded px-3 py-2 text-left text-sm text-muted-foreground/60">{t('navigation.planSections.calls')} · {t('navigation.soon')}</button>
      <button type="button" className="rounded px-3 py-2 text-left text-sm" onClick={() => { void navigate(routes.view.screen('dossier'), { primary: true }) }}>{t('extraScreens.dossier.title')}</button>
      <button type="button" className="rounded px-3 py-2 text-left text-sm" onClick={() => { void navigate(routes.view.screen('decisions'), { primary: true }) }}>{t('extraScreens.decisions.title')}</button>
    </ShellSidebarPortal>
    {sideBySide ? <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2">
      <section aria-label={t('navigation.planSections.calendar')} className="flex min-h-0 min-w-0 flex-col border-r border-border">
        <h2 className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">{t('navigation.planSections.calendar')}</h2>
        <div className="min-h-0 flex-1">{calendar}</div>
      </section>
      <section aria-label={t('navigation.planSections.meetings')} className="flex min-h-0 min-w-0 flex-col">
        <h2 className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">{t('navigation.planSections.meetings')}</h2>
        <div className="min-h-0 flex-1">{meetings}</div>
      </section>
    </div> : <div className="min-h-0 flex-1">
      {section === 'calendar' ? calendar : meetings}
    </div>}
  </div>
}