import { describe, expect, it } from 'bun:test'
import { buildNotesSidebarSections, togglePinnedNote } from '../notes-sidebar-sections'

const notes = [
  { id: 'a.md', title: 'A', updatedAt: 1 },
  { id: 'dir/b.md', title: 'B', updatedAt: 3 },
  { id: 'c.md', title: '  ', updatedAt: 2 },
]

describe('buildNotesSidebarSections', () => {
  it('empty vault → no groups', () => expect(buildNotesSidebarSections([], ['x'])).toEqual([]))

  it('pinned keeps user order, drops missing/duplicate pins; recent excludes pinned, newest first', () => {
    const secs = buildNotesSidebarSections(notes, ['c.md', 'gone.md', 'a.md', 'c.md'])
    expect(secs[0]!.items.map((i) => i.id)).toEqual(['c.md', 'a.md'])
    expect(secs[0]!.items[0]).toMatchObject({ labelKey: 'screens.notes.untitled', menu: [{ id: 'unpin' }] })
    expect(secs[1]!.items.map((i) => i.id)).toEqual(['dir/b.md'])
    expect(secs[1]!.items[0]!.menu?.[0]?.id).toBe('pin')
  })

  it('toggle pin', () => {
    expect(togglePinnedNote(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePinnedNote(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('note pins follow renames, moves and deletes', () => {
  it('rekeys a note and a folder subtree; drops deleted', async () => {
    const { rekeyPinnedNotes, dropPinnedNotes } = await import('../notes-sidebar-sections')
    const pins = ['a/x.md', 'a/b/y.md', 'c.md']
    expect(rekeyPinnedNotes(pins, 'c.md', 'd.md')).toEqual(['a/x.md', 'a/b/y.md', 'd.md'])
    expect(rekeyPinnedNotes(pins, 'a', 'z', true)).toEqual(['z/x.md', 'z/b/y.md', 'c.md'])
    expect(rekeyPinnedNotes(pins, 'q.md', 'r.md')).toBe(pins)
    expect(dropPinnedNotes(pins, 'a', true)).toEqual(['c.md'])
    expect(dropPinnedNotes(pins, 'c.md')).toEqual(['a/x.md', 'a/b/y.md'])
  })
})
