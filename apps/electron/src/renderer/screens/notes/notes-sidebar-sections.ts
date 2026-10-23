import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'
import { mergeRecentsByOpened } from '@/pages/notes/note-library'

export interface NotesSidebarNote {
  id: string
  title: string
  updatedAt: number
  /** Optional document icon (emoji) from note properties. */
  icon?: string | null
}

export const NOTES_RECENT_LIMIT = 5
/** Recent is a short "jump back in" list; the full vault lives in the folder tree below. */
export const NOTES_RECENT_POOL = 20

function noteItem(n: NotesSidebarNote, menu: SidebarSectionItem['menu']): SidebarSectionItem {
  const title = n.title.trim()
  const iconLabel = typeof n.icon === 'string' && n.icon.trim() ? n.icon.trim() : ''
  const label = title ? (iconLabel ? `${iconLabel} ${title}` : title) : undefined
  return {
    id: n.id,
    ...(label ? { label } : { labelKey: 'screens.notes.untitled' }),
    icon: 'file-text',
    menu,
    target: { kind: 'note', path: n.id },
  }
}

/**
 * Заметки second-sidebar groups rendered above the folder tree: Закреплённое
 * (user order; pins to deleted notes are dropped) → Недавнее (opened order when
 * provided, else updatedAt; excluding pinned). Folders and tags stay in the
 * existing vault navigator.
 */
export function buildNotesSidebarSections(
  notes: readonly NotesSidebarNote[],
  pinnedIds: readonly string[],
  openedIds: readonly string[] = [],
): SidebarSection[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const pinnedSet = new Set<string>()
  const pinned: SidebarSectionItem[] = []
  for (const id of pinnedIds) {
    const n = byId.get(id)
    if (!n || pinnedSet.has(id)) continue
    pinnedSet.add(id)
    pinned.push(noteItem(n, [{ id: 'unpin', labelKey: 'screens.notes.unpin' }]))
  }
  const recentIds = mergeRecentsByOpened(notes, openedIds, pinnedIds, NOTES_RECENT_POOL)
  const recent = recentIds.map((id) => noteItem(byId.get(id)!, [{ id: 'pin', labelKey: 'screens.notes.pin' }]))
  return nonEmptySections([
    { id: 'pinned', titleKey: 'screens.notes.groups.pinned', items: pinned, limit: 8, collapsible: true },
    { id: 'recent', titleKey: 'screens.notes.groups.recent', items: recent, limit: NOTES_RECENT_LIMIT, collapsible: true },
  ])
}

export function togglePinnedNote(pinned: readonly string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]
}

/**
 * Pins are keyed by vault-relative path: follow renames / moves. With
 * `folder`, every pin under `from/` moves to `to/`.
 */
export function rekeyPinnedNotes(pinned: readonly string[], from: string, to: string, folder = false): string[] {
  if (from === to) return pinned as string[]
  let changed = false
  const out = pinned.map((id) => {
    if (!folder && id === from) { changed = true; return to }
    if (folder && id.startsWith(`${from}/`)) { changed = true; return `${to}/${id.slice(from.length + 1)}` }
    return id
  })
  return changed ? [...new Set(out)] : (pinned as string[])
}

/** Drop pins of a deleted note (or everything under a deleted folder). */
export function dropPinnedNotes(pinned: readonly string[], target: string, folder = false): string[] {
  const out = pinned.filter((id) => (folder ? !id.startsWith(`${target}/`) : id !== target))
  return out.length === pinned.length ? (pinned as string[]) : out
}

/** Same rekey/drop rules as pins — opened-recents are also path ids. */
export const rekeyRecentOpenedNotes = rekeyPinnedNotes
export const dropRecentOpenedNotes = dropPinnedNotes
