import * as React from 'react'
import type { SeIconProps } from './types'

/** SE rail / workspace stroke weight (spec §4). */
export const SE_ICON_STROKE = 1.5

type SeIconNode = React.ReactNode

/**
 * Shared SVG shell for Rox Engineering icons v2.
 * Paths are Lucide-compatible (ISC); default stroke is SE 1.5, not Lucide 2.
 */
export function createSeIcon(displayName: string, children: SeIconNode) {
  function SeIcon({ size, className, strokeWidth, ...props }: SeIconProps) {
    const sizeProps = className ? {} : { width: size ?? 24, height: size ?? 24 }
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth ?? SE_ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...sizeProps}
        {...props}
      >
        {children}
      </svg>
    )
  }
  SeIcon.displayName = displayName
  return SeIcon
}
