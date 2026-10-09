/**
 * PanelSeam (G6 «Пути») — a lean, resize-only seam between two panels.
 *
 * Wraps the shared `ResizeHandle` (role="separator", 8px / 24px-coarse hit
 * band, keyboard map, drag gradient) and adds the one thing the shipped seam
 * lacked: a *visible grip* that appears on hover / focus / drag, so the seam
 * reads as a draggable object instead of a hairline. No drop targets, no
 * reorder gesture — swapping panels is out of scope for this wave.
 *
 * The wrapper carries the geometry and the inner handle fills it, so the hit
 * band (and every resize computation in PanelResizeSash) is unchanged.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { ResizeHandle, type ResizeHandleProps } from './ResizeHandle'

type PanelSeamProps = ResizeHandleProps &
  React.HTMLAttributes<HTMLDivElement> & { 'data-sash-pair'?: string }

export function PanelSeam({ className, style, dragging, 'data-sash-pair': sashPair, ...rest }: PanelSeamProps) {
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
    </div>
  )
}