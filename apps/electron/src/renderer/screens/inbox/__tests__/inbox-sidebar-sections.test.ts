import { describe, expect, it } from 'bun:test'
import { buildInboxSidebarSections, inboxFilterId, togglePinnedFilter } from '../inbox-sidebar-sections'

const counts = { all: 5, decisions: 2, messages: 3, snoozed: 0, done: 7, blocking: 1, byKind: { permission: 2, reply: 3, error: 0 } }
const base = { counts, kinds: ['permission', 'reply', 'error'], mailFolders: [], pinned: [] as string[] }

describe('buildInboxSidebarSections', () => {
  it('always shows the five views with counts and flags blocking decisions', () => {
    const [views] = buildInboxSidebarSections(base)
    expect(views!.id).toBe('views')
    expect(views!.items.map((i) => [i.id, i.count])).toEqual([['view:all', 5], ['view:decisions', 2], ['view:messages', 3], ['view:snoozed', undefined], ['view:done', 7]])
    expect(views!.items[1]!.badge).toBe('attention')
    expect(views!.limit).toBeUndefined()
  })

  it('lists only non-empty sources plus mail folders, each pinnable', () => {
    const secs = buildInboxSidebarSections({ ...base, mailFolders: [{ id: 'f1', label: 'Inbox', count: 4, role: 'inbox' }] })
    const sources = secs.find((s) => s.id === 'sources')!
    expect(sources.items.map((i) => i.id)).toEqual(['kind:permission', 'kind:reply', 'mail:f1'])
    expect(sources.items[0]!.menu?.[0]?.id).toBe('pin')
  })

  it('moves pinned filters into their own group, keeps empty pinned kinds, drops unknown pins', () => {
    const secs = buildInboxSidebarSections({ ...base, pinned: ['kind:reply', 'kind:error', 'mail:gone', 'kind:reply'] })
    expect(secs.find((s) => s.id === 'pinned')!.items.map((i) => [i.id, i.count])).toEqual([['pin:kind:reply', 3], ['pin:kind:error', undefined]])
    expect(secs.find((s) => s.id === 'sources')!.items.map((i) => i.id)).toEqual(['kind:permission'])
  })

  it('filter ids and pin toggling', () => {
    expect(inboxFilterId('all')).toBe('view:all')
    expect(inboxFilterId({ kind: 'mail' })).toBe('kind:mail')
    expect(inboxFilterId({ mail: 'x' })).toBe('mail:x')
    expect(togglePinnedFilter(['a', 'b'], 'a', true)).toEqual(['b', 'a'])
    expect(togglePinnedFilter(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})
