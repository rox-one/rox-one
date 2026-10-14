/**
 * Screen-agnostic description of one second-sidebar group (ChatGPT-style
 * "Pinned / Projects / Recents"). Screens build these from real data; the
 * shell's secondary sidebar renders them. Kept framework-free so builders are
 * unit-testable. When the shell publishes its own SidebarSection API this
 * module becomes a thin adapter onto it.
 */

export type SidebarTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'label'; label: string }
  | { kind: 'view'; viewId: string }

export interface SidebarSectionItem {
  id: string
  /** User data (session title, label name) — rendered as-is. */
  label?: string
  /** i18n key for built-in items; takes precedence over `label`. */
  labelKey?: string
  /** lucide icon name */
  icon?: string
  count?: number
  /** Attention dot (unread, needs approval). */
  badge?: 'unread' | 'attention' | 'running'
  target: SidebarTarget
}

export interface SidebarSection {
  id: string
  titleKey: string
  items: SidebarSectionItem[]
  /** Rows shown before "Show more"; undefined = no limit (fixed navigation). */
  limit?: number
  collapsible: boolean
}

/** Drop empty groups — the spec hides them instead of rendering headers. */
export function nonEmptySections(sections: SidebarSection[]): SidebarSection[] {
  return sections.filter((s) => s.items.length > 0)
}
