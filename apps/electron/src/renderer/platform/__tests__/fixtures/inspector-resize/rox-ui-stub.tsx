import type { ReactNode } from 'react'

/** Minimal @rox/ui stand-in for barrel imports (`import { … } from '@rox/ui'`). */
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

export function parseAnsi(input: string): Array<{ text: string }> {
  return [{ text: input }]
}
