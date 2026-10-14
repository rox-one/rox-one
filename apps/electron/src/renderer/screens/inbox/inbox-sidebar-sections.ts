import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export type InboxViewId = 'all' | 'decisions' | 'messages' | 'snoozed' | 'done'
export const INBOX_VIEWS: readonly InboxViewId[] = ['all', 'decisions', 'messages', 'snoozed', 'done']

export interface InboxSidebarCountsInput {
  all: number; decisions: number; messages: number; snoozed: number; done: number
  blocking: number
  byKind: Readonly<Record<string, number>>
}

export interface InboxSidebarMailFolder {
  id: string
  /** Display name (already localised via folderLabel). */
  label: string
  count: number
  role?: string
}

export interface InboxSidebarInput {
  counts: InboxSidebarCountsInput
  /** Kinds that exist as sources in this build (decision + message + enabled activity kinds), display order. */
  kinds: readonly string[]
  /** Ready mail folders; empty when mail is off/not connected. */
  mailFolders: readonly InboxSidebarMailFolder[]
  /** Pinned filter ids: `kind:<kind>` or `mail:<folderId>`. */
  pinned: readonly string[]
}

export const VIEW_ICONS: Record<InboxViewId, string> = { all: 'inbox', decisions: 'shield-check', messages: 'bell', snoozed: 'clock', done: 'check-check' }

export function inboxFilterId(filter: { kind: string } | { mail: string } | string): string {
  if (typeof filter === 'string') return `view:${filter}`
  return 'kind' in filter ? `kind:${filter.kind}` : `mail:${filter.mail}`
}

const PIN = [{ id: 'pin', labelKey: 'screens.inbox.pin' }]
const UNPIN = [{ id: 'unpin', labelKey: 'screens.inbox.unpin' }]

/**
 * Входящие second sidebar: Виды (fixed, with counts) → Закреплённые фильтры →
 * Источники (each source kind with items, then mail folders). Sources can be
 * pinned from their menu; pinned filters that no longer resolve are dropped.
 */
export function buildInboxSidebarSections(input: InboxSidebarInput): SidebarSection[] {
  const { counts } = input
  const views: SidebarSectionItem[] = INBOX_VIEWS.map((v) => ({
    id: `view:${v}`,
    labelKey: `inbox.view.${v}`,
    icon: VIEW_ICONS[v],
    count: counts[v] || undefined,
    ...(v === 'decisions' && counts.blocking > 0 ? { badge: 'attention' as const } : {}),
    target: { kind: 'filter', filterId: `view:${v}` },
  }))

  const sourceById = new Map<string, SidebarSectionItem>()
  for (const k of input.kinds) {
    const n = counts.byKind[k] ?? 0
    if (n <= 0) continue
    sourceById.set(`kind:${k}`, { id: `kind:${k}`, labelKey: `inbox.kind.${k}`, icon: `kind:${k}`, count: n, target: { kind: 'filter', filterId: `kind:${k}` } })
  }
  for (const f of input.mailFolders) {
    sourceById.set(`mail:${f.id}`, { id: `mail:${f.id}`, label: f.label, icon: `mail:${f.role ?? 'folder'}`, count: f.count || undefined, target: { kind: 'filter', filterId: `mail:${f.id}` } })
  }

  const pinnedSet = new Set(input.pinned)
  const pinned: SidebarSectionItem[] = input.pinned
    .filter((id, i) => input.pinned.indexOf(id) === i)
    .flatMap((id) => {
      const src = sourceById.get(id)
      if (src) return [{ ...src, id: `pin:${id}`, menu: UNPIN }]
      // Kind with zero items right now: keep the pin visible (count hidden) so it doesn't vanish.
      if (id.startsWith('kind:') && input.kinds.includes(id.slice(5))) {
        const k = id.slice(5)
        return [{ id: `pin:${id}`, labelKey: `inbox.kind.${k}`, icon: id, target: { kind: 'filter' as const, filterId: id }, menu: UNPIN }]
      }
      return []
    })
  const sources = [...sourceById.values()].filter((s) => !pinnedSet.has(s.id)).map((s) => ({ ...s, menu: PIN }))

  return nonEmptySections([
    { id: 'views', titleKey: 'screens.inbox.groups.views', items: views, collapsible: false },
    { id: 'pinned', titleKey: 'screens.inbox.groups.pinned', items: pinned, limit: 8, collapsible: true },
    { id: 'sources', titleKey: 'screens.inbox.groups.sources', items: sources, limit: 8, collapsible: true },
  ])
}

/** Toggle a pin in a persisted list (idempotent, order-preserving). */
export function togglePinnedFilter(pinned: readonly string[], id: string, pin: boolean): string[] {
  const without = pinned.filter((p) => p !== id)
  return pin ? [...without, id] : without
}
