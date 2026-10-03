import * as React from 'react'
import { ChevronLeft, Menu } from 'lucide-react'
import { ShellSidebarPortal, useShellSidebarTarget } from '@/components/app-shell/ShellSidebarPortal'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export interface ResponsiveModeScreen {
  selectedId: string | null
  onBack(): void
  backLabel: string
  navigationLabel: string
  detailLabel: string
}

/** Opt-in master/detail exchange measures this panel, independently of window width. */
export function ResponsiveModeScreenLayout({ navigator, list, detail, status, testId, responsive }: {
  navigator: React.ReactNode; list: React.ReactNode; detail: React.ReactNode; status?: React.ReactNode
  testId?: string; responsive: ResponsiveModeScreen
}) {
  const root = React.useRef<HTMLDivElement>(null)
  const listPane = React.useRef<HTMLElement>(null)
  const navigatorPane = React.useRef<HTMLDivElement>(null)
  const detailPane = React.useRef<HTMLElement>(null)
  const navigationTrigger = React.useRef<HTMLButtonElement>(null)
  const lastFocus = React.useRef<HTMLElement | null>(null)
  const lastSelection = React.useRef<string | null>(responsive.selectedId)
  const [narrow, setNarrow] = React.useState(false)
  const [navigationOpen, setNavigationOpen] = React.useState(false)
  const sidebarTarget = useShellSidebarTarget()
  React.useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setNarrow(element.getBoundingClientRect().width < 720)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    const focused = (event: FocusEvent) => {
      if (event.target !== document.body) lastFocus.current = root.current?.contains(event.target as Node) ? event.target as HTMLElement : null
    }
    const pointed = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) lastFocus.current = null }
    document.addEventListener('focusin', focused)
    document.addEventListener('pointerdown', pointed, true)
    return () => { document.removeEventListener('focusin', focused); document.removeEventListener('pointerdown', pointed, true) }
  }, [])
  React.useLayoutEffect(() => {
    const element = root.current
    if (!element || element.closest('[inert], [aria-hidden="true"]') || !element.getClientRects().length) return
    const active = document.activeElement
    const previous = active === document.body ? lastFocus.current : active
    const owned = element.contains(previous)
    if (responsive.selectedId) lastSelection.current = responsive.selectedId
    if (!owned || !narrow) return
    if (!sidebarTarget && navigatorPane.current?.contains(previous)) navigationTrigger.current?.focus({ preventScroll: true })
    if (responsive.selectedId && listPane.current?.contains(previous)) detailPane.current?.focus({ preventScroll: true })
    if (!responsive.selectedId && detailPane.current?.contains(previous)) {
      const row = Array.from(element.querySelectorAll<HTMLElement>('[data-task-id]')).find(item => item.dataset.taskId === lastSelection.current)
      ;(row?.querySelector<HTMLElement>('[role="option"]') ?? listPane.current)?.focus({ preventScroll: true })
    }
  }, [narrow, responsive.selectedId, sidebarTarget])
  React.useEffect(() => { if (!narrow) setNavigationOpen(false) }, [narrow])
  const hasDetail = narrow && responsive.selectedId !== null
  return <div ref={root} data-testid={testId} data-responsive-mode="true" data-narrow={narrow} className="flex h-full min-h-0 min-w-0 flex-col bg-background font-sans text-[13px] text-foreground">
    {narrow && (!sidebarTarget || hasDetail) ? <div className="flex shrink-0 items-center gap-2 bg-surface-rail p-2">
      {hasDetail ? <button type="button" onClick={() => { lastFocus.current = detailPane.current; responsive.onBack() }} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"><ChevronLeft className="size-4" aria-hidden />{responsive.backLabel}</button> : null}
      {!sidebarTarget ? <button ref={navigationTrigger} type="button" onClick={() => setNavigationOpen(true)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"><Menu className="size-4" aria-hidden />{responsive.navigationLabel}</button> : null}
    </div> : null}
    <div className="flex min-h-0 min-w-0 flex-1">
      <div ref={navigatorPane} hidden={narrow && !sidebarTarget} className="flex shrink-0" style={narrow && !sidebarTarget ? { display: 'none' } : undefined}><ShellSidebarPortal className="w-[220px] shrink-0 gap-0.5 overflow-y-auto bg-surface-rail px-2 py-3">{navigator}</ShellSidebarPortal></div>
      <section ref={listPane} tabIndex={-1} hidden={hasDetail} data-mode-pane="list" className={narrow || detail == null ? 'flex min-w-0 flex-1 flex-col bg-foreground/[0.025] outline-none' : 'flex w-[440px] min-w-[240px] shrink flex-col bg-foreground/[0.025] outline-none'} style={hasDetail ? { display: 'none' } : undefined}>{list}</section>
      {detail != null ? <section ref={detailPane} tabIndex={-1} hidden={narrow && !hasDetail} aria-label={responsive.detailLabel} data-mode-pane="detail" className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background outline-none" style={narrow && !hasDetail ? { display: 'none' } : undefined}>{detail}</section> : null}
    </div>
    {status ? <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-2 bg-surface-rail px-3 text-[11px] text-text-muted" role="status">{status}</div> : null}
    <Dialog open={navigationOpen && narrow && !sidebarTarget} onOpenChange={setNavigationOpen}>
      <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => {
        event.preventDefault()
        const element = root.current, active = document.activeElement
        if (!element || element.closest('[inert], [aria-hidden="true"]') || !element.getClientRects().length) return
        if (active === document.body || element.contains(active) || active?.closest('[role="dialog"]')) navigationTrigger.current?.focus({ preventScroll: true })
      }} className="max-h-[80vh] max-w-sm overflow-y-auto" onClick={event => { if ((event.target as HTMLElement).closest('button[data-testid^="tasks-nav-"]')) setNavigationOpen(false) }}>
        <DialogTitle>{responsive.navigationLabel}</DialogTitle>{navigator}
      </DialogContent>
    </Dialog>
  </div>
}
