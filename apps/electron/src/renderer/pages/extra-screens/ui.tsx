/**
 * Flat, borderless building blocks shared by the extra workbench screens.
 * Only tone steps (foreground alpha) — no borders or separator lines; accent
 * is reserved for the active row, counters and the primary button. Colours
 * come from theme tokens so high-contrast themes keep working.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export function ScreenRoot({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 w-full bg-background text-[13px] text-foreground', className)}>
      {children}
    </div>
  )
}

/** Left list column (tone step 1). */
export function ScreenColumn({ children, className, width = 360 }: { children: React.ReactNode; className?: string; width?: number | string }) {
  return (
    <section
      className={cn('flex h-full min-h-0 shrink-0 flex-col bg-foreground/[0.03]', className)}
      style={{ width }}
    >
      {children}
    </section>
  )
}

/** Detail pane (tone step 0, scrollable). */
export function ScreenDetail({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5', className)}>{children}</section>
}

export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-2 px-4 pb-2 pt-3">
      <h1 className="text-[17px] font-bold leading-tight">{title}</h1>
      {subtitle != null && <span className="text-muted-foreground">{subtitle}</span>}
      <span className="flex-1" />
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}

export function ScreenButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  className,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent font-semibold text-[var(--accent-foreground,white)] hover:brightness-110',
        variant === 'default' && 'bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.11]',
        variant === 'danger' && 'bg-foreground/[0.07] text-destructive hover:bg-destructive/10',
        variant === 'ghost' && 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function GroupLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-4 pb-1 pt-3 text-[11px] uppercase tracking-[0.05em] text-muted-foreground', className)}>
      {children}
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] uppercase tracking-[0.05em] text-muted-foreground">{children}</div>
}

export function ListRow({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      className={cn(
        'relative mx-1.5 flex w-[calc(100%-12px)] items-start gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground',
        // HC: selection also gets an inset accent bar, not just a tint
        active ? 'bg-foreground/[0.08] before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-full before:bg-accent' : 'hover:bg-foreground/5',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Card({ children, accent, className }: { children: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={cn('mt-3 rounded-[8px] px-3.5 py-3', accent ? 'bg-accent/10' : 'bg-foreground/[0.04]', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-bold text-accent">{children}</div>
}

export function Chip({
  children,
  active,
  onClick,
  tone = 'neutral',
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
  tone?: 'neutral' | 'ok' | 'warn' | 'err'
}) {
  const cls = cn(
    'inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] px-2 py-0.5 text-[12px]',
    active
      ? 'bg-accent/10 text-accent'
      : tone === 'ok'
        ? 'bg-success/15 text-success'
        : tone === 'warn'
          ? 'bg-warning/15 text-warning'
          : tone === 'err'
            ? 'bg-destructive/15 text-destructive'
            : 'bg-foreground/[0.07] text-muted-foreground',
  )
  if (!onClick) return <span className={cls}>{children}</span>
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(cls, 'hover:text-foreground')}>
      {children}
    </button>
  )
}

export function Counter({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] text-muted-foreground">{children}</span>
}

export function EmptyState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[220px] w-full flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="text-[15px] font-bold text-foreground">{title}</div>
      {body && <div className="max-w-[440px] text-muted-foreground">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  onEnter,
  autoFocus,
  className,
  ariaLabel,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onEnter?: () => void
  onBlur?: () => void
  autoFocus?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter) {
          event.preventDefault()
          onEnter()
        }
      }}
      className={cn(
        'h-8 w-full rounded-[6px] bg-foreground/[0.06] px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground/60',
        className,
      )}
    />
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  ariaLabel?: string
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-y rounded-[6px] bg-foreground/[0.06] px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground/60"
    />
  )
}

/** «Sample data» is never shown in the product — this marks agent output instead. */
export function AgentOutput({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-foreground/90">{text}</div>
}
