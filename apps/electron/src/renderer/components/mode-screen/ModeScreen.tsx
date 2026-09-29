/**
 * Shared kit for mode screens (Задачи / Встречи / Входящие / Лента):
 * navigator (220 px) → list (≈440 px) → detail. Flat and borderless — panels
 * are separated by background tone steps only; accent marks the active item,
 * counters and the primary action. Font is --font-sans (Arial Narrow);
 * monospace only for code. High contrast: selection also gets an inset
 * accent bar and bold text, so it never relies on a subtle tint alone.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export function ModeScreenLayout({
  navigator,
  list,
  detail,
  status,
  testId,
}: {
  navigator: React.ReactNode
  list: React.ReactNode
  detail: React.ReactNode
  status?: React.ReactNode
  testId?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background font-sans text-[13px] text-foreground" data-testid={testId}>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-surface-rail px-2 py-3">
          {navigator}
        </nav>
        <section className="flex w-[440px] min-w-[240px] shrink flex-col bg-foreground/[0.025]">{list}</section>
        {/* The detail keeps a readable width; the list gives way first in narrow windows. */}
        <section className="flex min-w-[320px] flex-1 flex-col overflow-y-auto bg-background">{detail}</section>
      </div>
      {status ? (
        <div className="flex h-7 shrink-0 items-center gap-2 bg-surface-rail px-3 text-[11px] text-text-muted" role="status">
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
    <div className="mt-3 flex flex-col gap-0.5">
      <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-text-muted">{title}</div>
      {children}
    </div>
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

export function NavItem({
  label,
  count,
  active,
  dot,
  onClick,
  testId,
  disabled,
}: {
  label: React.ReactNode
  count?: number | null
  active?: boolean
  dot?: Tone
  onClick?: () => void
  testId?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] outline-none',
        active
          ? 'bg-accent/15 font-semibold text-foreground shadow-[inset_2px_0_0_var(--accent)]'
          : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground',
        disabled && 'opacity-50',
      )}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[dot])} /> : null}
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
        'mx-1.5 flex cursor-default items-start gap-2 rounded-[6px] px-2 py-1.5 outline-none',
        selected ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.04]',
        (selected || unread) && 'shadow-[inset_2px_0_0_var(--accent)]',
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
  tabs: ReadonlyArray<{ id: T; label: React.ReactNode; count?: number }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[12px] outline-none',
            value === tab.id ? 'bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05]',
          )}
        >
          {tab.label}
          {tab.count ? <span className="tabular-nums text-text-muted">{tab.count}</span> : null}
        </button>
      ))}
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
