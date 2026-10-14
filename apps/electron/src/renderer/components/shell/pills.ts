/**
 * Pills selection (shell-layout). One write path for the onboarding step and
 * Settings: the order goes to `pillsStore`, membership to the existing
 * placement store (`pills` for chosen screens; screens removed from the pills
 * move to `menu`, i.e. the rail «⋯», never `hidden`).
 */
import { setNavPlacement, type NavPlacements } from '../app-shell/nav-placement'
import type { ResolvedPrimaryNavEntry } from '../app-shell/primary-nav'
import { setPills } from './shell-prefs'

export const MAX_PILLS = 8

/** Current pill ids in display order: configured order first, then other pill-placed surfaces. */
export function currentPillIds(surfaces: readonly ResolvedPrimaryNavEntry[], order: readonly string[]): string[] {
  const placed = surfaces.filter((entry) => entry.placement === 'pills').map((entry) => entry.id)
  const placedSet = new Set(placed)
  return [...order.filter((id) => placedSet.has(id)), ...placed.filter((id) => !order.includes(id))]
}

export function applyPillsSelection(ids: readonly string[], surfaces: readonly ResolvedPrimaryNavEntry[], placements: NavPlacements): void {
  const chosen = [...new Set(ids)].slice(0, MAX_PILLS)
  const chosenSet = new Set(chosen)
  for (const entry of surfaces) {
    if (chosenSet.has(entry.id)) {
      if (entry.placement !== 'pills') setNavPlacement(entry.id, 'pills')
    } else if (entry.placement === 'pills' || placements[entry.id] === 'pills') {
      setNavPlacement(entry.id, 'menu')
    }
  }
  setPills(chosen)
}

/** Pure reorder helpers shared by drag-n-drop and keyboard. */
export function movePill(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= ids.length) return [...ids]
  const next = [...ids]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!)
  return next
}
