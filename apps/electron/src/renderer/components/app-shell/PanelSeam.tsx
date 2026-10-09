/**
 * PanelSeam (G6 «Пути») — the seam between two panels.
 *
 * Wraps the shared `ResizeHandle` (role="separator", 8px / 24px-coarse hit
 * band, keyboard map, drag gradient) and adds the one thing the shipped seam
 * lacked: a *visible grip* that appears on hover / focus / drag, so the seam
 * reads as a draggable object instead of a hairline.
 *
 * The wrapper carries the geometry and the inner handle fills it, so the hit
 * band (and every resize computation in PanelResizeSash) is unchanged.
 *
 * Wave 2 (`featurePanelSwapV1Atom`): when the swap grip is supplied the seam
 * also carries a 28px `PanelSwapGripButton` that starts a panel-swap drag. The
 * grip only renders when a caller asks for it, so a seam without the flag is
 * byte-identical to the resize-only version.
 */
import * as React from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ResizeHandle, type ResizeHandleProps } from './ResizeHandle'

/** Which flank of the seam the grip drags; the caller resolves it to a panel id. */
export type PanelSwapSide = 'left' | 'right'

export interface PanelSwapGripButtonProps {
  /** Accessible name for the grip ("Поменять панели местами"). */
  gripLabel: string
  /** Accessible name while there is no sibling to trade with. */
  blockedLabel?: string
  /** This grip's panel is the one currently being dragged. */
  active?: boolean
  /** No sibling to trade with — `aria-disabled`, not focusable, not draggable. */
  disabled?: boolean
  /**
   * `hover` reveals the grip when the seam is hovered/focused (used inside
   * `PanelSeam`); `always` keeps a subtle knob readable for grid overlays.
   */
  reveal?: 'hover' | 'always'
  /** Pointer started on the grip: the caller begins the swap drag. */
  onDragStart?: (event: React.PointerEvent<HTMLButtonElement>) => void
  /** Enter/Space on the focused grip: the caller swaps with the neighbour. */
  onActivate?: () => void
  className?: string
  style?: React.CSSProperties
  /** Which neighbour this grip trades with (rendered as a data attribute). */
  'data-panel-swap-side'?: PanelSwapSide
}

/**
 * The swap grip itself. It is a real 28×28 button (the pointer target), while
 * the visible knob stays inside the seam band. It is absolutely positioned by
 * the caller so the same button can sit in a `PanelSeam` (hover reveal) or in
 * `PanelStackContainer`'s grid overlay (always reveal).
 */
export function PanelSwapGripButton({
  gripLabel,
  blockedLabel,
  active = false,
  disabled = false,
  reveal = 'always',
  onDragStart,
  onActivate,
  className,
  style,
  'data-panel-swap-side': swapSide,
}: PanelSwapGripButtonProps) {
  const accessibleLabel = disabled ? blockedLabel ?? gripLabel : gripLabel
  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-panel-swap-grip="true"
      data-panel-swap-side={swapSide}
      data-panel-swap-grip-active={active ? 'true' : undefined}
      style={style}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        // The grip owns this pointer: never let it reach the resize handle.
        event.preventDefault()
        event.stopPropagation()
        onDragStart?.(event)
      }}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onActivate?.()
      }}
      className={cn(
        'absolute left-1/2 top-2 z-sash grid h-7 w-7 -translate-x-1/2 place-items-center',
        'rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated',
        'text-text-secondary shadow-[var(--shadow-popover)] outline-none',
        'cursor-grab active:cursor-grabbing',
        'transition-opacity duration-[var(--motion-fast)] motion-reduce:transition-none',
        'hover:text-text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent',
        reveal === 'hover'
          ? 'pointer-events-none opacity-0 group-hover/seam:pointer-events-auto group-hover/seam:opacity-100 group-focus-within/seam:pointer-events-auto group-focus-within/seam:opacity-100'
          : 'pointer-events-auto opacity-70 hover:opacity-100',
        active && 'pointer-events-auto opacity-100 border-accent text-accent',
        disabled && 'pointer-events-none opacity-0',
        className,
      )}
    >
      <ArrowLeftRight className="icon-caption" />
    </button>
  )
}

export interface PanelSeamSwapGrip extends Omit<PanelSwapGripButtonProps, 'data-panel-swap-side' | 'reveal'> {
  /** Which neighbour this grip trades with. */
  sourceSide: PanelSwapSide
}

type PanelSeamProps = ResizeHandleProps &
  React.HTMLAttributes<HTMLDivElement> & {
    'data-sash-pair'?: string
    /** Wave-2 swap affordance; absent when the flag is OFF. */
    swapGrip?: PanelSeamSwapGrip
  }

export function PanelSeam({
  className,
  style,
  dragging,
  'data-sash-pair': sashPair,
  swapGrip,
  ...rest
}: PanelSeamProps) {
  return (
    <div
      className={cn('group/seam relative', className)}
      style={style}
      data-sash-pair={sashPair}
      data-seam-grip={dragging ? 'active' : undefined}
    >
      <ResizeHandle dragging={dragging} className="absolute inset-0" style={{ width: '100%', height: '100%' }} {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-2 left-1/2 flex w-[3px] -translate-x-1/2 flex-col items-center justify-between',
          'opacity-0 transition-opacity duration-[var(--motion-fast)] motion-reduce:transition-none',
          'group-hover/seam:opacity-100 group-focus-within/seam:opacity-100',
          dragging && 'opacity-100',
        )}
        data-seam-grip-overlay="visible"
      >
        <span className="h-2 w-[3px] rounded-full bg-border-strong" />
        <span className="w-[3px] flex-1 rounded-full bg-border-strong opacity-80" />
        <span className="h-2 w-[3px] rounded-full bg-border-strong" />
      </span>
      {swapGrip ? (
        <PanelSwapGripButton {...swapGrip} reveal="hover" data-panel-swap-side={swapGrip.sourceSide} />
      ) : null}
    </div>
  )
}