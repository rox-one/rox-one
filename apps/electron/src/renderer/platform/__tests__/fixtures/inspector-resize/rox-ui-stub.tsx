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

/**
 * Dropdown family used by the inspector action rail (GlobalCreateMenu,
 * InspectorInfoMenu). The fixture exercises resize, never an open menu, so
 * triggers render their children and content renders nothing while closed.
 */
export function DropdownMenu({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function DropdownMenuTrigger({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function DropdownMenuSub({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function StyledDropdownMenuSubTrigger({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function StyledDropdownMenuContent() {
  return null
}

export function StyledDropdownMenuItem({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function StyledDropdownMenuSeparator() {
  return null
}

export function StyledDropdownMenuSubContent({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function DropdownMenuShortcut() {
  return null
}
