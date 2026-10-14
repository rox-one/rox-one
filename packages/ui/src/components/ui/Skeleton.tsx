import * as React from "react"
import { cn } from "../../lib/utils"

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Number of stacked text lines (clamped to an integer >= 1); omit for a single block. Takes priority over `circle`. */
  lines?: number
  /** Round shape (avatars, icons). */
  circle?: boolean
}

/**
 * Skeleton: a placeholder that keeps layout stable while content loads,
 * used instead of a spinner when the final shape is known. The shimmer is
 * a transform-only pseudo-element (GPU-friendly) and stops under
 * prefers-reduced-motion / while the shell is resizing.
 * Decorative: aria-hidden; the loading container owns aria-busy.
 */
export function Skeleton({ lines: rawLines, circle, className, ...rest }: SkeletonProps) {
  const lines = rawLines === undefined || !Number.isFinite(rawLines) ? 1 : Math.max(1, Math.floor(rawLines))
  if (lines > 1) {
    return (
      <span className={cn("rox-skeleton-stack", className)} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="rox-skeleton" data-last={i === lines - 1 ? "" : undefined} />
        ))}
      </span>
    )
  }
  return <span className={cn("rox-skeleton", circle && "rox-skeleton--circle", className)} aria-hidden="true" {...rest} />
}
