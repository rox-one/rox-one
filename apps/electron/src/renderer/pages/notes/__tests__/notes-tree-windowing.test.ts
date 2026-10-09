import { describe, expect, it } from 'bun:test'
import {
  buildFolderTree,
  flattenNotesTree,
  notesScrollToKey,
  NOTES_TREE_ROW_ESTIMATE,
  NOTES_TREE_WINDOW_THRESHOLD,
  type NotesTreeRow,
} from '../NotesNavigationSidebar'
import { createNoteSummaryFixture, NOTE_SUMMARY_FIXTURE_COUNT } from '@/perf/fixtures'
import { ENTITY_LIST_OVERSCAN, flattenEntityListGroups } from '@/components/ui/entity-list'
import { virtualTableWindow } from '@/components/app-shell/session-table/table-virtualization'

const VIEWPORT_HEIGHT = 640

/** Mounted rows for the flattened tree at a given scroll offset (window kernel). */
function mountedCount(rows: NotesTreeRow[], scrollTop: number): number {
  const flattened = flattenEntityListGroups(undefined, rows, new Set<string>(), {
    getItemKey: (row) => row.key,
    rowHeight: NOTES_TREE_ROW_ESTIMATE,
    headerHeight: 0,
  })
  const range = virtualTableWindow(flattened.entries, scrollTop, VIEWPORT_HEIGHT, ENTITY_LIST_OVERSCAN)
  return range.endIndex - range.startIndex
}

describe('notes tree windowing', () => {
  it('flattens the 2000-note vault into one row per note plus folder rows', () => {
    const notes = createNoteSummaryFixture()
    expect(notes).toHaveLength(NOTE_SUMMARY_FIXTURE_COUNT)
    const rows = flattenNotesTree(buildFolderTree(notes), new Set())
    expect(rows.filter((row) => row.kind === 'note')).toHaveLength(NOTE_SUMMARY_FIXTURE_COUNT)
    expect(rows.some((row) => row.kind === 'folder')).toBe(true)
    expect(rows.length).toBeGreaterThan(NOTE_SUMMARY_FIXTURE_COUNT)
  })

  it('mounts far fewer rows than the total when windowed', () => {
    const rows = flattenNotesTree(buildFolderTree(createNoteSummaryFixture()), new Set())
    expect(rows.length).toBeGreaterThan(NOTES_TREE_WINDOW_THRESHOLD)
    const mountedTop = mountedCount(rows, 0)
    const mountedMiddle = mountedCount(rows, (rows.length * NOTES_TREE_ROW_ESTIMATE) / 2)
    const bound =
      Math.ceil((VIEWPORT_HEIGHT + 2 * ENTITY_LIST_OVERSCAN) / NOTES_TREE_ROW_ESTIMATE) + 4
    expect(mountedTop).toBeGreaterThan(0)
    expect(mountedTop).toBeLessThan(bound)
    expect(mountedMiddle).toBeLessThan(bound)
    expect(mountedTop).toBeLessThan(rows.length / 10)
  })

  it('keeps the row order identical to the recursive render (root notes first, then folders)', () => {
    const tree = buildFolderTree(createNoteSummaryFixture(40))
    const rows = flattenNotesTree(tree, new Set())
    const firstFolderIndex = rows.findIndex((row) => row.kind === 'folder')
    const lastRootNoteIndex = rows.reduce(
      (last, row, index) =>
        row.kind === 'note' && tree.rootNotes.includes(row.note) ? index : last,
      -1,
    )
    expect(lastRootNoteIndex).toBeGreaterThanOrEqual(0)
    expect(lastRootNoteIndex).toBeLessThan(firstFolderIndex)
  })

  it('drops the descendants of collapsed folders from the flattened rows', () => {
    const tree = buildFolderTree(createNoteSummaryFixture(80))
    const folder = tree.folders[0]!
    const all = flattenNotesTree(tree, new Set())
    const collapsed = flattenNotesTree(tree, new Set([folder.fullPath]))
    const hidden = all.length - collapsed.length
    const inFolder = (noteId: string) => noteId.startsWith(`${folder.fullPath}/`)

    expect(hidden).toBeGreaterThan(0)
    expect(
      collapsed.some(
        (row) => row.kind === 'folder' && row.node.fullPath === folder.fullPath && row.expanded === false,
      ),
    ).toBe(true)
    expect(
      collapsed.filter((row) => row.kind === 'note' && inFolder(row.note.id)),
    ).toHaveLength(0)
  })

  it('marks the folder rows of an expanded tree so arrow keys can toggle them', () => {
    const tree = buildFolderTree(createNoteSummaryFixture(40))
    const rows = flattenNotesTree(tree, new Set())
    const folderRows = rows.filter((row) => row.kind === 'folder')
    expect(folderRows.length).toBeGreaterThan(0)
    expect(folderRows.every((row) => row.expanded)).toBe(true)
  })

  it('reveals an active note outside the window once scrollToKey matches the row key', () => {
    const rows = flattenNotesTree(buildFolderTree(createNoteSummaryFixture()), new Set())
    expect(rows.length).toBeGreaterThan(NOTES_TREE_WINDOW_THRESHOLD)

    const flattened = flattenEntityListGroups(undefined, rows, new Set<string>(), {
      getItemKey: (row) => row.key,
      rowHeight: NOTES_TREE_ROW_ESTIMATE,
      headerHeight: 0,
    })
    const entryIndex = (scrollToKey: string) =>
      flattened.entries.findIndex(
        (candidate) => candidate.kind === 'row' && candidate.key === `row:${scrollToKey}`,
      )

    // Active note sits at the tail of render order — well outside the initial window.
    const last = rows[rows.length - 1]!
    expect(last.kind).toBe('note')
    const activeNoteId = last.kind === 'note' ? last.note.id : ''
    const initialWindow = virtualTableWindow(flattened.entries, 0, VIEWPORT_HEIGHT, ENTITY_LIST_OVERSCAN)

    // The raw id (the regression) never resolves to a row entry.
    expect(entryIndex(activeNoteId)).toBe(-1)
    expect(initialWindow.endIndex).toBeLessThan(rows.length - 1)

    // The namespaced key (what the sidebar now passes) resolves to a real,
    // off-window entry, so the reveal effect has a target to scroll to.
    const resolved = notesScrollToKey(activeNoteId)!
    expect(resolved).toBe(`note:${activeNoteId}`)
    const resolvedIndex = entryIndex(resolved)
    expect(resolvedIndex).toBeGreaterThanOrEqual(0)
    expect(resolvedIndex).toBeGreaterThan(initialWindow.endIndex)

    // Nothing to reveal when there is no active note.
    expect(notesScrollToKey(null)).toBeNull()
    expect(notesScrollToKey(undefined)).toBeNull()
  })
})