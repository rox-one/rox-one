import { describe, expect, it } from 'bun:test'
import type { NoteSummary } from '../../../../shared/types'
import { flattenNotesTree, buildFolderTree, NOTES_TREE_WINDOW_THRESHOLD } from '../NotesNavigationSidebar'

function note(id: string): NoteSummary {
  return { id, title: id, updatedAt: 1 } as NoteSummary
}

describe('notes vault windowing', () => {
  it('500 notes flatten above the window threshold', () => {
    const notes = Array.from({ length: 500 }, (_, i) => note(`n${i}.md`))
    const rows = flattenNotesTree(buildFolderTree(notes), new Set())
    expect(rows.length).toBe(500)
    expect(rows.length).toBeGreaterThan(NOTES_TREE_WINDOW_THRESHOLD)
  })
})
