import type { ReactNode } from 'react'

/** Minimal @rox/ui stand-in so InspectorHost mounts without a second React graph from Radix. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return children
}

export function Tooltip({ children }: { children: ReactNode }) {
  return children
}

export function TooltipTrigger({ children }: { children: ReactNode }) {
  return children
}

export function TooltipContent() {
  return null
}
