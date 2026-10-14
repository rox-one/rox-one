/**
 * «Все экраны» (the pill overflow) — pure model.
 *
 * Contextual sidebar: the sidebar only shows the CURRENT screen's own
 * navigation, so the top pills are the one screen switcher. Every surface
 * that is not «Скрыт» stays reachable from this menu, grouped like the old
 * sidebar sections (Навигация / Инструменты / Экспериментальные) and
 * filterable by name. Pill-placed surfaces are listed too, so the menu is a
 * complete index of the app.
 */
import type { LucideIcon } from 'lucide-react'
import type { ResolvedPrimaryNavEntry } from '../components/app-shell/primary-nav'
import type { ExtraScreenDef } from '../pages/extra-screens/registry'

export type AllScreensGroupId = 'navigation' | 'tools' | 'experimental'

export interface AllScreensItem {
  /** Registry id (`home`, `docs`, …) or `screen:<extra id>`. */
  id: string
  title: string
  icon: LucideIcon
  group: AllScreensGroupId
  disabled: boolean
  /** Placed in the top pills (shown with a marker in the menu). */
  inPills: boolean
  entry?: ResolvedPrimaryNavEntry
  extra?: ExtraScreenDef
}

export interface AllScreensGroup {
  id: AllScreensGroupId
  labelKey: string
  items: AllScreensItem[]
}

export const ALL_SCREENS_GROUP_LABEL: Readonly<Record<AllScreensGroupId, string>> = {
  navigation: 'sidebar.navigation',
  tools: 'sidebar.tools',
  experimental: 'sidebar.experimentalFeatures',
}

/** Case/diacritic-insensitive match on the visible title (and the registry id as a fallback). */
export function matchesScreenQuery(item: Pick<AllScreensItem, 'id' | 'title'>, query: string): boolean {
  const q = normalize(query)
  if (!q) return true
  return normalize(item.title).includes(q) || normalize(item.id).includes(q)
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()
}

export function buildAllScreensGroups(input: {
  /** `resolvePrimaryNav` output: every non-hidden surface, ordered. */
  surfaces: readonly ResolvedPrimaryNavEntry[]
  extraScreens: readonly ExtraScreenDef[]
  t: (key: string) => string
  query?: string
}): AllScreensGroup[] {
  const items: AllScreensItem[] = []
  for (const entry of input.surfaces) {
    if (entry.placement === 'hidden') continue
    items.push({
      id: entry.id,
      title: input.t(entry.labelKey),
      icon: entry.icon,
      group: entry.group === 'primary' ? 'navigation' : 'tools',
      disabled: entry.disabled,
      inPills: entry.placement === 'pills',
      entry,
    })
  }
  for (const extra of input.extraScreens) {
    items.push({ id: `screen:${extra.id}`, title: input.t(extra.labelKey), icon: extra.icon, group: 'experimental', disabled: false, inPills: false, extra })
  }
  const query = input.query ?? ''
  const groups: AllScreensGroup[] = []
  for (const id of ['navigation', 'tools', 'experimental'] as const) {
    const groupItems = items.filter(item => item.group === id && matchesScreenQuery(item, query))
    if (groupItems.length > 0) groups.push({ id, labelKey: ALL_SCREENS_GROUP_LABEL[id], items: groupItems })
  }
  return groups
}
