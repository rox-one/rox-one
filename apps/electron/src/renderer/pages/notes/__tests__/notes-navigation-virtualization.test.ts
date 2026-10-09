import { describe, expect, test } from 'bun:test'
import type { NoteSummary } from '../../../../shared/types'
import {
  NOTES_FOLDER_ROW_HEIGHT,
  NOTES_NOTE_ROW_HEIGHT,
  buildFolderTree,
  countFolderNotes,
  flattenNotesNavigation,
  noteEntryIndexById,
  noteFolder,
  notesNavigationWindow,
} from '../notes-navigation-virtualization'

const note = (id: string, title = id): NoteSummary =>
  ({ id, title, tags: [] }) as unknown as NoteSummary

describe('buildFolderTree', () => {
  test('splits root notes from nested folders and counts descendants', () => {
    const tree = buildFolderTree([
      note('root.md'),
      note('work/a.md'),
      note('work/deep/b.md'),
    ])
    expect(tree.rootNotes.map((n) => n.id)).toEqual(['root.md'])
    expect(tree.folders.map((f) => f.fullPath)).toEqual(['work'])
    expect(countFolderNotes(tree.folders[0]!)).toBe(2)
    expect(tree.folders[0]!.children[0]!.fullPath).toBe('work/deep')
  })

  test('noteFolder is empty for vault-root notes', () => {
    expect(noteFolder(note('a/b/c.md'))).toBe('a/b')
    expect(noteFolder(note('root.md'))).toBe('')
  })
})

describe('flattenNotesNavigation', () => {
  const notes = [note('root.md'), note('work/a.md'), note('work/deep/b.md')]

  test('root notes precede folders and nested notes are indented two levels', () => {
    const tree = buildFolderTree(notes)
    const { entries, totalHeight } = flattenNotesNavigation(tree.rootNotes, tree.folders, {
      collapsedFolders: new Set(),
    })
    expect(entries.map((entry) => entry.key)).toEqual([
      'note:root.md',
      'folder:work',
      'folder:work/deep',
      'note:work/deep/b.md',
      'note:work/a.md',
    ])
    expect(entries[0]!.depth).toBe(0)
    expect(entries[2]!.depth).toBe(1)
    expect(entries[3]!.depth).toBe(3)
    expect(entries[4]!.depth).toBe(2)
    expect(totalHeight).toBe(NOTES_NOTE_ROW_HEIGHT + NOTES_FOLDER_ROW_HEIGHT * 2 + NOTES_NOTE_ROW_HEIGHT * 2)
  })

  test('collapsed folders hide their descendants from DOM and height', () => {
    const tree = buildFolderTree(notes)
    const { entries, totalHeight } = flattenNotesNavigation(tree.rootNotes, tree.folders, {
      collapsedFolders: new Set(['work']),
    })
    expect(entries.map((entry) => entry.key)).toEqual(['note:root.md', 'folder:work'])
    expect(totalHeight).toBe(NOTES_NOTE_ROW_HEIGHT + NOTES_FOLDER_ROW_HEIGHT)
  })

  test('measured note heights replace the estimate', () => {
    const tree = buildFolderTree([note('root.md')])
    const { entries } = flattenNotesNavigation(tree.rootNotes, tree.folders, {
      collapsedFolders: new Set(),
      getNoteHeight: () => 72,
    })
    expect(entries[0]!.height).toBe(72)
  })
})

describe('notesNavigationWindow', () => {
  test('windows a large flat list', () => {
    const rootNotes = Array.from({ length: 2000 }, (_, i) => note(`n${i}.md`))
    const { entries } = flattenNotesNavigation(rootNotes, [], { collapsedFolders: new Set() })
    const window = notesNavigationWindow(entries, 0, 0, 400, 0)
    expect(window.startIndex).toBe(0)
    expect(window.endIndex).toBe(Math.ceil(400 / NOTES_NOTE_ROW_HEIGHT))
  })

  test('accounts for the list offset inside the scroll container', () => {
    const rootNotes = Array.from({ length: 100 }, (_, i) => note(`n${i}.md`))
    const { entries } = flattenNotesNavigation(rootNotes, [], { collapsedFolders: new Set() })
    expect(notesNavigationWindow(entries, NOTES_NOTE_ROW_HEIGHT, NOTES_NOTE_ROW_HEIGHT, 400, 0).startIndex).toBe(0)
  })
})

describe('noteEntryIndexById', () => {
  test('indexes only note entries', () => {
    const tree = buildFolderTree([note('root.md'), note('work/a.md')])
    const { entries } = flattenNotesNavigation(tree.rootNotes, tree.folders, {
      collapsedFolders: new Set(),
    })
    const index = noteEntryIndexById(entries)
    expect(index.get('root.md')).toBe(0)
    expect(index.get('work/a.md')).toBe(2)
    expect(index.size).toBe(2)
  })
})