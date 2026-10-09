/**
 * PERF-09 (#1576) review round 2: regression tests for every finding.
 */
import { installDom, uninstallDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashKey, type QueryClient } from '@tanstack/react-query'
import { emptyWorkspaceWorkState, type WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { ROX_REVALIDATE_AFTER_MS, createRoxQueryClient, isRecentlyRead, resetRoxQueryClientForTests, roxQueryClient } from '../client'
import { roxKeys } from '../keys'
import {
  ROX_QUERY_CACHE_MAX_AGE_MS,
  ROX_QUERY_CACHE_MAX_RECORDS,
  buildPersistedRoxQueryCache,
  readPersistencePrincipal,
  staleRoxQueryRecordKeys,
  startRoxQueryPersistence,
  type PersistedRoxQueryCache,
  type RoxQueryStorage,
} from '../persist'
import { startRoxQueryEventBridge } from '../event-bridge'
import { startRoxQueryRuntime } from '../runtime'
import { cachedNotesList, fetchNotesList, patchCachedNote } from '../notes-cache'
import { cacheWriteEpoch, fencedPatchQueryData, resetSharedReads } from '../shared-read'
import { resetAnnouncedWorkspaceWorkRevisions } from '../workspace-work-revision'
import { useWorkspaceWork } from '../../useWorkspaceWork'

installDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => uninstallDom())

const renderer = join(import.meta.dir, '../../..')
const read = (file: string) => readFileSync(join(renderer, file), 'utf8')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 6; i++) await flush() }
const immediate = { debounceMs: 0, idle: (run: () => void) => { run(); return () => {} } }

beforeEach(() => {
  resetRoxQueryClientForTests(createRoxQueryClient())
  resetAnnouncedWorkspaceWorkRevisions()
})

const ALICE = JSON.stringify(['native', 'idp', 'alice'])
const BOB = JSON.stringify(['native', 'idp', 'bob'])

/** One record per principal, like the IndexedDB storage. */
function principalStorage(initial: Record<string, unknown> = {}) {
  const records = new Map<string, unknown>(Object.entries(initial))
  const log: string[] = []
  const storage: RoxQueryStorage & { records: Map<string, unknown>; log: string[] } = {
    read: async principal => { log.push(`read:${principal}`); return records.get(principal) },
    write: async value => { log.push(`write:${value.principal}`); records.set(value.principal, structuredClone(value)) },
    remove: async principal => { log.push(`remove:${principal}`); records.delete(principal) },
    prune: async keep => { log.push(`prune:${keep}`) },
    records,
    log,
  }
  return storage
}

function recordFor(principal: string, notes: unknown[] = [{ id: 'warm' }], workspaceId = 'ws'): PersistedRoxQueryCache {
  const client = createRoxQueryClient()
  client.setQueryData(roxKeys.notesList(workspaceId), notes)
  return buildPersistedRoxQueryCache(client, workspaceId, principal, Date.now())!
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function snapshot(workspaceId: string, revision: number): WorkspaceWorkSnapshot {
  return { ...emptyWorkspaceWorkState(workspaceId), revision, access: { actorId: 'owner', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }
}

function eventApi(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, () => void>()
  const value = {
    onIdentityChanged: (callback: () => void) => { listeners.set('identity', callback); return () => listeners.delete('identity') },
    onReconnected: (callback: () => void) => { listeners.set('reconnected', callback); return () => listeners.delete('reconnected') },
    ...extra,
  }
  return { value, emit: (name: 'identity' | 'reconnected') => listeners.get(name)?.() }
}

/** The runtime's wiring with an immediate write schedule. */
function wire(client: QueryClient, api: ReturnType<typeof eventApi>['value'], storage: RoxQueryStorage, principal: () => Promise<string | null>) {
  const initialPrincipal = principal()
  const persistence = startRoxQueryPersistence(client, storage, { ...immediate, principal, initialPrincipal })
  const cleared: Array<string | null> = []
  const stopBridge = startRoxQueryEventBridge(client, api as never, {
    principal,
    initialPrincipal,
    onIdentityChanged: next => { cleared.push('cleared'); void persistence.clear(next) },
    onIdentityConfirmed: next => persistence.reopen(next),
  })
  return { persistence, cleared, stop: () => { stopBridge(); persistence.stop() } }
}

describe('error: readPersistencePrincipal fails closed', () => {
  it('returns null on any identity read failure, missing identity or missing native userId', async () => {
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => { throw new Error('org identity is not live') } })).toBeNull()
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => { throw new Error('Native self profile unavailable') } })).toBeNull()
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => null })).toBeNull()
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ authority: 'native', issuer: 'idp' }) })).toBeNull()
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ userId: 'u', authority: 'someone-else' }) })).toBeNull()
    expect(await readPersistencePrincipal({})).toBeNull()
    expect(await readPersistencePrincipal(undefined)).toBeNull()
  })

  it('local only when main positively reports local mode', async () => {
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ userId: 'u1', authority: 'native', issuer: 'idp' }) })).toBe(JSON.stringify(['native', 'idp', 'u1']))
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ userId: 'me', authority: 'local' }) })).toBe(JSON.stringify(['local', '', 'me']))
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ authority: 'local' }) })).toBe('local')
  })

  it('an unknown principal never restores or writes: account A\'s record cannot reach account B', async () => {
    // A's list was stored under the old shared fallback key; B's identity read fails.
    const storage = principalStorage({ local: recordFor('local', [{ id: 'alice-private' }]) })
    const client = roxQueryClient()
    const persistence = startRoxQueryPersistence(client, storage, { ...immediate, principal: () => readPersistencePrincipal({ getOrgIdentity: async () => { throw new Error('org identity is not live') } }) })
    await persistence.ready
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    await fetchNotesList('ws', async () => [{ id: 'b-note' }] as never[])
    await settle()
    expect(storage.log).toEqual([])
    persistence.stop()
  })
})

describe('warning: identity:changed clears only when the principal differs', () => {
  it('a profile edit / Accounts refresh fences in-flight reads but keeps memory and the warm-start record', async () => {
    const who = { id: ALICE as string | null }
    const storage = principalStorage({ [ALICE]: recordFor(ALICE) })
    const client = roxQueryClient()
    const { value, emit } = eventApi()
    const wired = wire(client, value, storage, async () => who.id)
    await wired.persistence.ready
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'warm' }])
    const gate = deferred<never[]>()
    const inflight = fetchNotesList('ws', () => gate.promise)
    emit('identity')
    gate.resolve([{ id: 'started-before-the-event' }] as never[])
    await inflight
    await settle()
    // Fenced: the read that began before the event did not write; nothing was cleared.
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'warm' }])
    expect(wired.cleared).toEqual([])
    expect(storage.log.some(entry => entry.startsWith('remove'))).toBe(false)
    expect(storage.records.has(ALICE)).toBe(true)
    // Writes resume under the reopened epoch, still labelled alice.
    await fetchNotesList('ws', async () => [{ id: 'after-edit' }] as never[])
    await settle()
    expect((storage.records.get(ALICE) as PersistedRoxQueryCache).state.queries[0]!.state.data).toEqual([{ id: 'after-edit' }])
    wired.stop()
  })

  it('a different principal clears memory and the previous principal\'s record; new writes are labelled with the new one', async () => {
    const who = { id: ALICE as string | null }
    const storage = principalStorage({ [ALICE]: recordFor(ALICE) })
    const client = roxQueryClient()
    const { value, emit } = eventApi()
    const wired = wire(client, value, storage, async () => who.id)
    await wired.persistence.ready
    who.id = BOB
    emit('identity')
    await settle()
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(wired.cleared).toEqual(['cleared'])
    expect(storage.records.has(ALICE)).toBe(false)
    await fetchNotesList('ws', async () => [{ id: 'bob-note' }] as never[])
    await settle()
    expect((storage.records.get(BOB) as PersistedRoxQueryCache).principal).toBe(BOB)
    wired.stop()
  })

  it('an identity read that fails after the event is treated as a change (fail closed)', async () => {
    const who = { id: ALICE as string | null }
    const client = roxQueryClient()
    const { value, emit } = eventApi()
    const wired = wire(client, value, principalStorage(), async () => who.id)
    await wired.persistence.ready
    client.setQueryData(roxKeys.agentsCatalog('ws'), { sources: [], skills: [] })
    who.id = null
    emit('identity')
    await settle()
    expect(client.getQueryData(roxKeys.agentsCatalog('ws'))).toBeUndefined()
    wired.stop()
  })

  it('the runtime wires it: an unchanged principal keeps the cache and the record', async () => {
    const storage = principalStorage({ [ALICE]: recordFor(ALICE) })
    const { value, emit } = eventApi({
      getRuntimeEnvironment: () => 'electron',
      getOrgIdentity: async () => ({ userId: 'alice', authority: 'native' as const, issuer: 'idp' }),
    })
    const stop = startRoxQueryRuntime(value as never, storage)
    await settle()
    expect(roxQueryClient().getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'warm' }])
    emit('identity')
    await settle()
    expect(roxQueryClient().getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'warm' }])
    expect(storage.records.has(ALICE)).toBe(true)
    stop()
  })
})

describe('warning: a reconnect re-checks the principal', () => {
  function seed(client: QueryClient) {
    client.setQueryData(roxKeys.notesList('ws'), [{ id: 'a' }])
    client.setQueryData(roxKeys.workspaceWork('ws'), snapshot('ws', 3))
    client.setQueryData(roxKeys.agentsCatalog('ws'), { sources: [], skills: [] })
    client.setQueryData(roxKeys.feed('ws', 'caller-a'), { items: [] })
  }

  it('workspace-only entries are not paintable until the principal is known; a match brings them back for revalidation', async () => {
    const client = roxQueryClient()
    seed(client)
    const check = deferred<string | null>()
    const { value, emit } = eventApi()
    const confirmed: unknown[] = []
    const stop = startRoxQueryEventBridge(client, value as never, {
      principal: () => check.promise, initialPrincipal: Promise.resolve(ALICE), onIdentityConfirmed: next => confirmed.push(next),
    })
    emit('reconnected')
    expect(cachedNotesList('ws')).toBeNull()
    expect(client.getQueryData(roxKeys.workspaceWork('ws'))).toBeUndefined()
    expect(client.getQueryData(roxKeys.agentsCatalog('ws'))).toBeUndefined()
    // Keys that carry the caller stay.
    expect(client.getQueryData(roxKeys.feed('ws', 'caller-a'))).toBeDefined()
    // A read from the new connection lands meanwhile and is newer than the parked entry.
    client.setQueryData(roxKeys.agentsCatalog('ws'), { sources: ['fresh'], skills: [] })
    check.resolve(ALICE)
    await settle()
    expect(cachedNotesList('ws')).toEqual([{ id: 'a' }] as never)
    expect(client.getQueryState(roxKeys.notesList('ws'))?.isInvalidated).toBe(true)
    expect(client.getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork('ws'))?.revision).toBe(3)
    expect(client.getQueryData<unknown>(roxKeys.agentsCatalog('ws'))).toEqual({ sources: ['fresh'], skills: [] })
    expect(confirmed.length).toBe(1)
    stop()
  })

  it('a different principal after the reconnect drops everything and runs the identity clear', async () => {
    const client = roxQueryClient()
    seed(client)
    const { value, emit } = eventApi()
    let cleared = 0
    const stop = startRoxQueryEventBridge(client, value as never, {
      principal: async () => BOB, initialPrincipal: Promise.resolve(ALICE), onIdentityChanged: () => { cleared++ },
    })
    const gate = deferred<never[]>()
    const inflight = fetchNotesList('ws', () => gate.promise)
    emit('reconnected')
    gate.resolve([{ id: 'alice-from-old-socket' }] as never[])
    await inflight
    await settle()
    expect(cleared).toBe(1)
    expect(client.getQueryCache().getAll()).toEqual([])
    stop()
  })

  it('an unknown principal after the reconnect is treated as a change', async () => {
    const client = roxQueryClient()
    seed(client)
    const { value, emit } = eventApi()
    const stop = startRoxQueryEventBridge(client, value as never, {
      principal: async () => { throw new Error('offline') }, initialPrincipal: Promise.resolve(ALICE),
    })
    emit('reconnected')
    await settle()
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(client.getQueryData(roxKeys.feed('ws', 'caller-a'))).toBeUndefined()
    stop()
  })

  it('without a principal reader the bridge keeps the old behaviour (reconnect invalidates in place)', () => {
    const client = roxQueryClient()
    seed(client)
    const { value, emit } = eventApi()
    const stop = startRoxQueryEventBridge(client, value as never)
    emit('reconnected')
    expect(client.getQueryState(roxKeys.notesList('ws'))?.isInvalidated).toBe(true)
    stop()
  })
})

describe('warning: a Feed cache seed never prunes the saved source filter', () => {
  it('sourceDataWorkspaceId is only set by a fresh feedList', () => {
    const feed = read('pages/FeedPage.tsx')
    expect(feed).toContain('const [sourceDataWorkspaceId, setSourceDataWorkspaceId] = useState<string | null | undefined>(undefined)')
    expect(feed).not.toContain('setSourceDataWorkspaceId(cached ? workspaceId : undefined)')
    const assignments: string[] = [...(feed.match(/setSourceDataWorkspaceId\(([^)]*)\)/g) ?? [])]
    expect(assignments.sort()).toEqual(['setSourceDataWorkspaceId(undefined)', 'setSourceDataWorkspaceId(workspaceId)'].sort())
    // The only setter with a workspace sits right after the fresh feedList result.
    const fresh = feed.indexOf('const res = await api.feedList(workspaceId)')
    expect(fresh).toBeGreaterThan(0)
    expect(feed.indexOf('setSourceDataWorkspaceId(workspaceId)')).toBeGreaterThan(fresh)
  })
})

describe('warning: the cached notes list is metadata only', () => {
  it('callers get the raw list; memory holds NoteSummary fields', async () => {
    const raw = [{ id: 'n1', title: 'T', path: '/p', relativePath: 'p', tags: [], properties: {}, links: [], assetRefs: [], updatedAt: 1, createdAt: 1, size: 3, content: 'BODY', backlinks: [{ preview: 'QUOTE' }] }]
    const result = await fetchNotesList('ws', async () => raw as never[])
    expect((result[0] as unknown as { content: string }).content).toBe('BODY')
    const cached = JSON.stringify(roxQueryClient().getQueryData(roxKeys.notesList('ws')))
    expect(cached).not.toContain('BODY')
    expect(cached).not.toContain('QUOTE')
    expect(cached).toContain('"title":"T"')
  })
})

describe('info: notes-list mount reads join and respect the SWR window', () => {
  it('two mounts share one read; a mount within the window reads nothing; change events read fresh', async () => {
    let reads = 0
    const gate = deferred<never[]>()
    const list = () => { reads++; return reads === 1 ? gate.promise : Promise.resolve([{ id: `r${reads}` }] as never[]) }
    const home = fetchNotesList('ws', list, { mount: true })
    const notes = fetchNotesList('ws', list, { mount: true })
    gate.resolve([{ id: 'r1' }] as never[])
    expect(await home).toEqual(await notes)
    expect(reads).toBe(1)
    // Revisit within 10 s: no RPC.
    expect(await fetchNotesList('ws', list, { mount: true })).toEqual([{ id: 'r1' }] as never)
    expect(reads).toBe(1)
    // A change event / mutation / explicit refresh always reads.
    await fetchNotesList('ws', list)
    expect(reads).toBe(2)
    // Invalidated (change event while unmounted) or older than the window: the mount reads.
    void roxQueryClient().invalidateQueries({ queryKey: roxKeys.notesList('ws'), refetchType: 'none' })
    await fetchNotesList('ws', list, { mount: true })
    expect(reads).toBe(3)
    roxQueryClient().setQueryData(roxKeys.notesList('ws'), [{ id: 'old' }], { updatedAt: Date.now() - ROX_REVALIDATE_AFTER_MS - 1 })
    await fetchNotesList('ws', list, { mount: true })
    expect(reads).toBe(4)
  })

  it('Notes and Home use mount reads only on mount', () => {
    const notes = read('pages/NotesPage.tsx')
    expect(notes).toContain('refreshNotes({ mount: true })')
    expect(notes.match(/refreshNotes\(\{ mount: true \}\)/g)?.length).toBe(1)
    expect(notes).toContain("fetchNotesList(activeWorkspaceId, () => window.electronAPI.listNotes(activeWorkspaceId), { mount: options.mount === true })")
    const widgets = read('platform/home/widgets.tsx')
    expect(widgets).toContain('void load(true)')
    expect(widgets).toContain('api.onNotesChanged(() => { void load() })')
  })
})

describe('info: IndexedDB storage is created only on desktop', () => {
  it('the web runtime never opens the database; desktop does', async () => {
    let opened = 0
    const previous = (globalThis as { indexedDB?: unknown }).indexedDB
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { opened++; return {} } }
    try {
      const web = eventApi({ getRuntimeEnvironment: () => 'web', getOrgIdentity: async () => ({ userId: 'u', authority: 'local' }) })
      const stopWeb = startRoxQueryRuntime(web.value as never)
      await settle()
      expect(opened).toBe(0)
      stopWeb()
      const desktop = eventApi({ getRuntimeEnvironment: () => 'electron', getOrgIdentity: async () => ({ userId: 'u', authority: 'local' }) })
      const stopDesktop = startRoxQueryRuntime(desktop.value as never)
      for (let i = 0; i < 20 && opened === 0; i++) await flush()
      expect(opened).toBe(1)
      stopDesktop()
    } finally {
      ;(globalThis as { indexedDB?: unknown }).indexedDB = previous
    }
  })

  it('source: the default storage is resolved after the desktop check', () => {
    const runtime = read('lib/query/runtime.ts')
    expect(runtime).not.toContain("= typeof indexedDB !== 'undefined' ? idbRoxQueryStorage() : null,")
    expect(runtime.indexOf('const desktop =')).toBeLessThan(runtime.indexOf('idbRoxQueryStorage()'))
  })
})

describe('info: one IndexedDB record per principal', () => {
  it('a window with another principal neither reads nor deletes the other record', async () => {
    const storage = principalStorage({ [ALICE]: recordFor(ALICE, [{ id: 'alice-warm' }]) })
    const client = createRoxQueryClient()
    const persistence = startRoxQueryPersistence(client, storage, { ...immediate, principal: async () => BOB })
    await persistence.ready
    await settle()
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(storage.records.has(ALICE)).toBe(true)
    expect(storage.log).toEqual([`read:${BOB}`, `prune:${BOB}`])
    persistence.stop()
  })

  it('prunes other principals by age and count, never the current one; the legacy shared key goes', () => {
    const now = Date.now()
    const entries: Array<[string, unknown]> = [
      ['principal:me', { savedAt: now - ROX_QUERY_CACHE_MAX_AGE_MS - 10 }],
      ['principal:expired', { savedAt: now - ROX_QUERY_CACHE_MAX_AGE_MS - 10 }],
      ['principal:broken', { nope: true }],
      ['last-workspace', { savedAt: now }],
      ['unrelated', { savedAt: 0 }],
      ...Array.from({ length: ROX_QUERY_CACHE_MAX_RECORDS + 2 }, (_, index) => [`principal:p${index}`, { savedAt: now - index * 1000 }] as [string, unknown]),
    ]
    const stale = staleRoxQueryRecordKeys(entries, 'me', now).sort()
    expect(stale).toEqual(['last-workspace', 'principal:broken', 'principal:expired', `principal:p${ROX_QUERY_CACHE_MAX_RECORDS}`, `principal:p${ROX_QUERY_CACHE_MAX_RECORDS + 1}`].sort())
  })

  it('idb storage keys records by principal', () => {
    const persist = read('lib/query/persist.ts')
    expect(persist).toContain('idb.set(RECORD_PREFIX + value.principal, value, s)')
    expect(persist).toContain('idb.get(RECORD_PREFIX + principal, s)')
  })
})

describe('info: optimistic feed marks and Notes save results write through the fence', () => {
  it('fencedPatchQueryData keeps the read time and invalidation, needs an entry, and is fenced', () => {
    const client = roxQueryClient()
    const key = roxKeys.feed('ws', 'caller')
    expect(fencedPatchQueryData<{ n: number }>(client, key, value => ({ n: value.n + 1 }))).toBe(false)
    const readAt = Date.now() - 5_000
    client.setQueryData(key, { n: 1 }, { updatedAt: readAt })
    void client.invalidateQueries({ queryKey: key, refetchType: 'none' })
    expect(fencedPatchQueryData<{ n: number }>(client, key, value => ({ n: value.n + 1 }))).toBe(true)
    expect(client.getQueryData<unknown>(key)).toEqual({ n: 2 })
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(readAt)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    const epoch = cacheWriteEpoch()
    resetSharedReads(client)
    client.setQueryData(key, { n: 5 })
    expect(fencedPatchQueryData<{ n: number }>(client, key, value => ({ n: value.n + 1 }), epoch)).toBe(false)
    expect(client.getQueryData<unknown>(key)).toEqual({ n: 5 })
  })

  it('patchCachedNote replaces the entry with its metadata and drops writes from an older epoch', async () => {
    const client = roxQueryClient()
    await fetchNotesList('ws', async () => [{ id: 'n1', title: 'old' }, { id: 'n2', title: 'other' }] as never[])
    expect(patchCachedNote('ws', { id: 'n1', title: 'saved', content: 'BODY' } as never, cacheWriteEpoch())).toBe(true)
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'n1', title: 'saved' }, { id: 'n2', title: 'other' }])
    const epoch = cacheWriteEpoch()
    resetSharedReads(client)
    expect(patchCachedNote('ws', { id: 'n1', title: 'late' } as never, epoch)).toBe(false)
    expect(isRecentlyRead(client, roxKeys.notesList('ws'))).toBe(true)
  })

  it('FeedPage marks and NotesPage saves call the fenced patches', () => {
    const feed = read('pages/FeedPage.tsx')
    expect(feed).toContain('fencedPatchQueryData<FeedListResult>(roxQueryClient(), roxKeys.feed(workspaceId, caller.preferenceKey), apply, cacheWriteEpoch())')
    const notes = read('pages/NotesPage.tsx')
    expect(notes.match(/patchCachedNote\(/g)?.length).toBe(3)
    expect(notes.match(/const cacheEpoch = cacheWriteEpoch\(\)/g)?.length).toBe(3)
  })
})

describe('info: useWorkspaceWork does not re-write a snapshot sharedRead already cached', () => {
  it('a mount read produces one cache success event', async () => {
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => snapshot(workspaceId, 2),
      workspaceWorkWrite: async (workspaceId: string) => ({ snapshot: snapshot(workspaceId, 3), receipt: {} }),
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: () => () => {},
    }
    const hash = hashKey(roxKeys.workspaceWork('ws-once'))
    let successes = 0
    const off = roxQueryClient().getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'success' && event.query.queryHash === hash) successes++
    })
    let handle: ReturnType<typeof useWorkspaceWork> | null = null
    function View() { handle = useWorkspaceWork('ws-once'); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    await act(async () => { await settle() })
    expect(successes).toBe(1)
    // Mutation results are still written.
    await act(async () => { await handle!.write({ kind: 'createTask', input: { title: 'T' } } as never) })
    expect(successes).toBe(2)
    expect(roxQueryClient().getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork('ws-once'))?.revision).toBe(3)
    off()
    await act(async () => { root.unmount() })
  })
})
