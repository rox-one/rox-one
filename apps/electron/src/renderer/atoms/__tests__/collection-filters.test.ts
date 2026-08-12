import { afterEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  collectionFilterKeyAtom,
  collectionFiltersAtom,
  collectionFiltersMapAtom,
  loadCollectionFiltersAtom,
  replaceCollectionFiltersMapAtom,
} from '../collection-filters'
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

describe('collectionFiltersAtom (FR-11 per-key persistence)', () => {
  it('returns default empty filters when nothing is loaded', () => {
    const store = createStore()
    expect(store.get(collectionFiltersAtom)).toEqual({})
  })

  it('writes chips under the active navigator filter key only', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-1')
    const saves: Array<Record<string, unknown>> = []
    shimWindow({
      setCollectionFilters: async (_ws: string, map: Record<string, unknown>) => {
        saves.push(map)
        return map
      },
    })

    store.set(collectionFilterKeyAtom, 'allSessions')
    await store.set(collectionFiltersAtom, { status: ['todo'] })

    expect(store.get(collectionFiltersMapAtom)).toEqual({ allSessions: { status: ['todo'] } })
    expect(saves).toEqual([{ allSessions: { status: ['todo'] } }])

    // Switching the navigator key exposes a different (empty) entry…
    store.set(collectionFilterKeyAtom, 'flagged')
    expect(store.get(collectionFiltersAtom)).toEqual({})

    // …and writing there does not clobber the first key.
    await store.set(collectionFiltersAtom, { flagged: true })
    expect(store.get(collectionFiltersMapAtom)).toEqual({
      allSessions: { status: ['todo'] },
      flagged: { flagged: true },
    })
    expect(saves[1]).toEqual({
      allSessions: { status: ['todo'] },
      flagged: { flagged: true },
    })
  })

  it('supports functional updates (AppShell jump-to-project pattern)', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-1')
    shimWindow({ setCollectionFilters: async (_ws: string, map: never) => map })

    store.set(collectionFilterKeyAtom, 'allSessions')
    await store.set(collectionFiltersAtom, { status: ['todo'] })
    await store.set(collectionFiltersAtom, (prev) => ({ ...prev, projectId: ['p1'] }))

    expect(store.get(collectionFiltersAtom)).toEqual({ status: ['todo'], projectId: ['p1'] })
  })

  it('keeps optimistic value when persistence channel is unavailable', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, null)
    shimWindow({})

    store.set(collectionFilterKeyAtom, 'allSessions')
    await store.set(collectionFiltersAtom, { labels: ['l1'] })
    expect(store.get(collectionFiltersAtom)).toEqual({ labels: ['l1'] })
  })
})

describe('loadCollectionFiltersAtom', () => {
  it('loads the per-key map for the active workspace', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-1')
    shimWindow({
      getCollectionFilters: async (ws: string) => {
        expect(ws).toBe('ws-1')
        return { allSessions: { status: ['done'] } }
      },
    })

    const loaded = await store.set(loadCollectionFiltersAtom)
    expect(loaded).toEqual({ allSessions: { status: ['done'] } })
    expect(store.get(collectionFiltersMapAtom)).toEqual({ allSessions: { status: ['done'] } })

    store.set(collectionFilterKeyAtom, 'allSessions')
    expect(store.get(collectionFiltersAtom)).toEqual({ status: ['done'] })
  })

  it('drops stale responses after a workspace switch', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'ws-1')
    let resolveWs1: ((map: Record<string, { status: string[] }>) => void) | null = null
    shimWindow({
      getCollectionFilters: (ws: string) => {
        if (ws === 'ws-1') {
          return new Promise((resolve) => { resolveWs1 = resolve })
        }
        return Promise.resolve({ allSessions: { status: ['ws-2'] } })
      },
    })

    const pending = store.set(loadCollectionFiltersAtom, 'ws-1')
    // Switch away before the ws-1 response lands.
    store.set(windowWorkspaceIdAtom, 'ws-2')
    await store.set(loadCollectionFiltersAtom, 'ws-2')
    resolveWs1!({ allSessions: { status: ['ws-1'] } })
    await pending

    expect(store.get(collectionFiltersMapAtom)).toEqual({ allSessions: { status: ['ws-2'] } })
  })

  it('falls back to empty map without a workspace or API', async () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, null)
    shimWindow({})
    const loaded = await store.set(loadCollectionFiltersAtom)
    expect(loaded).toEqual({})
    expect(store.get(collectionFiltersMapAtom)).toEqual({})
  })
})

describe('replaceCollectionFiltersMapAtom', () => {
  it('replaces the local map (RPC change event)', () => {
    const store = createStore()
    store.set(replaceCollectionFiltersMapAtom, { 'view:x': { priority: ['urgent'] } })
    expect(store.get(collectionFiltersMapAtom)).toEqual({ 'view:x': { priority: ['urgent'] } })
  })
})
