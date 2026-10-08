import { useState, lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { useStore } from 'jotai'
import { Calendar, CalendarDays, Contact, Gavel, Phone, type LucideIcon } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import { useAction } from '@/actions'
import { usePanelWorkspaceLayout } from '@/hooks/usePanelWorkspaceLayout'
import { routes } from '@/lib/navigate'
import { formatHotkeyDisplay } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { workspaceProjectContextsAtom } from '@/atoms/workspace-context'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '@/lib/open-workspace-tool'
import { ShellSidebarPortal } from '@/components/app-shell/ShellSidebarPortal'
import { WorkspacePlanView } from './WorkspacePlanView'
import type { ExtraScreenId } from '../../../shared/extra-screens'
const Meetings = lazy(() => import('@/pages/MeetingsPage'))
const ExtraScreenHost = lazy(() => import('@/pages/extra-screens/ExtraScreenHost'))

/** Sections stay inside the plan module — Досье/Решения render in the content
 * column instead of navigating to the `screen` module (which unmounted the page
 * and emptied the sidebar context block). */
type PlanSection = 'calendar' | 'meetings' | 'dossier' | 'decisions'

/** The section survives module switches so returning to «Встречи» reopens it. */
const SECTION_STORAGE_KEY = 'craft-meetings-plan-section'
const PLAN_SECTIONS: readonly PlanSection[] = ['calendar', 'meetings', 'dossier', 'decisions']
/** ⌥⌘ 4…5: Досье/Решения own no global chord; ⌥⌘1/2 (calendar/meetings) are
 * taken over on the focus-zone actions below, ⌥⌘3 (Звонки) stays unbound. */
const SECTION_HOTKEYS: Record<string, PlanSection> = {
  '4': 'dossier', '5': 'decisions',
}

function readStoredSection(fallback: PlanSection): PlanSection {
  try {
    const raw = window.localStorage.getItem(SECTION_STORAGE_KEY)
    return PLAN_SECTIONS.find(value => value === raw) ?? fallback
  } catch {
    return fallback
  }
}

export default function PlanWorkspacePage({ selectedId }: { selectedId?: string | null }) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { mode } = usePanelWorkspaceLayout()
  const store = useStore()
  const projects = useAtomValue(workspaceProjectContextsAtom)
  const [section, setSection] = useState<PlanSection>(() => selectedId ? 'meetings' : readStoredSection('calendar'))
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
  useEffect(() => { try { window.localStorage.setItem(SECTION_STORAGE_KEY, section) } catch { /* localStorage may be unavailable */ } }, [section])
  // ⌥⌘1/⌥⌘2 reuse the focus-zone chords while this surface owns them: a
  // higher-priority handler wins (Tasks ⌘N precedent), so the section switches
  // instead of a focus move the sidebar tabs make redundant. Unmount restores
  // the focus-zone behaviour.
  useAction('nav.focusSidebar', () => setSection('calendar'), { priority: 10 })
  useAction('nav.focusNavigator', () => setSection('meetings'), { priority: 10 })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.shiftKey) return
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const next = SECTION_HOTKEYS[event.key]
      if (!next) return
      event.preventDefault()
      setSection(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  if (!activeWorkspaceId) return null

  const tabs: ReadonlyArray<{ key: string; section: PlanSection | null; icon: LucideIcon; labelKey: string; hotkey: string }> = [
    { key: 'calendar', section: 'calendar', icon: CalendarDays, labelKey: 'navigation.planSections.calendar', hotkey: 'mod+alt+1' },
    { key: 'meetings', section: 'meetings', icon: Calendar, labelKey: 'navigation.planSections.meetings', hotkey: 'mod+alt+2' },
    { key: 'calls', section: null, icon: Phone, labelKey: 'navigation.planSections.calls', hotkey: 'mod+alt+3' },
    { key: 'dossier', section: 'dossier', icon: Contact, labelKey: 'extraScreens.dossier.title', hotkey: 'mod+alt+4' },
    { key: 'decisions', section: 'decisions', icon: Gavel, labelKey: 'extraScreens.decisions.title', hotkey: 'mod+alt+5' },
  ]
  const selectableTabs = tabs.filter(tab => tab.section !== null)

  // auto keeps the tab switch; focus shows the active section alone; the grid modes place calendar and meetings side by side once the pane is wide enough (below 720px the two columns cannot hold their minimum widths, so they fall back to the single-section tabs).
  const extraScreen: ExtraScreenId | null = section === 'dossier' || section === 'decisions' ? section : null
  const sideBySide = !extraScreen && (mode === 'grid-2' || mode === 'columns' || mode === 'grid-3') && width >= 720
  const calendar = <WorkspacePlanView workspaceId={activeWorkspaceId} projectId={projects[activeWorkspaceId] ?? undefined} onOpenTask={id => {
    const intent = captureWorkspaceToolOpen(store, { workspaceId: activeWorkspaceId,
      projectId: projects[activeWorkspaceId] ?? undefined, tool: 'tasks' })
    if (intent) openWorkspaceTool(store, intent, routes.view.tasks(id))
  }} />
  const meetings = <Suspense fallback={<div role="status">{t('common.loading')}</div>}><Meetings selectedId={selectedId} /></Suspense>
  return <div ref={root} data-mode-layout={mode} className="flex h-full min-h-0 min-w-0 flex-col">
    <ShellSidebarPortal className="flex min-h-[var(--chrome-panel-header-height)] shrink-0 flex-wrap items-center gap-1 p-2">
      <div role="tablist" aria-label={t('navigation.work.plan.title')} className="flex flex-wrap items-center gap-1">
        {tabs.map(tab => {
          const Icon = tab.icon
          const selectable = tab.section !== null
          const active = selectable && section === tab.section
          return <button type="button" key={tab.key} role={selectable ? 'tab' : undefined} disabled={!selectable}
            aria-selected={selectable ? active : undefined} aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            title={`${t(tab.labelKey)} · ${formatHotkeyDisplay(tab.hotkey)}`}
            onClick={() => tab.section && setSection(tab.section)}
            onKeyDown={event => {
              if (!selectable) return
              const at = selectableTabs.findIndex(entry => entry.section === tab.section)
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1
                : event.key === 'Home' ? -at : event.key === 'End' ? selectableTabs.length - 1 - at : 0
              if (!step) return
              event.preventDefault()
              const next = selectableTabs[(at + step + selectableTabs.length) % selectableTabs.length]
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[(at + step + selectableTabs.length) % selectableTabs.length]?.focus()
              if (next.section) setSection(next.section)
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2.5 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active ? 'bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground',
              !selectable && 'cursor-not-allowed text-text-muted opacity-60',
            )}>
            <Icon className={cn('size-3.5', active ? 'text-accent' : 'text-text-muted')} aria-hidden />
            {t(tab.labelKey)}
            {!selectable ? <span className="text-text-muted"> · {t('navigation.soon')}</span> : null}
          </button>
        })}
      </div>
    </ShellSidebarPortal>
    {extraScreen ? <div className="min-h-0 min-w-0 flex-1">
      <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-muted-foreground">{t('common.loading')}</div>}>
        <ExtraScreenHost screen={extraScreen} itemId={null} />
      </Suspense>
    </div> : sideBySide ? <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2">
      <section aria-label={t('navigation.planSections.calendar')} className="flex min-h-0 min-w-0 flex-col border-r border-border">
        <h2 className="shrink-0 border-b border-border/60 px-3 py-2 text-caption font-medium uppercase tracking-wide text-text-muted">{t('navigation.planSections.calendar')}</h2>
        <div className="min-h-0 flex-1">{calendar}</div>
      </section>
      <section aria-label={t('navigation.planSections.meetings')} className="flex min-h-0 min-w-0 flex-col">
        <h2 className="shrink-0 border-b border-border/60 px-3 py-2 text-caption font-medium uppercase tracking-wide text-text-muted">{t('navigation.planSections.meetings')}</h2>
        <div className="min-h-0 flex-1">{meetings}</div>
      </section>
    </div> : <div className="min-h-0 flex-1">
      {section === 'calendar' ? calendar : meetings}
    </div>}
  </div>
}