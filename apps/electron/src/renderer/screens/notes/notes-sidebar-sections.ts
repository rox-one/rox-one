import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export interface NotesSidebarNote {
  id: string
  title: string
  updatedAt: number
}

export const NOTES_RECENT_LIMIT = 5
/** Recent is a short "jump back in" list; the full vault lives in the folder tree below. */
export const NOTES_RECENT_POOL = 20

function noteItem(n: NotesSidebarNote, menu: SidebarSectionItem['menu']): SidebarSectionItem {
  const title = n.title.trim()
  return {
    id: n.id,
    ...(title ? { label: title } : { labelKey: 'screens.notes.untitled' }),
    icon: 'file-text',
    menu,
    target: { kind: 'note', path: n.id },
  }
}

/**
 * Заметки second-sidebar groups rendered above the folder tree: Закреплённое
 * (user order; pins to deleted notes are dropped) → Недавнее (by updatedAt,
 * excluding pinned). Folders and tags stay in the existing vault navigator.
 */
export function buildNotesSidebarSections(notes: readonly NotesSidebarNote[], pinnedIds: readonly string[]): SidebarSection[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const pinnedSet = new Set<string>()
  const pinned: SidebarSectionItem[] = []
  for (const id of pinnedIds) {
    const n = byId.get(id)
    if (!n || pinnedSet.has(id)) continue
    pinnedSet.add(id)
    pinned.push(noteItem(n, [{ id: 'unpin', labelKey: 'screens.notes.unpin' }]))
  }
  const recent = notes
    .filter((n) => !pinnedSet.has(n.id))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, NOTES_RECENT_POOL)
    .map((n) => noteItem(n, [{ id: 'pin', labelKey: 'screens.notes.pin' }]))
  return nonEmptySections([
    { id: 'pinned', titleKey: 'screens.notes.groups.pinned', items: pinned, limit: 8, collapsible: true },
    { id: 'recent', titleKey: 'screens.notes.groups.recent', items: recent, limit: NOTES_RECENT_LIMIT, collapsible: true },
  ])
}

export function togglePinnedNote(pinned: readonly string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]
}
