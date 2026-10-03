/**
 * Shared kit for mode screens (Задачи / Встречи / Входящие / Лента):
 * navigator (220 px) → list (≈440 px) → detail. Flat and borderless — panels
 * are separated by background tone steps only; accent marks the active item,
 * counters and the primary action. Font is --font-sans (Arial Narrow);
 * monospace only for code. High contrast: selection also gets an inset
 * accent bar and bold text, so it never relies on a subtle tint alone.
 */
import * as React from 'react'
import { ResponsiveModeScreenLayout, type ResponsiveModeScreen } from './ResponsiveModeScreen'
import { cn } from '@/lib/utils'
import { ShellSidebarPortal, useShellSidebarTarget } from '@/components/app-shell/ShellSidebarPortal'
import { useTranslation } from 'react-i18next'
import { Archive, Bell, CalendarDays, CheckCheck, ChevronRight, Clock3, Folder, Inbox, ListFilter, Mail, MessageCircle, Newspaper, Radio, ShieldCheck, Sparkles, Tag, Users, type LucideIcon } from 'lucide-react'

export function ModeScreenLayout(props: {
  navigator: React.ReactNode; list: React.ReactNode; detail: React.ReactNode; status?: React.ReactNode
  testId?: string; wideList?: boolean; detailKey?: string | null; responsive?: ResponsiveModeScreen
}) {
  return props.responsive
    ? <ResponsiveModeScreenLayout {...props} responsive={props.responsive} />
    : <FallbackModeScreenLayout {...props} />
}

function FallbackModeScreenLayout({
  navigator,
  list,
  detail,
  status,
  testId,
  wideList,
  detailKey,
}: {
  navigator: React.ReactNode
  list: React.ReactNode
  detail: React.ReactNode
  status?: React.ReactNode
  testId?: string
  /** List takes the free width (galleries); detail becomes a fixed side pane. */
  wideList?: boolean
  detailKey?: string | null
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
  const narrow = width > 0 && width < (target ? 640 : 860)
  React.useEffect(() => { if (detailKey !== undefined) setPane(detailKey ? 'detail' : 'list') }, [detailKey])
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-background font-sans text-[13px] text-foreground" data-testid={testId}>
      {narrow && <div role="tablist" aria-label={t('navigation.openPanels')} className="flex shrink-0 gap-1 border-b border-border p-2">
        {(['navigation', 'list', 'detail'] as const).filter(item => item !== 'navigation' || !target).map(item => <button type="button" role="tab" key={item} aria-selected={pane === item} onClick={() => setPane(item)} className={cn('rounded px-2 py-1 text-xs', pane === item && 'bg-accent/10 text-accent')}>{t(`navigation.modePanes.${item}`)}</button>)}
      </div>}
      <div className="flex min-h-0 flex-1">
        <ShellSidebarPortal className={cn('shrink-0 gap-0.5 overflow-y-auto bg-surface-rail px-2 py-3', narrow ? pane === 'navigation' ? 'w-full' : 'hidden' : 'w-[220px]')}>
          {navigator}
        </ShellSidebarPortal>
        {detail == null ? (
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
        <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-surface-rail px-3 py-1 text-[11px] text-text-muted" role="status">
          {status}
        </div>
      ) : null}
    </div>
  )
}

export function NavTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="px-2 pb-2 text-[15px] font-semibold">{children}</h1>
}

export function NavSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <details open className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />{title}
      </summary>
      <div className="ml-2 flex flex-col gap-0.5 border-l border-foreground/10 pl-2 py-1">{children}</div>
    </details>
  )
}

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const DOT: Record<Tone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-[var(--warning,#d9a13b)]',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-text-muted',
}

const NAV_ICONS: Record<string, LucideIcon> = {
  all: Inbox, decisions: ShieldCheck, messages: MessageCircle, snoozed: Clock3, done: CheckCheck,
  permission: ShieldCheck, credential: ShieldCheck, plan: ListFilter, memory: Sparkles,
  skill: Sparkles, sender: Users, reply: MessageCircle, error: Bell, mail: Mail,
  news: Newspaper, subscriptions: Radio, team: Users, agents: Sparkles, sources: Folder,
  today: CalendarDays, upcoming: CalendarDays, past: Archive, live: Radio,
  needsAction: Bell, logbook: CheckCheck, trash: Archive, inbox: Inbox,
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
  dot?: Tone
  onClick?: () => void
  testId?: string
  disabled?: boolean
  icon?: LucideIcon
}) {
  const key = testId?.replace(/^(inbox|feed|tasks|meetings)-nav-/, '') ?? ''
  const Icon = icon ?? (testId?.startsWith('mail-folder-') ? Mail : NAV_ICONS[key]) ?? (typeof label === 'string' && label.startsWith('#') ? Tag : ListFilter)
  const iconTone = dot ?? (key.includes('mail') ? 'info' : key.includes('today') ? 'warning' : 'accent')
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-lg border-l-2 border-transparent px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
        active
          ? 'border-l-accent bg-accent/15 font-semibold text-foreground'
          : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground',
        disabled && 'opacity-50',
      )}
    >
      <span className={cn('relative grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.05]', {
        'text-accent': iconTone === 'accent', 'text-info': iconTone === 'info',
        'text-success': iconTone === 'success', 'text-destructive': iconTone === 'danger',
        'text-[var(--warning,#d9a13b)]': iconTone === 'warning', 'text-text-muted': iconTone === 'muted',
      })}>
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
        {dot ? <span aria-hidden className={cn('absolute -right-0.5 -top-0.5 size-1.5 rounded-full', DOT[dot])} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count > 0 ? (
        <span className={cn('shrink-0 tabular-nums text-[11px]', active ? 'text-accent' : 'text-text-muted')}>{count}</span>
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
    <header className="flex min-h-[44px] shrink-0 items-center gap-2 px-3 pt-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {subtitle ? <span className="truncate text-[12px] text-text-muted">{subtitle}</span> : null}
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </header>
  )
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-wide text-text-muted">{children}</div>
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
        'mx-1.5 flex cursor-default items-start gap-2 rounded-[6px] border-l-2 border-transparent px-2 py-1.5 outline-none',
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
  return <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-1.5 text-[11px] font-medium', cls[tone])}>{children}</span>
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
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium outline-none disabled:opacity-50',
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
  tabs: ReadonlyArray<{ id: T; label: React.ReactNode; count?: number; icon?: LucideIcon }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-1">
      {tabs.map((tab, index) => {
        const Icon = tab.icon ?? NAV_ICONS[tab.id] ?? ListFilter
        return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          tabIndex={value === tab.id ? 0 : -1}
          aria-selected={value === tab.id}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
            if (next === null) return
            event.preventDefault()
            onChange(tabs[next]!.id)
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}
          onClick={() => onChange(tab.id)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[12px] outline-none',
            value === tab.id ? 'bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05]',
          )}
        >
          <Icon className={cn('size-3.5', value === tab.id ? 'text-accent' : 'text-text-muted')} aria-hidden />
          {tab.label}
          {tab.count ? <span className="tabular-nums text-text-muted">{tab.count}</span> : null}
        </button>
        )
      })}
    </div>
  )
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center rounded-[6px] px-2 text-[12px] outline-none',
        active ? 'bg-accent/15 font-semibold text-foreground' : 'bg-foreground/[0.05] text-text-secondary hover:bg-foreground/[0.09]',
      )}
    >
      {children}
    </button>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="pb-1.5 pt-4 text-[11px] uppercase tracking-wide text-text-muted">{children}</div>
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-[8px] bg-foreground/[0.04] p-3', className)}>{children}</div>
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
      <div className="text-[14px] font-semibold">{title}</div>
      {body ? <div className="max-w-[420px] text-[12px] text-text-secondary">{body}</div> : null}
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
