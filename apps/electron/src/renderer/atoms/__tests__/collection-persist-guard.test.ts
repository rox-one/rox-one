/**
 * collection-persist-guard.test.ts — no-op persist suppression for the
 * collection atoms.
 *
 * Production evidence: a status-filter click logged
 * `Collection filters saved for workspace <id>` 2× within ~100ms. Every
 * persisting write costs a main-process disk write, a cross-window
 * broadcast, and — because the server echo was applied with fresh object
 * identities — a full re-render cascade in every collection consumer, even
 * when the payload changed nothing (e.g. rail navigation re-applying the
 * stored chips for a key, or a double-fired toggle with an identical
 * payload). These tests pin the guard:
 * - content-identical writes persist nothing and notify nothing;
 * - real changes still persist exactly once;
 * - rapid successive writes (the production 2× signature) chain correctly
 *   with no lost update and no deadlock;
 * - broadcast application (`replace*`) never writes back (no
 *   write→watch→reload→write loop).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  areCollectionFiltersEqual,
  areCollectionFiltersMapsEqual,
  collectionFilterKeyAtom,
  collectionFiltersAtom,
  collectionFiltersMapAtom,
  replaceCollectionFiltersMapAtom,
} from '../collection-filters'
import {
  areCollectionDisplaysEqual,
  collectionDisplayAtom,
  setCollectionDisplayAtom,
} from '../collection-display'
import { windowWorkspaceIdAtom } from '../sessions'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow
  } else {
    // @ts-expect-error test cleanup for window shim
    delete globalThis.window
  }
})

function shimWindow(api: Record<string, unknown>) {
  globalThis.window = { electronAPI: api } as unknown as typeof window
}

describe('areCollectionFiltersEqual', () => {
  it('treats empty arrays as absent (persist normalizer drops them)', () => {
    expect(areCollectionFiltersEqual({}, { status: [] })).toBe(true)
    expect(areCollectionFiltersEqual({ labels: [] }, {})).toBe(true)
    expect(areCollectionFiltersEqual({ status: ['todo'] }, { status: [] })).toBe(false)
  })

  it('compares due ranges by value', () => {
    expect(
      areCollectionFiltersEqual({ due: { type: 'today' } }, { due: { type: 'today' } }),
    ).toBe(true)
    expect(
      areCollectionFiltersEqual({ due: { type: 'today' } }, { due: { type: 'overdue' } }),
    ).toBe(false)
    expect(
      areCollectionFiltersEqual(
        { due: { type: 'range', start: 1, end: 2 } },
        { due: { type: 'range', start: 1, end: 3 } },
      ),
    ).toBe(false)
  })

  it('compares whole maps by key set and per-key chips', () => {
    expect(
      areCollectionFiltersMapsEqual(
        { allSessions: { status: ['todo'] } },
        { allSessions: { status: ['todo'] } },
      ),
    ).toBe(true)
    expect(
      areCollectionFiltersMapsEqual(
        { allSessions: { status: ['todo'] } },
        { allSessions: { status: ['todo'] }, flagged: {} },
      ),
    ).toBe(false)
  })
})

describe('collectionFiltersAtom no-op guard', () => {
  it('skips the RPC entirely when the write changes nothing', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-guard-1')
    let rpcCalls = 0
    shimWindow({
      setCollectionFilters: async (_ws: string, map: never) => {
        rpcCalls += 1
        return map
      },
    })

    store.set(collectionFilterKeyAtom, 'allSessions')
    await store.set(collectionFiltersAtom, { status: ['todo'] })
    expect(rpcCalls).toBe(1)

    // Same chips again (e.g. rail effect re-applying stored chips, or a
    // duplicate toggle payload): no second disk write, no broadcast.
    await store.set(collectionFiltersAtom, { status: ['todo'] })
    expect(rpcCalls).toBe(1)

    // Absent-vs-empty is also a no-op after normalization.
    await store.set(collectionFiltersAtom, {})
    expect(rpcCalls).toBe(2) // {} differs from { status: ['todo'] }
    await store.set(collectionFiltersAtom, { status: [] })
    expect(rpcCalls).toBe(2) // [] normalizes to absent — no-op
  })

  it('notifies subscribers once per real change (echo does not re-render)', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-guard-2')
    shimWindow({
      // Server echoes normalized content back.
      setCollectionFilters: async (_ws: string, map: never) => map,
    })
    store.set(collectionFilterKeyAtom, 'allSessions')

    let notifications = 0
    const unsub = store.sub(collectionFiltersMapAtom, () => {
      notifications += 1
    })
    await store.set(collectionFiltersAtom, { status: ['todo'] })
    unsub()
    // Optimistic set only — the identical server echo must not mint fresh
    // identities and cascade a second render through every consumer.
    expect(notifications).toBe(1)
  })

  it('chains rapid successive writes without losing updates (2× save signature)', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-guard-3')
    const saves: Array<Record<string, unknown>> = []
    shimWindow({
      setCollectionFilters: async (_ws: string, map: Record<string, unknown>) => {
        saves.push(map)
        return map
      },
    })
    store.set(collectionFilterKeyAtom, 'allSessions')

    // Fast double toggle ON→OFF (production logged 2 saves ~100ms apart):
    // both persists run, the second sees the first's optimistic value.
    await store.set(collectionFiltersAtom, { status: ['todo'] })
    await store.set(collectionFiltersAtom, {})
    expect(saves).toHaveLength(2)
    expect(store.get(collectionFiltersMapAtom)).toEqual({ allSessions: {} })
  })

  it('applying a broadcast never persists (no write-back loop)', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-guard-4')
    let rpcCalls = 0
    shimWindow({
      setCollectionFilters: async (_ws: string, map: never) => {
        rpcCalls += 1
        return map
      },
    })
    store.set(replaceCollectionFiltersMapAtom, { allSessions: { status: ['done'] } })
    expect(store.get(collectionFiltersMapAtom)).toEqual({ allSessions: { status: ['done'] } })
    expect(rpcCalls).toBe(0)
  })
})

describe('setCollectionDisplayAtom no-op guard', () => {
  it('skips the RPC when the patch changes nothing', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-guard-5')
    let rpcCalls = 0
    shimWindow({
      setCollectionDisplay: async (_ws: string, display: never) => {
        rpcCalls += 1
        return display
      },
    })

    const current = store.get(collectionDisplayAtom)
    await store.set(setCollectionDisplayAtom, { groupBy: current.groupBy })
    expect(rpcCalls).toBe(0)

    await store.set(setCollectionDisplayAtom, {
      groupBy: current.groupBy === 'status' ? 'none' : 'status',
    })
    expect(rpcCalls).toBe(1)
  })

  it('areCollectionDisplaysEqual compares every field', () => {
    const store = createStore()
    const a = store.get(collectionDisplayAtom)
    expect(areCollectionDisplaysEqual(a, { ...a })).toBe(true)
    expect(areCollectionDisplaysEqual(a, { ...a, orderDir: a.orderDir === 'asc' ? 'desc' : 'asc' })).toBe(
      false,
    )
    expect(
      areCollectionDisplaysEqual(a, { ...a, visibleProperties: [...a.visibleProperties, 'tokens'] }),
    ).toBe(false)
  })
})
