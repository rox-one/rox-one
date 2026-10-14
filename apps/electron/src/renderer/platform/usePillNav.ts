/** WP6: the registry surfaces + user placements the pill composes with (ModeBar and ⌘-slots share it). */
import { useMemo } from 'react'
import { resolveNavSurfaces } from '../components/app-shell/primary-nav'
import { useNavPlacements } from '../components/app-shell/nav-placement'
import type { PillNavPlacement } from './pill-composition'

export function usePillNav(shellFlags: ReadonlySet<string>): PillNavPlacement {
  const placements = useNavPlacements()
  return useMemo(() => ({ surfaces: resolveNavSurfaces({ shellFlags, placements }), placements }), [shellFlags, placements])
}
