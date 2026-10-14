/**
 * Screen-agnostic description of one second-sidebar group (ChatGPT-style
 * "Pinned / Projects / Recents"). Screens build these from real data; the
 * shell's secondary sidebar renders them. Kept framework-free so builders are
 * unit-testable; `toScreenSidebarGroups` (screen-sidebar-adapter.ts) maps them
 * onto the shell's ScreenSidebarConfig.
 */

export type SidebarTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'label'; label: string }
  | { kind: 'view'; viewId: string }
  | { kind: 'filter'; filterId: string }
  | { kind: 'source'; sourceId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'note'; path: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'thread'; threadId: string }
  | { kind: 'url'; url: string }
  | { kind: 'date'; isoDate: string }

export interface SidebarSectionItem {
  id: string
  /** User data (session title, label name) — rendered as-is. */
  label?: string
  /** i18n key for built-in items; builders set exactly one of label/labelKey. */
  labelKey?: string
  /** lucide icon name */
  icon?: string
  count?: number
  /** Attention dot (unread, needs approval). */
  badge?: 'unread' | 'attention' | 'running' | 'status'
  /** Secondary muted text (time, due date). Already formatted by the caller. */
  secondary?: string
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

/** Stable key for a target, e.g. to mark the active row or persist pins. */
export function targetKey(t: SidebarTarget): string {
  const { kind, ...rest } = t
  return `${kind}:${Object.values(rest).join(':')}`
}
