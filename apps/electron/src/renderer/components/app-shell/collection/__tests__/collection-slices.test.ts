import { beforeEach, describe, expect, it } from 'bun:test'
import * as storage from '@/lib/local-storage'
import {
  applySlice,
  assertUniqueSliceName,
  BUILTIN_SLICES,
  filtersSignature,
  loadSavedSlices,
  matchingSlice,
  matchingSliceId,
  persistSavedSlices,
  renameSavedSlice,
  sliceMatches,
  type CollectionSlice,
} from '../collection-slices'

const sample: CollectionSlice = {
  id: 'saved-a',
  name: 'Mine',
  filters: { flagged: true },
  builtin: false,
}

const memory = new Map<string, string>()

describe('collection-slices', () => {
  beforeEach(() => {
    memory.clear()
    globalThis.localStorage = {
      clear: () => memory.clear(),
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() { return memory.size },
    } as Storage
  })

  it('matches unread and toggles off', () => {
    const unread = BUILTIN_SLICES[0]
    const next = applySlice({}, unread)
    expect(next).toEqual({ hasUnread: true })
    expect(sliceMatches(next, unread)).toBe(true)
    expect(applySlice(next, unread)).toEqual({})
  })

  it('identifies overdue among builtins', () => {
    expect(matchingSliceId({ due: { type: 'overdue' } })).toBe('overdue')
    expect(matchingSliceId({ status: ['todo'] })).toBe(null)
  })

  it('treats array order as irrelevant', () => {
    expect(filtersSignature({ status: ['b', 'a'] })).toBe(filtersSignature({ status: ['a', 'b'] }))
  })

  it('returns the matching slice object', () => {
    const slice = matchingSlice({ flagged: true })
    expect(slice?.id).toBe('flagged')
    expect(slice?.nameKey).toBe('collection.slice.flagged')
  })

  it('isolates saved slices by workspace suffix', () => {
    persistSavedSlices([sample], 'ws-a')
    persistSavedSlices([{ ...sample, id: 'saved-b', name: 'Other' }], 'ws-b')
    expect(loadSavedSlices('ws-a').map((s) => s.name)).toEqual(['Mine'])
    expect(loadSavedSlices('ws-b').map((s) => s.name)).toEqual(['Other'])
  })

  it('no-ops persist and load without workspace id', () => {
    persistSavedSlices([sample])
    expect(loadSavedSlices()).toEqual([])
    expect(storage.get(storage.KEYS.collectionSlices, null as unknown as CollectionSlice[] | null)).toBe(null)
  })

  it('copies legacy unsuffixed slices into the workspace key', () => {
    storage.set(storage.KEYS.collectionSlices, [sample])
    const loaded = loadSavedSlices('ws-a')
    expect(loaded.map((s) => s.id)).toEqual(['saved-a'])
    expect(storage.get<CollectionSlice[]>(storage.KEYS.collectionSlices, [])).toEqual([sample])
    expect(loadSavedSlices('ws-a')[0]?.name).toBe('Mine')
  })

  it('renames a saved slice and no-ops missing ids', () => {
    const renamed = renameSavedSlice([sample], 'saved-a', '  New  ')
    expect(renamed[0]?.name).toBe('New')
    expect(renameSavedSlice([sample], 'missing', 'X')).toEqual([sample])
  })

  it('rejects empty and duplicate names', () => {
    expect(assertUniqueSliceName('  ', [sample]).ok).toBe(false)
    expect(assertUniqueSliceName('mine', [sample]).ok).toBe(false)
    expect(assertUniqueSliceName('mine', [sample], 'saved-a').ok).toBe(true)
    expect(assertUniqueSliceName('Fresh', [sample]).ok).toBe(true)
  })
})
