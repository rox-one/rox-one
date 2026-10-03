/**
 * Shared ActivityRail row (main destinations, «Ещё» screens, collapse toggle).
 * Expanded: full-width 28px row, 16px icon + label, radius 6, gap 8 (4px grid).
 * Collapsed: 28×28 icon button with a right-side tooltip carrying the label.
 * Active = accent tint + accent text in both states; no borders.
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
  muted?: boolean
  testId?: string
}

/**
 * One rail row. Expanded: 28px row, 16px icon + label (truncated), radius 6.
 * Collapsed: 28×28 icon button with a right-side tooltip carrying the label.
 * Active = accent tint + accent text (same token in both states).
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
        'rox-rail-row flex h-[28px] shrink-0 items-center rounded-[6px] text-[13px] leading-none transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        collapsed ? 'w-[28px] justify-center' : 'w-full gap-[8px] px-[8px] text-left',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/40'
          : active
            ? 'bg-accent/10 text-accent font-medium'
            : muted
              ? 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon className="h-[16px] w-[16px] shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
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
