/**
 * Merged surface pages (W3.2/W3.3, Согласованность-20261009).
 *
 * `SurfaceHost` renders the first visible contribution of `<surface>.page`;
 * this module is the single registrar for the pages the merges ship:
 * - `calendar.page` — Встречи, moved into the calendar surface (W3.2).
 * - `messenger.page` — Команда, absorbing the empty Контакты mode (W3.3).
 *
 * No `flag` is set: the page must also render through the legacy, ungated
 * `meetings`/`contacts` aliases. Reached only after `SurfaceHost` is loaded,
 * so the seeder always targets the live singleton.
 */
import type { ComponentType } from 'react'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'
import { addSlotRegistrySeeder, type SlotRegistry } from './slots'
import { CalendarSurfacePage } from '@/pages/CalendarSurfacePage'
import { TeamSurfacePage } from '@/pages/TeamSurfacePage'
import type { SurfacePageProps } from './SurfaceHost'

const SURFACE_PAGES: Partial<Record<UnifiedSurfaceId, ComponentType<SurfacePageProps>>> = {
  calendar: CalendarSurfacePage,
  messenger: TeamSurfacePage,
}

export function registerMergedSurfacePages(registry: SlotRegistry): void {
  for (const [surface, component] of Object.entries(SURFACE_PAGES)) {
    if (!component) continue
    registry.register({
      id: `${surface}.page`,
      slot: `${surface}.page`,
      order: 100,
      source: 'workbench.w3-merges',
      payload: { component },
    })
  }
}

addSlotRegistrySeeder(registerMergedSurfacePages)