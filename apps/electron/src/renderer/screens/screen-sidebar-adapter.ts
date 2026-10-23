import type { LucideIcon } from 'lucide-react'
import type { SidebarGroup, SidebarItem } from '@/components/shell/screen-sidebar'
import type { SidebarSection, SidebarSectionItem, SidebarTarget } from './sidebar-section'
import { targetKey } from './sidebar-section'

type T = (key: string, opts?: Record<string, unknown>) => string

const BADGE_TEXT: Record<NonNullable<SidebarSectionItem['badge']>, string> = {
  unread: 'screens.badge.unread',
  attention: 'screens.badge.attention',
  running: 'screens.badge.running',
  status: 'screens.badge.inProgress',
}

export interface AdapterOptions {
  t: T
  icons: Readonly<Record<string, LucideIcon>>
  onTarget(target: SidebarTarget): void
  /** Item menu action (see SidebarSectionItem.menu). */
  onMenu?(target: SidebarTarget, actionId: string): void
  /** targetKey of the row to mark active. */
  activeKey?: string | null
}

export function toSidebarItem(item: SidebarSectionItem, o: AdapterOptions): SidebarItem {
  const label = item.labelKey ? o.t(item.labelKey) : (item.label ?? '')
  return {
    id: item.id,
    label,
    icon: item.icon ? o.icons[item.icon] : undefined,
    // A count wins; otherwise a short translated status word (visible + read by AT).
    badge: item.count ?? (item.badge ? o.t(BADGE_TEXT[item.badge]) : undefined),
    secondary: item.secondaryKey ? o.t(item.secondaryKey) : item.secondary,
    active: o.activeKey != null && targetKey(item.target) === o.activeKey,
    onSelect: () => o.onTarget(item.target),
    ...(item.menu?.length && o.onMenu
      ? { menu: item.menu.map((m) => ({ id: m.id, label: o.t(m.labelKey), destructive: m.destructive, onSelect: () => o.onMenu?.(item.target, m.id) })) }
      : {}),
  }
}

export function toScreenSidebarGroups(sections: readonly SidebarSection[], o: AdapterOptions): SidebarGroup[] {
  return sections.map((s) => ({
    id: s.id,
    title: o.t(s.titleKey),
    items: s.items.map((i) => toSidebarItem(i, o)),
    initialVisible: s.limit ?? Math.max(1, s.items.length),
    collapsible: s.collapsible,
  }))
}
