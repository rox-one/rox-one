/**
 * ProgressBar + PieProgress (W1-08, UI-SPEC §4 "PieProgress").
 *
 * - `ProgressBar`: horizontal bar with an accessible `progressbar` role.
 * - `PieProgress`: 16/20 px pie used by Operately targets and milestones.
 *
 * Values are clamped to 0–100. `done/total` takes precedence for the label.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { statusToneTextClass, type StatusTone } from '../status-badge/StatusBadge'

export interface ProgressValue {
  percent?: number
  done?: number
  total?: number
}

/** Resolve a 0–100 integer from percent or done/total (NaN-safe). */
export function resolveProgressPercent(value: ProgressValue): number {
  let raw: number | undefined
  if (typeof value.total === 'number' && value.total > 0 && typeof value.done === 'number') {
    raw = (value.done / value.total) * 100
  } else if (typeof value.percent === 'number') {
    raw = value.percent
  }
  if (raw === undefined || !Number.isFinite(raw)) return 0
  return Math.round(Math.min(100, Math.max(0, raw)))
}

export interface ProgressBarProps extends ProgressValue {
  tone?: StatusTone
  showLabel?: boolean
  className?: string
}

export function ProgressBar({ tone = 'info', showLabel = true, className, ...value }: ProgressBarProps) {
  const { t } = useTranslation()
  const percent = resolveProgressPercent(value)
  const label = typeof value.total === 'number' && value.total > 0 && typeof value.done === 'number'
    ? t('entities.ui.progress.count', { done: value.done, total: value.total })
    : t('entities.ui.progress.percent', { percent })
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        aria-label={t('entities.ui.progress.percent', { percent })}
        className="relative h-1.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
      >
        <div
          className={cn('h-full rounded-full bg-current transition-[width] duration-200 ease-out motion-reduce:transition-none', statusToneTextClass(tone))}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel ? <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{label}</span> : null}
    </div>
  )
}

export interface PieProgressProps extends ProgressValue {
  size?: 16 | 20
  tone?: StatusTone
  className?: string
}

export function PieProgress({ size = 16, tone = 'success', className, ...value }: PieProgressProps) {
  const { t } = useTranslation()
  const percent = resolveProgressPercent(value)
  const r = size / 2 - 1.5
  const c = 2 * Math.PI * r
  return (
    <svg
      role="img"
      aria-label={t('entities.ui.progress.percent', { percent })}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', statusToneTextClass(tone), className)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
