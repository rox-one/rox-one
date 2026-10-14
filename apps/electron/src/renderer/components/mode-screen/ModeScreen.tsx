/**
 * Shared kit for mode screens (Задачи / Встречи / Входящие / Лента):
 * navigator (220 px) → list (≈440 px) → detail. Flat and borderless — panels
 * are separated by background tone steps only; accent marks the active item,
 * counters and the primary action. Font is --font-sans (locally bundled Inter);
 * monospace only for code. High contrast: selection also gets an inset
 * accent bar and bold text, so it never relies on a subtle tint alone.
 */
import * as React from 'react'
import { ResponsiveModeScreenLayout, type ResponsiveModeScreen } from './ResponsiveModeScreen'
import type { PanelWorkspaceLayoutMode } from '@/lib/panel-workspace-layout'
import { cn } from '@/lib/utils'
import { ShellSidebarPortal, useShellSidebarTarget } from '@/components/app-shell/ShellSidebarPortal'
import { Tabs as TabsCore, type TabItem } from '@/components/ui/tabs'
import { useTranslation } from 'react-i18next'
import { Archive, Bell, CalendarBlank, CaretRight, Checks, Clock, Envelope, Folder, Funnel, Tray, ChatCircle, Newspaper, Radio, ShieldCheck, Sparkle, Tag, Users } from '@phosphor-icons/react'
import { navGlyph, type PhosphorIcon } from '@/platform/phosphor-glyphs'

export function ModeScreenLayout(props: {
  navigator: React.ReactNode; list: React.ReactNode; detail: React.ReactNode; status?: React.ReactNode
  testId?: string; wideList?: boolean; detailKey?: string | null; responsive?: ResponsiveModeScreen
  layout?: PanelWorkspaceLayoutMode
}) {
  const layout = props.layout ?? 'auto'
  return props.responsive
    ? <ResponsiveModeScreenLayout {...props} layout={layout} responsive={props.responsive} />
    : <FallbackModeScreenLayout {...props} layout={layout} />
}

function FallbackModeScreenLayout({
  navigator,
  list,
  detail,
  status,
  testId,
  wideList,
  detailKey,
  layout = 'auto',
}: {
  navigator: React.ReactNode
  list: React.ReactNode
  detail: React.ReactNode
  status?: React.ReactNode
  testId?: string
  /** List takes the free width (galleries); detail becomes a fixed side pane. */
  wideList?: boolean
  detailKey?: string | null
  layout?: PanelWorkspaceLayoutMode
}) {
  const { t } = useTranslation()
  const target = useShellSidebarTarget()
  const root = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(0)
  const [pane, setPane] = React.useState<'navigation' | 'list' | 'detail'>('list')
  React.useEffect(() => {
    if (!root.current) return
    const element = root.current
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element); setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  const narrowThreshold = target ? 640 : 860
  const measuredNarrow = width > 0 && width < narrowThreshold
  const emergencyNarrow = width > 0 && width < 480
  const focusDetail = layout === 'focus'
  const showNavigator = layout === 'auto' || layout === 'grid-3' || layout === 'columns'
  const narrow = layout === 'auto' ? measuredNarrow : layout === 'focus' ? false : emergencyNarrow
  React.useEffect(() => { if (detailKey !== undefined) setPane(detailKey ? 'detail' : 'list') }, [detailKey])
  const paneItems: TabItem[] = (['navigation', 'list', 'detail'] as const)
    .filter(item => item !== 'navigation' || !target)
    .map(item => ({ id: item, label: t(`navigation.modePanes.${item}`), title: t(`navigation.modePanes.${item}`) }))
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-background font-sans text-base text-foreground" data-testid={testId} data-mode-layout={layout}>
      {narrow && (
        <TabsCore
          items={paneItems}
          activeId={pane}
          variant="surface"
          density="compact"
          tone="accent"
          keyboard
          ariaLabel={t('navigation.openPanels')}
          className="shrink-0 gap-1 border-b border-border p-2"
          onSelect={(id) => setPane(id as typeof pane)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {showNavigator ? (
          <ShellSidebarPortal className={cn('shrink-0 gap-0.5 overflow-y-auto bg-surface-rail px-2 py-3', narrow ? pane === 'navigation' ? 'w-full' : 'hidden' : 'w-[220px]')}>
            {navigator}
          </ShellSidebarPortal>
        ) : null}
        {focusDetail ? (
          <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">{detail != null ? detail : list}</section>
        ) : detail == null ? (
          <section className="flex min-w-0 flex-1 flex-col bg-foreground/[0.025]">{list}</section>
        ) : wideList ? (
          <>
            <section className={cn('min-w-0 flex-1 flex-col bg-foreground/[0.025]', narrow && pane !== 'list' ? 'hidden' : 'flex')}>{list}</section>
            <section className={cn('min-w-0 flex-col overflow-y-auto bg-background', narrow ? pane === 'detail' ? 'flex flex-1' : 'hidden' : 'flex w-[320px] shrink-0')}>{detail}</section>
          </>
        ) : (
          <>
            <section className={cn('min-w-0 flex-col bg-foreground/[0.025]', narrow ? pane === 'list' ? 'flex flex-1' : 'hidden' : 'flex w-[440px] min-w-[240px] shrink')}>{list}</section>
            {/* The detail keeps a readable width; the list gives way first in narrow windows. */}
            <section className={cn('flex-1 flex-col overflow-y-auto bg-background', narrow ? pane === 'detail' ? 'flex min-w-0' : 'hidden' : 'flex min-w-[320px]')}>{detail}</section>
          </>
        )}
      </div>
      {status ? (
        <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-surface-rail px-3 py-1 text-xs text-text-muted" role="status">
          {status}
        </div>
      ) : null}
    </div>
  )
}

/** Screen-reader heading only: the shell's second-sidebar header already shows the screen title. */
export function NavTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="sr-only">{children}</h1>
}

export function NavSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <details open className="group mt-3 first:mt-0">
      <summary className="flex h-6 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-caption font-medium text-text-muted outline-none hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <CaretRight className="icon-status shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="flex flex-col gap-px pt-0.5">{children}</div>
    </details>
  )
}

/**
 * Compact secondary-sidebar row (Cursor-like): 28px tall, 13px text, bare 16px muted
 * Phosphor glyph and text on one grid, subtle rounded fill when active, no bar/underline.
 */
export const NAV_ROW_CLASS = 'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-body outline-none transition-colors motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-ring'
export const NAV_ROW_ACTIVE_CLASS = 'bg-[var(--state-selected)] text-foreground'
export const NAV_ROW_IDLE_CLASS = 'text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground'
/** Children of a nav group: indented so their glyphs line up with the parent's label. */
export const NAV_CHILDREN_CLASS = 'flex flex-col gap-px pl-6'

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const DOT: Record<Tone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-[var(--warning,#d9a13b)]',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-text-muted',
}

const NAV_ICONS: Record<string, PhosphorIcon> = {
  all: Tray, decisions: ShieldCheck, messages: ChatCircle, snoozed: Clock, done: Checks,
  permission: ShieldCheck, credential: ShieldCheck, plan: Funnel, memory: Sparkle,
  skill: Sparkle, sender: Users, reply: ChatCircle, error: Bell, mail: Envelope,
  news: Newspaper, subscriptions: Radio, team: Users, agents: Sparkle, sources: Folder,
  today: CalendarBlank, upcoming: CalendarBlank, past: Archive, live: Radio,
  needsAction: Bell, logbook: Checks, trash: Archive, inbox: Tray,
}

export function NavItem({
  label,
  count,
  active,
  dot,
  onClick,
  testId,
  disabled,
  icon,
}: {
  label: React.ReactNode
  count?: number | null
  active?: boolean
  /** Status hint: a small 6px dot on the glyph (any tone, incl. muted/accent); the glyph itself stays grey, no tile. */
  dot?: Tone
  onClick?: () => void
  testId?: string
  disabled?: boolean
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}) {
  const key = testId?.replace(/^(inbox|feed|tasks|meetings)-nav-/, '') ?? ''
  const Icon = (icon ? navGlyph(icon) : null) ?? (testId?.startsWith('mail-folder-') ? Envelope : NAV_ICONS[key]) ?? (typeof label === 'string' && label.startsWith('#') ? Tag : Funnel)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cn(NAV_ROW_CLASS, active ? NAV_ROW_ACTIVE_CLASS : NAV_ROW_IDLE_CLASS, disabled && 'opacity-50')}
    >
      <span className="relative inline-flex shrink-0">
        <Icon className={cn('icon-inline', active ? 'text-foreground' : 'text-text-muted')} aria-hidden />
        {dot ? <span aria-hidden data-nav-dot={dot} className={cn('absolute -right-0.5 -top-0.5 size-1.5 rounded-full', DOT[dot])} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count > 0 ? (
        <span className="shrink-0 numeric text-caption text-text-muted">{count}</span>
      ) : null}
    </button>
  )
}

export function ListHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-2 px-3 pt-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle ? <span className="truncate text-sm text-text-muted">{subtitle}</span> : null}
      {/* Wrap instead of overflowing: in a narrow list column the action row drops to its own
          line (and wraps internally) so a later button is never clipped by Panel's overflow-hidden. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">{actions}</div>
    </header>
  )
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-3 text-xs uppercase caps-label text-text-muted">{children}</div>
}

export function ListRow({
  selected,
  unread,
  onClick,
  children,
  testId,
  onKeyDown,
}: {
  selected?: boolean
  unread?: boolean
  onClick?: () => void
  children: React.ReactNode
  testId?: string
  onKeyDown?: React.KeyboardEventHandler
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        'mx-1.5 flex cursor-default items-start gap-2 rounded-[var(--radius-card)] border-l-2 border-transparent px-2 py-1.5 outline-none',
        selected ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.04]',
        (selected || unread) && 'border-l-accent',
      )}
    >
      {children}
    </div>
  )
}

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: React.ReactNode }) {
  const cls: Record<Tone, string> = {
    accent: 'bg-accent/15 text-accent',
    success: 'bg-success/15 text-success',
    warning: 'bg-[color-mix(in_oklch,var(--warning,#d9a13b)_18%,transparent)] text-[var(--warning,#d9a13b)]',
    danger: 'bg-destructive/15 text-destructive',
    info: 'bg-info/15 text-info',
    muted: 'bg-foreground/[0.07] text-text-secondary',
  }
  return <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-[var(--radius-control)] px-1.5 text-xs font-medium', cls[tone])}>{children}</span>
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm font-medium outline-none disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-[var(--accent-foreground,white)] hover:brightness-110',
        variant === 'secondary' && 'bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.11]',
        variant === 'danger' && 'bg-destructive/12 text-destructive hover:bg-destructive/20',
        variant === 'ghost' && 'text-text-secondary hover:bg-foreground/[0.06] hover:text-foreground',
        className,
      )}
    />
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number; icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  const items: TabItem[] = tabs.map((tab) => {
    const Icon = (tab.icon ? navGlyph(tab.icon) : null) ?? NAV_ICONS[tab.id] ?? Funnel
    return {
      id: tab.id,
      label: tab.label,
      title: tab.label,
      icon: <Icon className={cn('icon-caption', value === tab.id ? 'text-accent' : 'text-text-muted')} aria-hidden />,
      badge: tab.count ? <span className="numeric text-text-muted">{tab.count}</span> : undefined,
    }
  })
  return (
    <TabsCore
      items={items}
      activeId={value}
      variant="surface"
      density="full"
      tone="accent"
      keyboard
      ariaLabel={label}
      onSelect={(id) => onChange(id as T)}
    />
  )
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center rounded-[var(--radius-control)] px-2 text-sm outline-none',
        active ? 'bg-accent/15 font-semibold text-foreground' : 'bg-foreground/[0.05] text-text-secondary hover:bg-foreground/[0.09]',
      )}
    >
      {children}
    </button>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="pb-1.5 pt-4 text-xs uppercase caps-label text-text-muted">{children}</div>
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-[var(--radius-card)] bg-foreground/[0.04] p-3', className)}>{children}</div>
}

export function EmptyState({
  title,
  body,
  action,
  testId,
}: {
  title: React.ReactNode
  body?: React.ReactNode
  action?: React.ReactNode
  testId?: string
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-4 py-8" data-testid={testId} role="status">
      <div className="text-lg font-semibold">{title}</div>
      {body ? <div className="max-w-[420px] text-sm text-text-secondary">{body}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

/** J/K + ↑/↓ list navigation; returns a keydown handler for the list container. */
export function useListKeys<T>(items: readonly T[], selected: T | null, select: (item: T) => void, open?: (item: T) => void) {
  return React.useCallback((event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"]')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const index = selected == null ? -1 : items.indexOf(selected)
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      const next = items[Math.min(items.length - 1, index + 1)]
      if (next !== undefined) select(next)
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = items[Math.max(0, index - 1)]
      if (prev !== undefined) select(prev)
    } else if (event.key === 'Enter' && open && selected != null) {
      event.preventDefault()
      open(selected)
    }
  }, [items, selected, select, open])
}
