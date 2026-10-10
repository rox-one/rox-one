import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * One chip on the composer deck's 28 px control row (G5 «диалог», composer deck).
 *
 * The chip carries an axis label and, in its value slot, either a plain value
 * (the chip itself is the control) or the REAL selector via `children` (then
 * the chip is a `div` shell and the child owns interaction). Only Rox tokens:
 * `h-7`, `--text-caption`, `--radius-control`, `--motion-fast`.
 */
export interface DeckChipProps {
  /** Axis name, e.g. «Модель». Never truncated. */
  label: string
  /** Leading glyph. Decorative, token-coloured. */
  icon?: React.ReactNode
  /** Plain value shown when no `children` control is embedded. */
  value?: string
  /** Trailing adornment (chevron, count). */
  trailing?: React.ReactNode
  /** Error tone for the folder/attachment axes. */
  tone?: 'default' | 'error'
  disabled?: boolean
  /** Keyboard order within the deck row (tray → chips → trailing actions). */
  focusOrder?: number
  onClick?: () => void
  /** `div` when a real control renders inside the value slot. */
  as?: 'button' | 'div'
  /** Embedded control (the value slot) — CompactModelSelector etc. */
  children?: React.ReactNode
  className?: string
  'data-tutorial'?: string
}

export function DeckChip({
  label,
  icon,
  value,
  trailing,
  tone = 'default',
  disabled,
  focusOrder,
  onClick,
  as: Tag = 'button',
  children,
  className,
  'data-tutorial': dataTutorial,
}: DeckChipProps) {
  const classes = cn(
    'inline-flex h-7 max-w-[260px] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2 text-caption transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
    tone === 'error'
      ? 'border-status-danger/50 text-[var(--destructive-text)]'
      : 'border-border-subtle bg-surface-elevated text-text-secondary',
    !disabled && Tag === 'button' && 'hover:bg-surface-hover hover:text-text-primary',
    'focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring',
    disabled && 'opacity-45',
    className,
  )

  const inner = (
    <>
      {icon && <span aria-hidden className="shrink-0 text-text-muted">{icon}</span>}
      <span className="shrink-0 text-text-secondary">{label}</span>
      <span aria-hidden className="text-text-muted">:</span>
      {children ?? <span className="min-w-0 truncate font-medium text-text-primary" title={value}>{value}</span>}
      {trailing && <span className="shrink-0 text-text-muted">{trailing}</span>}
    </>
  )

  if (Tag === 'div') {
    return (
      <div
        data-g05-chip={label}
        data-focus-order={focusOrder}
        className={classes}
      >
        {inner}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-g05-chip={label}
      data-focus-order={focusOrder}
      data-tutorial={dataTutorial}
      disabled={disabled}
      onClick={onClick}
      className={classes}
    >
      {inner}
    </button>
  )
}