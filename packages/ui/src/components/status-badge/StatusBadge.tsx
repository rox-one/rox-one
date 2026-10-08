/**
 * StatusBadge (W1-08, UI-SPEC §2 "Status badge colours", ADR-U07).
 *
 * Operately status wording on Rox status tokens. Two sizes:
 * - `sm`: chip (tinted pill with icon + label), used in headers and rows;
 * - `xs`: dot + label, used inside dense lists.
 *
 * Colour comes only from `--status-*` tokens, so light/dark themes and both
 * UI profiles work without branching.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

export const STATUS_BADGE_KEYS = [
  'on_track',
  'caution',
  'off_track',
  'pending',
  'outdated',
  'paused',
  'achieved',
  'completed',
  'missed',
] as const

export type StatusBadgeKey = (typeof STATUS_BADGE_KEYS)[number]

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Spec table: key → Rox status token + glyph. */
export const STATUS_BADGE_SPEC: Record<StatusBadgeKey, { tone: StatusTone; glyph: '●' | '⏸' | '✓' | '✕' }> = {
  on_track: { tone: 'success', glyph: '●' },
  caution: { tone: 'warning', glyph: '●' },
  off_track: { tone: 'danger', glyph: '●' },
  pending: { tone: 'info', glyph: '●' },
  outdated: { tone: 'neutral', glyph: '●' },
  paused: { tone: 'neutral', glyph: '⏸' },
  achieved: { tone: 'success', glyph: '✓' },
  completed: { tone: 'success', glyph: '✓' },
  missed: { tone: 'danger', glyph: '✕' },
}

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  info: 'text-status-info',
  neutral: 'text-status-neutral',
}

const TONE_CHIP: Record<StatusTone, string> = {
  success: 'bg-[color-mix(in_oklch,var(--status-success)_12%,transparent)]',
  warning: 'bg-[color-mix(in_oklch,var(--status-warning)_12%,transparent)]',
  danger: 'bg-[color-mix(in_oklch,var(--status-danger)_12%,transparent)]',
  info: 'bg-[color-mix(in_oklch,var(--status-info)_12%,transparent)]',
  neutral: 'bg-[color-mix(in_oklch,var(--status-neutral)_12%,transparent)]',
}

export function isStatusBadgeKey(value: unknown): value is StatusBadgeKey {
  return typeof value === 'string' && (STATUS_BADGE_KEYS as readonly string[]).includes(value)
}

/** Tailwind text class for a status tone (shared with ProgressBar / Gantt bars). */
export function statusToneTextClass(tone: StatusTone): string {
  return TONE_TEXT[tone]
}

export interface StatusBadgeProps {
  status: StatusBadgeKey
  size?: 'sm' | 'xs'
  className?: string
}

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const { t } = useTranslation()
  const spec = STATUS_BADGE_SPEC[status]
  const label = t(`entities.ui.status.${status}`)
  return (
    <span
      title={t('entities.ui.status.label', { status: label })}
      data-status={status}
      data-size={size}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium',
        size === 'sm' ? cn('h-5 rounded-full px-2 text-[11px]', TONE_CHIP[spec.tone]) : 'h-4 text-[11px]',
        TONE_TEXT[spec.tone],
        className,
      )}
    >
      <span aria-hidden="true" className={size === 'xs' && spec.glyph === '●' ? 'text-[8px] leading-none' : 'text-[10px] leading-none'}>
        {spec.glyph}
      </span>
      <span className={size === 'xs' ? 'text-text-secondary' : undefined}>{label}</span>
    </span>
  )
}
