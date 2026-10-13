import { describe, expect, it } from 'bun:test'
import { appendHistoryIndex } from '../history-index.ts'
import type { IndexedItem } from '../profile-import.ts'

describe('appendHistoryIndex', () => {
  it('0 new rows → 0 index writes', () => {
    let writes = 0
    const io = {
      read: () => [{ kind: 'history' as const, url: 'https://a.example', title: 'a' }],
      write: () => { writes++ },
    }
    expect(appendHistoryIndex(io, [])).toEqual({ appended: 0, wrote: false })
    expect(writes).toBe(0)
  })

  it('k new rows → k appends, no full rewrite of unrelated urls', () => {
    const existing: IndexedItem[] = [{ kind: 'history', url: 'https://a.example', title: 'a' }]
    let written: IndexedItem[] | null = null
    const io = {
      read: () => existing,
      write: (rows: IndexedItem[]) => { written = rows },
    }
    const incoming: IndexedItem[] = [
      { kind: 'history', url: 'https://a.example', title: 'a' },
      { kind: 'history', url: 'https://b.example', title: 'b' },
      { kind: 'history', url: 'https://c.example', title: 'c' },
    ]
    expect(appendHistoryIndex(io, incoming)).toEqual({ appended: 2, wrote: true })
    expect(written).toEqual([
      { kind: 'history', url: 'https://a.example', title: 'a' },
      { kind: 'history', url: 'https://b.example', title: 'b' },
      { kind: 'history', url: 'https://c.example', title: 'c' },
    ])
  })
})
