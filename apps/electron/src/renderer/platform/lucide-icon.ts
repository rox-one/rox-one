/**
 * W1-07 (#1504) — resolve a registration's Lucide icon name to a component,
 * so wave-2 modes and slot entries need no shell icon map edits.
 */
import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const isComponent = (value: unknown): value is LucideIcon =>
  typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)

export function resolveLucideIcon(name: string | undefined | null): LucideIcon | null {
  // Icon components are PascalCase; lowercase exports (`icons`,
  // `createLucideIcon`) are helpers and must never render as a component.
  if (!name || !/^[A-Z]/.test(name)) return null
  const icon = (Icons as unknown as Record<string, unknown>)[name]
  return isComponent(icon) ? icon : null
}
