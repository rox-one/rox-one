/** Pure model for the primary rail: pinned vs «⋯» screens, from the one primary-nav registry. */
import type { LucideIcon } from 'lucide-react'
import type { ResolvedPrimaryNavEntry } from '../app-shell/primary-nav'
import type { ExtraScreenDef } from '../../pages/extra-screens/registry'
import { RAIL_FIXED_BOTTOM_IDS } from './shell-prefs'

export interface RailScreen {
  /** Registry id (`home`, `docs`, …) or `screen:<extra id>`. */
  id: string
  title: string
  icon: LucideIcon
  disabled: boolean
  entry?: ResolvedPrimaryNavEntry
  extra?: ExtraScreenDef
}

export interface RailModel {
  pinned: RailScreen[]
  overflow: RailScreen[]
  bottom: RailScreen[]
}

/**
 * Every surface available under the current flags is reachable from the rail,
 * including ones whose placement is «Скрыт» (they move into «⋯», never vanish).
 * Pins keep their saved order; unknown pin ids (flag off) are skipped.
 */
export function buildRailModel(input: {
  surfaces: readonly ResolvedPrimaryNavEntry[]
  extraScreens: readonly ExtraScreenDef[]
  pins: readonly string[]
  t: (key: string) => string
}): RailModel {
  const all: RailScreen[] = []
  for (const entry of input.surfaces) {
    // Aliases rendered elsewhere are still distinct screens; only duplicates by id are skipped.
    if (all.some((screen) => screen.id === entry.id)) continue
    all.push({ id: entry.id, title: input.t(entry.labelKey), icon: entry.icon, disabled: entry.disabled, entry })
  }
  for (const extra of input.extraScreens) {
    all.push({ id: `screen:${extra.id}`, title: input.t(extra.labelKey), icon: extra.icon, disabled: false, extra })
  }
  const byId = new Map(all.map((screen) => [screen.id, screen]))
  const pinned: RailScreen[] = []
  for (const id of input.pins) {
    const screen = byId.get(id)
    if (screen && !RAIL_FIXED_BOTTOM_IDS.has(id)) pinned.push(screen)
  }
  const pinnedIds = new Set(pinned.map((screen) => screen.id))
  const bottom = all.filter((screen) => RAIL_FIXED_BOTTOM_IDS.has(screen.id))
  const overflow = all.filter((screen) => !pinnedIds.has(screen.id) && !RAIL_FIXED_BOTTOM_IDS.has(screen.id))
  return { pinned, overflow, bottom }
}
