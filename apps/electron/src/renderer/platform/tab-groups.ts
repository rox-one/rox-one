/**
 * Panel-stack → WorkbenchLayout v2 adapter (ADR-0001).
 *
 * URL / panelStackAtom stay authoritative for the focused surface. This module
 * only derives TabGroups (one group per stack entry after migration) and can
 * persist a v2 snapshot beside the URL.
 */
import {
  migrateLegacyLayout,
  parseWorkbenchLayout,
  type LegacyPanelStackEntry,
  type WorkbenchLayout,
} from '@craft-agent/core/platform'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { surfaceTabFromRoute } from './layout-snapshot'

export function panelEntryToLegacy(entry: PanelStackEntry): LegacyPanelStackEntry {
  const tab = surfaceTabFromRoute(entry.route)
  return {
    id: entry.id,
    route: entry.route,
    tab: tab ?? { kind: 'legacy-route' },
    proportion: entry.proportion,
  }
}

export function panelStackToWorkbenchLayout(input: {
  workspaceId: string
  entries: readonly PanelStackEntry[]
  focusedPanelId: string | null
  now?: number
}): WorkbenchLayout {
  return migrateLegacyLayout({
    workspaceId: input.workspaceId,
    entries: input.entries.map(panelEntryToLegacy),
    focusedId: input.focusedPanelId,
    now: input.now,
  })
}

/** Persist only snapshots that round-trip through the typed parser. */
export function persistableWorkbenchLayout(layout: WorkbenchLayout): WorkbenchLayout | null {
  return parseWorkbenchLayout(layout)
}

export interface LayoutTabGroupView<T extends { panelId: string }> {
  groupId: string
  tabs: T[]
}

/**
 * Project panel-derived tabs into WorkbenchLayout groups for the strip.
 * After migration each group has one tab (one stack column). Leftover tabs
 * that are not in the snapshot append as their own group.
 */
export function groupTabsByLayout<T extends { panelId: string }>(
  tabs: readonly T[],
  layout: WorkbenchLayout | null,
): LayoutTabGroupView<T>[] {
  if (!layout || layout.groups.length === 0) {
    return tabs.length === 0 ? [] : [{ groupId: 'default', tabs: [...tabs] }]
  }
  const byId = new Map(tabs.map((tab) => [tab.panelId, tab]))
  const groups: LayoutTabGroupView<T>[] = []
  const seen = new Set<string>()
  for (const group of layout.groups) {
    const grouped: T[] = []
    for (const instance of group.tabs) {
      const tab = byId.get(instance.id)
      if (!tab) continue
      grouped.push(tab)
      seen.add(tab.panelId)
    }
    if (grouped.length > 0) groups.push({ groupId: group.id, tabs: grouped })
  }
  const leftover = tabs.filter((tab) => !seen.has(tab.panelId))
  if (leftover.length > 0) groups.push({ groupId: 'ungrouped', tabs: leftover })
  return groups
}
