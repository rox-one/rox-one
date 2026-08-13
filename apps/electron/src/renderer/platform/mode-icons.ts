/**
 * Lucide mapping for ModeContribution.icon names (core seed + Mode Bar / rail).
 */

import { BookOpen, MessageSquare, Settings, type LucideIcon } from 'lucide-react'

export const MODE_ICONS: Record<string, LucideIcon> = {
  'message-square': MessageSquare,
  'book-open': BookOpen,
  settings: Settings,
}

export function modeIcon(name: string): LucideIcon {
  return MODE_ICONS[name] ?? MessageSquare
}
