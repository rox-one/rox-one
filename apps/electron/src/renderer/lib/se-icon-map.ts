import type { LucideIcon } from 'lucide-react'
import type { AppNavDestinationId } from '@/components/app-shell/nav-destinations'

/** SE rail icon presentation (stroke 1.5, muted inactive). */
export const SE_RAIL_ICON_CLASS = 'h-3.5 w-3.5 shrink-0 [&_svg]:stroke-[1.5]'

export const SE_RAIL_ACTIVE_BUTTON_CLASS =
  'bg-white/6 data-[state=open]:bg-white/6'

export const SE_RAIL_INACTIVE_BUTTON_CLASS =
  'hover:bg-white/4 data-[state=open]:bg-white/4'

/** Nav ids that use accent tint in default Rox; SE profile keeps monochrome rail. */
export const SE_MONOCHROME_NAV_IDS: Record<AppNavDestinationId, true> = {
  sessions: true,
  notes: true,
  sources: true,
  skills: true,
  memory: true,
  tasks: true,
  meetings: true,
  projects: true,
  pages: true,
  automations: true,
  connections: true,
  settings: true,
  learning: true,
}

export function seRailIconProps(icon: LucideIcon): { icon: LucideIcon; iconColorable: false } {
  return { icon, iconColorable: false }
}
