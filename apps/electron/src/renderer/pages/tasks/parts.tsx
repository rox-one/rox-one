/**
 * Small building blocks of the Things-style Задачи screen: animated checkbox,
 * progress pie, overlay/confirm dialogs and a compact month calendar.
 * Flat, borderless panels; controls keep a 1.5px outline so they stay
 * visible in high-contrast themes.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function TaskCheckbox({
  checked,
  pending,
  cancelled,
  onToggle,
  label,
  size = 14,
  testId,
}: {
  checked: boolean
  pending?: boolean
  cancelled?: boolean
  onToggle: () => void
  label: string
  size?: number
  testId?: string
}) {
  const on = checked || pending
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      style={{ width: size, height: size }}
      className={cn(
        'mt-[1px] inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] outline-none transition-[background-color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-accent',
        on ? 'bg-accent text-[var(--accent-foreground,white)]' : 'shadow-[inset_0_0_0_1.5px_var(--text-muted,currentColor)] hover:shadow-[inset_0_0_0_1.5px_var(--accent)]',
        pending && 'scale-110',
      )}
    >
      {on ? (
        <svg viewBox="0 0 12 12" width={size - 4} height={size - 4} aria-hidden>
          {cancelled ? (
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M2.5 6.2l2.3 2.3L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={pending ? 'task-check-draw' : undefined} />
          )}
        </svg>
      ) : null}
    </button>
  )
}

/** Things-style project pie: ring + filled wedge for the completed share. */
export function ProgressPie({ done, total, size = 14, label }: { done: number; total: number; size?: number; label?: string }) {
  const r = size / 2 - 1.5
  const c = size / 2
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  const inner = r - 1.5
  let wedge: React.ReactNode = null
  if (ratio >= 1) wedge = <circle cx={c} cy={c} r={inner} fill="currentColor" />
  else if (ratio > 0) {
    const angle = ratio * Math.PI * 2 - Math.PI / 2
    const x = c + inner * Math.cos(angle)
    const y = c + inner * Math.sin(angle)
    const large = ratio > 0.5 ? 1 : 0
    wedge = <path d={`M${c},${c} L${c},${c - inner} A${inner},${inner} 0 ${large} 1 ${x},${y} Z`} fill="currentColor" />
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${done}/${total}`} className="shrink-0 text-accent">
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {wedge}
    </svg>
  )
}

export function Overlay({
  onClose,
  children,
  label,
  width = 520,
  testId,
  align = 'top',
}: {
  onClose: () => void
  children: React.ReactNode
  label: string
  width?: number
  testId?: string
  align?: 'top' | 'center'
}) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div
      className={cn('fixed inset-0 z-[80] flex justify-center bg-black/30 px-4', align === 'top' ? 'items-start pt-[12vh]' : 'items-center')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        style={{ width, maxWidth: '100%' }}
        className="flex max-h-[76vh] flex-col overflow-hidden rounded-[var(--radius-card)] bg-background font-sans text-[13px] text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.28),0_0_0_1px_color-mix(in_oklch,var(--foreground)_14%,transparent)]"
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = true,
}: {
  title: string
  body?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}) {
  const { t } = useTranslation()
  const confirmRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { confirmRef.current?.focus() }, [])
  return (
    <Overlay onClose={onCancel} label={title} width={400} align="center" testId="confirm-dialog">
      <div className="px-4 pb-3 pt-4">
        <div className="text-[15px] font-semibold">{title}</div>
        {body ? <div className="mt-1.5 text-[12px] text-text-secondary">{body}</div> : null}
      </div>
      <div className="flex justify-end gap-1.5 px-4 pb-4">
        <button type="button" onClick={onCancel} className="h-7 rounded-[var(--radius-control)] px-3 text-[12px] text-text-secondary hover:bg-foreground/[0.06]">
          {t('common.cancel')}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          data-testid="confirm-dialog-ok"
          className={cn(
            'h-7 rounded-[var(--radius-card)] px-3 text-[12px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent',
            danger ? 'bg-destructive text-white hover:brightness-110' : 'bg-accent text-[var(--accent-foreground,white)] hover:brightness-110',
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  )
}

/** Compact month grid; Monday-first for locales that use it. */
export function MiniCalendar({
  value,
  onPick,
  now,
  locale,
}: {
  value?: number
  onPick: (at: number) => void
  now: number
  locale: string
}) {
  const initial = new Date(value ?? now)
  const [month, setMonth] = React.useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1).getTime())
  const first = new Date(month)
  const mondayFirst = !/^en-US|^ja|^ko|^zh/i.test(locale) && !/^en$/i.test(locale)
  const offset = (first.getDay() - (mondayFirst ? 1 : 0) + 7) % 7
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < offset; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(first.getFullYear(), first.getMonth(), d).getTime())
  while (cells.length % 7) cells.push(null)
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
  const heads = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, (mondayFirst ? 1 : 7) + i)))
  const todayKey = new Date(now).toDateString()
  const valueKey = value != null ? new Date(value).toDateString() : ''
  const shift = (n: number) => setMonth(new Date(first.getFullYear(), first.getMonth() + n, 1).getTime())
  return (
    <div className="select-none" data-testid="mini-calendar">
      <div className="flex items-center justify-between px-1 pb-1">
        <button type="button" aria-label="‹" onClick={() => shift(-1)} className="size-6 rounded-[var(--radius-control)] text-text-secondary hover:bg-foreground/[0.07]">‹</button>
        <span className="text-[12px] font-semibold capitalize">{monthFmt.format(first)}</span>
        <button type="button" aria-label="›" onClick={() => shift(1)} className="size-6 rounded-[var(--radius-control)] text-text-secondary hover:bg-foreground/[0.07]">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {heads.map((head, i) => <div key={i} className="h-5 leading-5 text-text-muted">{head}</div>)}
        {cells.map((at, i) => at == null ? <div key={i} /> : (
          <button
            key={i}
            type="button"
            onClick={() => onPick(at)}
            className={cn(
              'h-6 rounded-[var(--radius-control)] tabular-nums outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-accent',
              new Date(at).toDateString() === valueKey && 'bg-accent font-semibold text-[var(--accent-foreground,white)] hover:bg-accent',
              new Date(at).toDateString() === todayKey && new Date(at).toDateString() !== valueKey && 'font-semibold text-accent',
              at < new Date(now).setHours(0, 0, 0, 0) && 'text-text-muted',
            )}
          >
            {new Date(at).getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Tiny inline icon glyphs (no icon font dependency; inherit currentColor). */
export const Glyph = {
  notes: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  ),
  repeat: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M2 5a3 3 0 0 1 3-3h4M8 0.8L9.5 2 8 3.2M10 7a3 3 0 0 1-3 3H3M4 11.2L2.5 10 4 8.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  bell: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M3 8.5V5.5a3 3 0 0 1 6 0v3l1 1H2zM5 10.5a1 1 0 0 0 2 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
  ),
  flag: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M3 11V1.5M3 2h6l-1.5 2L9 6H3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
  ),
  link: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M5 7l2-2M4.2 5.4L3 6.6a1.7 1.7 0 0 0 2.4 2.4l1.2-1.2M7.8 6.6L9 5.4A1.7 1.7 0 0 0 6.6 3L5.4 4.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
  ),
  star: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M6 1.2l1.4 3 3.2.3-2.4 2.1.8 3.2L6 8.1 3 9.8l.8-3.2L1.4 4.5l3.2-.3z" fill="currentColor" /></svg>
  ),
  search: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><circle cx="5" cy="5" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7.6 7.6L10.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden><path d="M9.5 7.5A4 4 0 0 1 4.5 2.5a4 4 0 1 0 5 5z" fill="currentColor" /></svg>
  ),
}
