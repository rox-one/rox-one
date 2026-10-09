/**
 * Notes navigator virtualization: folds the vault folder tree into a flat,
 * offset-indexed entry list and windows it, so a vault with thousands of notes
 * only mounts the rows near the scrollport.
 *
 * The windowing primitives are shared with the session collection list and the
 * kanban board (session-table/table-virtualization).
 */

import type { NoteSummary } from '../../../shared/types'

export interface NotesNavFolderNode {
  fullPath: string
  name: string
  children: NotesNavFolderNode[]
  notes: NoteSummary[]
}

/** Rendered height of a folder row (h-7) including its 2px stack gap. */
export const NOTES_FOLDER_ROW_HEIGHT = 30
/** Estimated note row height (py-1.5 + one text-sm line) including its 2px gap. */
export const NOTES_NOTE_ROW_HEIGHT = 34
/** Stack gap folded into every row height (matches the old mb-0.5 rhythm). */
export const NOTES_ROW_GAP = 2
/** Pixel overscan above/below the viewport. */
export const NOTES_NAV_OVERSCAN = 600

export function noteFolder(note: NoteSummary): string {
  return note.id.slice(0, Math.max(0, note.id.lastIndexOf('/')))
}

export function buildFolderTree(notes: NoteSummary[]): {
  rootNotes: NoteSummary[]
  folders: NotesNavFolderNode[]
} {
  const rootNotes: NoteSummary[] = []
  const nodeMap = new Map<string, NotesNavFolderNode>()
  for (const note of notes) {
    const folder = noteFolder(note)
    if (!folder) {
      rootNotes.push(note)
      continue
    }
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const fullPath = segments.slice(0, i).join('/')
      if (!nodeMap.has(fullPath)) {
        nodeMap.set(fullPath, { fullPath, name: segments[i - 1]!, children: [], notes: [] })
      }
    }
    nodeMap.get(folder)!.notes.push(note)
  }
  const folders: NotesNavFolderNode[] = []
  for (const node of nodeMap.values()) {
    const parentPath = node.fullPath.slice(0, node.fullPath.lastIndexOf('/'))
    if (node.fullPath.includes('/')) nodeMap.get(parentPath)!.children.push(node)
    else folders.push(node)
  }
  function sort(nodes: NotesNavFolderNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) sort(node.children)
  }
  sort(folders)
  return { rootNotes, folders }
}

export function countFolderNotes(node: NotesNavFolderNode): number {
  return node.notes.length + node.children.reduce((sum, child) => sum + countFolderNotes(child), 0)
}

export type NotesNavEntry =
  | {
      kind: 'note'
      key: string
      id: string
      depth: number
      note: NoteSummary
      offset: number
      height: number
    }
  | {
      kind: 'folder'
      key: string
      id: string
      depth: number
      folder: NotesNavFolderNode
      offset: number
      height: number
    }

export interface FlattenNotesNavigationOptions {
  collapsedFolders: ReadonlySet<string>
  folderRowHeight?: number
  noteRowHeight?: number
  /** Measured note row height (content height from the rendered rows). */
  getNoteHeight?: (note: NoteSummary) => number | undefined
}

/**
 * Depth-first flatten of the notes navigation into render entries that carry
 * absolute `offset`/`height`. Collapsed folders contribute only their header
 * row. Note rows are indented two levels below their folder header.
 */
export function flattenNotesNavigation(
  rootNotes: readonly NoteSummary[],
  folders: readonly NotesNavFolderNode[],
  options: FlattenNotesNavigationOptions,
): { entries: NotesNavEntry[]; totalHeight: number } {
  const folderRowHeight = options.folderRowHeight ?? NOTES_FOLDER_ROW_HEIGHT
  const noteRowHeight = options.noteRowHeight ?? NOTES_NOTE_ROW_HEIGHT
  const entries: NotesNavEntry[] = []
  let offset = 0

  const pushNote = (note: NoteSummary, depth: number) => {
    const measured = options.getNoteHeight?.(note)
    const height = measured != null && measured > 0 ? Math.ceil(measured) : noteRowHeight
    entries.push({
      kind: 'note',
      key: `note:${note.id}`,
      id: note.id,
      depth,
      note,
      offset,
      height,
    })
    offset += height
  }

  const pushFolder = (node: NotesNavFolderNode, depth: number) => {
    entries.push({
      kind: 'folder',
      key: `folder:${node.fullPath}`,
      id: node.fullPath,
      depth,
      folder: node,
      offset,
      height: folderRowHeight,
    })
    offset += folderRowHeight
    if (options.collapsedFolders.has(node.fullPath)) return
    for (const child of node.children) pushFolder(child, depth + 1)
    for (const note of node.notes) pushNote(note, depth + 2)
  }

  for (const note of rootNotes) pushNote(note, 0)
  for (const node of folders) pushFolder(node, 0)

  return { entries, totalHeight: offset }
}

export function notesNavigationWindow(
  entries: readonly { offset: number; height: number }[],
  listOffsetTop: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = NOTES_NAV_OVERSCAN,
): { startIndex: number; endIndex: number } {
  // Entries are ordered by offset, so binary search keeps scroll work
  // logarithmic (same math as the session-table virtualization).
  const startOffset = Math.max(0, scrollTop - listOffsetTop - overscan)
  const endOffset = Math.max(startOffset, scrollTop - listOffsetTop + Math.max(0, viewportHeight) + overscan)

  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (entry && entry.offset + entry.height <= startOffset) low = middle + 1
    else high = middle
  }
  const startIndex = low

  low = startIndex
  high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (entry && entry.offset < endOffset) low = middle + 1
    else high = middle
  }

  return { startIndex, endIndex: low }
}

/** Entry index by note id, so the active note can be scrolled into view. */
export function noteEntryIndexById(entries: readonly NotesNavEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  entries.forEach((entry, index) => {
    if (entry.kind === 'note') map.set(entry.id, index)
  })
  return map
}