/**
 * Shared ActivityRail row (main destinations, «Ещё» screens, collapse toggle).
 * Expanded: full-width 28px row, 16px icon + label, radius 6, gap 8 (4px grid).
 * Collapsed: 28×28 icon button with a right-side tooltip carrying the label.
 * Active = --state-selected-strong fill + a static 2px accent marker in both
 * states; focus comes from the global :focus-visible system (no local ring).
 */
import type { ComponentType } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'

export interface RailRowProps {
  icon: ComponentType<{ className?: string }>
  label: string
  /** Tooltip text; defaults to the label. Always shown when collapsed. */
  tooltip?: string
  collapsed: boolean
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  /** Dimmed default text (secondary rail groups, e.g. the mode list). */
  muted?: boolean
  testId?: string
}

/**
 * One rail row. Expanded: 28px row, 16px icon + label (truncated), radius 6.
 * Collapsed: 28×28 icon button with a right-side tooltip carrying the label.
 * Active = selected-strong fill + a static accent marker (never motion alone).
 */
export function RailRow({ icon: Icon, label, tooltip, collapsed, active, disabled, onClick, muted, testId }: RailRowProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      data-testid={testId}
      data-rail-row=""
      className={cn(
        'rox-rail-row relative flex min-h-[var(--control-hit-min)] shrink-0 items-center rounded-[var(--radius-control)] text-base leading-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        collapsed ? 'w-[var(--control-hit-min)] justify-center' : 'w-full gap-[8px] px-[8px] text-left',
        disabled
          ? 'cursor-not-allowed text-[var(--text-disabled)]'
          : active
            ? cn(
                'bg-[var(--state-selected-strong)] font-medium text-accent',
                "before:absolute before:rounded-full before:bg-accent before:content-['']",
                collapsed
                  ? 'before:bottom-[2px] before:left-1/2 before:h-[var(--state-marker-width)] before:w-[var(--state-marker-height)] before:-translate-x-1/2'
                  : 'before:left-0 before:top-1/2 before:h-[var(--state-marker-height)] before:w-[var(--state-marker-width)] before:-translate-y-1/2',
              )
            : muted
              ? 'text-[var(--text-muted)] hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]'
              : 'text-[var(--chrome-label)] hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <Icon className={collapsed ? 'icon-rail' : 'icon-toolbar'} />
      {!collapsed && <span className="min-w-0 flex-1 truncate label-tracking" title={label}>{label}</span>}
    </button>
  )

  const tip = tooltip ?? label
  // Expanded rows already show the label: a tooltip only when it adds info
  // (e.g. the disabled reason). Collapsed rows always carry the label tooltip.
  if (!collapsed && tip === label) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">{tip}</TooltipContent>
    </Tooltip>
  )
}