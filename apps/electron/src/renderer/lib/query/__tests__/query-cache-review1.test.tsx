/**
 * PERF-09 (#1576) review round 1: regression tests for every error/warning.
 */
import { installDom, uninstallDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyWorkspaceWorkState, type WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { ROX_QUERY_GC_MS, ROX_REVALIDATE_AFTER_MS, createRoxQueryClient, isRecentlyRead, resetRoxQueryClientForTests, roxQueryClient } from '../client'
import { roxKeys } from '../keys'
import {
  ROX_QUERY_CACHE_MAX_AGE_MS,
  ROX_QUERY_CACHE_MAX_CHARS,
  buildPersistedRoxQueryCache,
  readPersistencePrincipal,
  startRoxQueryPersistence,
  type PersistedRoxQueryCache,
  type RoxQueryStorage,
} from '../persist'
import { startRoxQueryEventBridge } from '../event-bridge'
import { startRoxQueryRuntime } from '../runtime'
import { ensureNotesTaskCache, fetchNotesList, subscribeCachedNotesList } from '../notes-cache'
import { cacheWriteEpoch, fencedSetQueryData, resetSharedReads } from '../shared-read'
import { announcedWorkspaceWorkRevision, resetAnnouncedWorkspaceWorkRevisions } from '../workspace-work-revision'
import { useWorkspaceWork } from '../../useWorkspaceWork'

installDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => uninstallDom())

const renderer = join(import.meta.dir, '../../..')
const read = (file: string) => readFileSync(join(renderer, file), 'utf8')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  resetRoxQueryClientForTests(createRoxQueryClient())
  resetAnnouncedWorkspaceWorkRevisions()
})

function memoryStorage(initial?: unknown) {
  let value: unknown = initial
  const log: string[] = []
  const storage: RoxQueryStorage & { value: () => unknown; log: string[] } = {
    read: async () => { log.push('read'); return value },
    write: async next => { log.push('write'); value = structuredClone(next) },
    remove: async () => { log.push('remove'); value = undefined },
    value: () => value,
    log,
  }
  return storage
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function snapshot(workspaceId: string, revision: number, actorId = 'owner'): WorkspaceWorkSnapshot {
  return { ...emptyWorkspaceWorkState(workspaceId), revision, access: { actorId, canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }
}

const NOTE_DOCUMENT = {
  id: 'n1', title: 'Plan', path: '/v/plan.md', relativePath: 'plan.md', tags: ['t'], properties: {}, links: [], assetRefs: [],
  updatedAt: 1, createdAt: 1, size: 10,
  content: 'SECRET BODY', backlinks: [{ id: 'n2', preview: 'SECRET LINE FROM ANOTHER NOTE' }], nativeRevision: 7, sourceStoreId: 'store-1',
}

describe('error: persisted notes-list is metadata only and capped', () => {
  it('projects NoteDocument entries to NoteSummary fields on disk; memory stays untouched', () => {
    const client = roxQueryClient()
    client.setQueryData(roxKeys.notesList('ws'), [NOTE_DOCUMENT])
    const record = buildPersistedRoxQueryCache(client, 'ws', 'local', Date.now())!
    const json = JSON.stringify(record)
    for (const leaked of ['SECRET BODY', 'SECRET LINE', 'nativeRevision', 'sourceStoreId', 'backlinks', 'content']) expect(json).not.toContain(leaked)
    expect(record.state.queries[0]!.state.data).toEqual([{
      id: 'n1', title: 'Plan', path: '/v/plan.md', relativePath: 'plan.md', tags: ['t'], properties: {}, links: [], assetRefs: [], updatedAt: 1, createdAt: 1, size: 10,
    }])
    expect((client.getQueryData<Array<typeof NOTE_DOCUMENT>>(roxKeys.notesList('ws')))![0]!.content).toBe('SECRET BODY')
  })

  it('removes the stored record when the slice grows past the size cap', async () => {
    const storage = memoryStorage()
    const persistence = startRoxQueryPersistence(roxQueryClient(), storage, { debounceMs: 0, idle: run => { run(); return () => {} } })
    await persistence.ready
    await fetchNotesList('ws', async () => [{ ...NOTE_DOCUMENT, content: '' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.value()).toBeDefined()
    const huge = Array.from({ length: 50 }, (_, index) => ({ ...NOTE_DOCUMENT, id: `n${index}`, title: 'x'.repeat(ROX_QUERY_CACHE_MAX_CHARS / 40) }))
    await fetchNotesList('ws', async () => huge as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.value()).toBeUndefined()
    expect(storage.log.at(-1)).toBe('remove')
    persistence.stop()
  })
})

describe('error: every cache write goes through the identity fence', () => {
  it('fencedSetQueryData drops writes captured before an identity change', () => {
    const client = roxQueryClient()
    const epoch = cacheWriteEpoch()
    resetSharedReads(client)
    expect(fencedSetQueryData(client, roxKeys.feed('ws', 'a'), { items: [] }, epoch)).toBe(false)
    expect(client.getQueryData(roxKeys.feed('ws', 'a'))).toBeUndefined()
    expect(fencedSetQueryData(client, roxKeys.feed('ws', 'a'), { items: [] })).toBe(true)
  })

  it('a workspace-work read that resolves after an identity clear never lands in the new cache', async () => {
    const gate = deferred<void>()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => { await gate.promise; return snapshot(workspaceId, 3, 'previous-principal') },
      workspaceWorkWrite: async () => { throw new Error('unused') },
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: () => () => {},
    }
    function View() { useWorkspaceWork('ws-fence'); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    const client = roxQueryClient()
    resetSharedReads(client)
    client.clear()
    await act(async () => { gate.resolve(); await flush(); await flush() })
    expect(client.getQueryData(roxKeys.workspaceWork('ws-fence'))).toBeUndefined()
    await act(async () => { root.unmount() })
  })

  it('a mutation result that arrives after an identity clear is not cached', async () => {
    const gate = deferred<void>()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => snapshot(workspaceId, 3),
      workspaceWorkWrite: async (workspaceId: string) => { await gate.promise; return { snapshot: snapshot(workspaceId, 4, 'previous-principal'), receipt: {} } },
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: () => () => {},
    }
    let handle: ReturnType<typeof useWorkspaceWork> | null = null
    function View() { handle = useWorkspaceWork('ws-mut'); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    await act(async () => { await flush(); await flush() })
    const client = roxQueryClient()
    let writing!: Promise<boolean>
    await act(async () => { writing = handle!.write({ kind: 'createTask', input: { title: 'T' } } as never) })
    resetSharedReads(client)
    client.clear()
    await act(async () => { gate.resolve(); await writing })
    expect(client.getQueryData(roxKeys.workspaceWork('ws-mut'))).toBeUndefined()
    await act(async () => { root.unmount() })
  })
})

describe('error: the event bridge runs in every runtime; only desktop persists', () => {
  // Review 2: identity events and reconnects re-check the principal; the
  // cache is only dropped when it changed (see query-cache-review2).
  function api(runtime: 'electron' | 'web') {
    const listeners = new Map<string, () => void>()
    const who = { userId: 'u' }
    const value = {
      getRuntimeEnvironment: () => runtime,
      onIdentityChanged: (callback: () => void) => { listeners.set('identity', callback); return () => listeners.delete('identity') },
      onReconnected: (callback: () => void) => { listeners.set('reconnected', callback); return () => listeners.delete('reconnected') },
      getOrgIdentity: async () => ({ userId: who.userId, authority: 'local' as const }),
    }
    return { value, who, emit: (name: string) => listeners.get(name)?.() }
  }
  const settle = async () => { for (let i = 0; i < 6; i++) await flush() }

  it('web: a principal change clears the cache, reconnect invalidates; nothing is persisted', async () => {
    const storage = memoryStorage()
    const { value, who, emit } = api('web')
    const stop = startRoxQueryRuntime(value as never, storage)
    const client = roxQueryClient()
    client.setQueryData(roxKeys.workspaceWork('ws'), snapshot('ws', 1))
    emit('reconnected')
    await settle()
    expect(client.getQueryState(roxKeys.workspaceWork('ws'))?.isInvalidated).toBe(true)
    who.userId = 'other'
    emit('identity')
    await settle()
    expect(client.getQueryData(roxKeys.workspaceWork('ws'))).toBeUndefined()
    expect(storage.log).toEqual([])
    stop()
  })

  it('desktop: the bridge and persistence both start', async () => {
    const storage = memoryStorage()
    const { value, who, emit } = api('electron')
    const stop = startRoxQueryRuntime(value as never, storage)
    await settle()
    expect(storage.log).toEqual(['read'])
    roxQueryClient().setQueryData(roxKeys.notesList('ws'), [])
    who.userId = 'other'
    emit('identity')
    await settle()
    expect(roxQueryClient().getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    stop()
  })
})

describe('warning: the persisted record is bound to the principal', () => {
  async function recordFor(principal: string): Promise<PersistedRoxQueryCache> {
    const client = createRoxQueryClient()
    client.setQueryData(roxKeys.notesList('ws'), [{ id: 'mine' }])
    return buildPersistedRoxQueryCache(client, 'ws', principal, Date.now())!
  }

  it('principal key: org identity authority/issuer/userId; unknown fails closed (review 2)', async () => {
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => ({ userId: 'u1', authority: 'native', issuer: 'https://idp' }) }))
      .toBe(JSON.stringify(['native', 'https://idp', 'u1']))
    expect(await readPersistencePrincipal({ getOrgIdentity: async () => { throw new Error('offline') } })).toBeNull()
    expect(await readPersistencePrincipal(undefined)).toBeNull()
  })

  it('hydrates only when the stored principal matches; otherwise removes the record', async () => {
    const storage = memoryStorage(await recordFor('alice'))
    const other = createRoxQueryClient()
    const mismatch = startRoxQueryPersistence(other, storage, { debounceMs: 0, principal: async () => 'bob' })
    await mismatch.ready
    await flush()
    expect(other.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(storage.value()).toBeUndefined()
    mismatch.stop()

    const kept = memoryStorage(await recordFor('alice'))
    const same = createRoxQueryClient()
    const match = startRoxQueryPersistence(same, kept, { debounceMs: 0, principal: async () => 'alice' })
    await match.ready
    expect(same.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'mine' }])
    match.stop()
  })

  it('records are labelled with the principal the identity epoch opened with', async () => {
    const storage = memoryStorage()
    let who = 'alice'
    const client = roxQueryClient()
    const persistence = startRoxQueryPersistence(client, storage, { debounceMs: 0, idle: run => { run(); return () => {} }, principal: async () => who })
    await persistence.ready
    await fetchNotesList('ws', async () => [{ id: 'a' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    expect((storage.value() as PersistedRoxQueryCache).principal).toBe('alice')
    // The identity event (bridge order: fence, clear, persistence.clear) opens bob's epoch.
    who = 'bob'
    resetSharedReads(client)
    client.clear()
    await persistence.clear()
    await fetchNotesList('ws', async () => [{ id: 'b' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    const record = storage.value() as PersistedRoxQueryCache
    expect(record.principal).toBe('bob')
    expect(record.state.queries[0]!.state.data).toEqual([{ id: 'b' }])
    persistence.stop()
  })

  it('an account switch in main before the renderer identity event never labels old data with the new principal', async () => {
    const storage = memoryStorage()
    let who = 'alice'
    const principalReads: string[] = []
    const idles: Array<() => void> = []
    const client = roxQueryClient()
    const persistence = startRoxQueryPersistence(client, storage, {
      debounceMs: 0, idle: run => { idles.push(run); return () => {} }, principal: async () => { principalReads.push(who); return who },
    })
    await persistence.ready
    // Alice's list is read in alice's epoch; the write is still queued.
    await fetchNotesList('ws', async () => [{ id: 'alice-private' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    // Main switches to bob; the renderer has not received onIdentityChanged yet.
    who = 'bob'
    for (const run of idles.splice(0)) run()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.value()).toBeUndefined()
    // A read that lands in the old epoch (it may already be bob's data) is not written either.
    await fetchNotesList('ws', async () => [{ id: 'read-after-switch' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    for (const run of idles.splice(0)) run()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.value()).toBeUndefined()
    expect(storage.log).not.toContain('write')

    // The identity event arrives: fence + clear + persistence.clear open bob's epoch.
    resetSharedReads(client)
    client.clear()
    await persistence.clear()
    await fetchNotesList('ws', async () => [{ id: 'bob-note' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    for (const run of idles.splice(0)) run()
    await new Promise(resolve => setTimeout(resolve, 5))
    const record = storage.value() as PersistedRoxQueryCache
    expect(record.principal).toBe('bob')
    expect(JSON.stringify(record)).not.toContain('alice-private')
    expect(JSON.stringify(record)).not.toContain('read-after-switch')
    expect(record.state.queries[0]!.state.data).toEqual([{ id: 'bob-note' }])
    persistence.stop()
  })

  it('a success between the identity fence and clear() is never persisted', async () => {
    const storage = memoryStorage()
    const client = roxQueryClient()
    const persistence = startRoxQueryPersistence(client, storage, { debounceMs: 0, idle: run => { run(); return () => {} }, principal: async () => 'alice' })
    await persistence.ready
    resetSharedReads(client)
    client.setQueryData(roxKeys.notesList('ws'), [{ id: 'unfenced' }])
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.log).not.toContain('write')
    persistence.stop()
  })
})

describe('warning: announced revisions beat older in-flight reads', () => {
  function installApi(serve: () => Promise<WorkspaceWorkSnapshot>, reads: { count: number }) {
    const changed = new Set<(workspaceId: string, revision: number) => void>()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async () => { reads.count++; return serve() },
      workspaceWorkWrite: async () => { throw new Error('unused') },
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: (callback: (workspaceId: string, revision: number) => void) => { changed.add(callback); return () => changed.delete(callback) },
    }
    return { emit: (workspaceId: string, revision: number) => { for (const callback of changed) callback(workspaceId, revision) } }
  }

  it('an unmounted surface\'s older read cannot mark the entry current after CHANGED(N+1)', async () => {
    const reads = { count: 0 }
    const gates: Array<ReturnType<typeof deferred<WorkspaceWorkSnapshot>>> = []
    let next = 0
    const responses = [snapshot('ws-r', 3), snapshot('ws-r', 3), snapshot('ws-r', 4)]
    const { emit } = installApi(() => { const gate = deferred<WorkspaceWorkSnapshot>(); gates.push(gate); return gate.promise }, reads)
    const client = roxQueryClient()
    const stop = startRoxQueryEventBridge(client, window.electronAPI as never)
    function View() { useWorkspaceWork('ws-r'); return null }
    // First visit: read N=3 lands.
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    await act(async () => { gates[0]!.resolve(responses[next++]!); await flush() })
    await act(async () => { root.unmount() })
    // Second visit outside the SWR window: a background read of N=3 starts, then the surface unmounts.
    client.setQueryData(roxKeys.workspaceWork('ws-r'), snapshot('ws-r', 3), { updatedAt: Date.now() - ROX_REVALIDATE_AFTER_MS - 1 })
    const again = createRoot(document.createElement('div'))
    await act(async () => { again.render(<View />) })
    await act(async () => { again.unmount() })
    // CHANGED(4) arrives while that read is in flight, then the read resolves with 3.
    emit('ws-r', 4)
    expect(announcedWorkspaceWorkRevision('ws-r')).toBe(4)
    await act(async () => { gates[1]!.resolve(responses[next++]!); await flush() })
    expect(client.getQueryState(roxKeys.workspaceWork('ws-r'))?.isInvalidated).toBe(true)
    // The revisit does not trust it: it paints 3 and reads 4.
    const readsBefore = reads.count
    const third = createRoot(document.createElement('div'))
    await act(async () => { third.render(<View />) })
    expect(reads.count).toBe(readsBefore + 1)
    await act(async () => { gates[2]!.resolve(responses[next++]!); await flush() })
    expect(client.getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork('ws-r'))?.revision).toBe(4)
    await act(async () => { third.unmount() })
    stop()
  })

  it('with no entry at announce time, an older read does not create a current entry', async () => {
    const reads = { count: 0 }
    const gate = deferred<WorkspaceWorkSnapshot>()
    const { emit } = installApi(() => gate.promise, reads)
    const client = roxQueryClient()
    const stop = startRoxQueryEventBridge(client, window.electronAPI as never)
    function View() { useWorkspaceWork('ws-n'); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    await act(async () => { root.unmount() })
    emit('ws-n', 9)
    await act(async () => { gate.resolve(snapshot('ws-n', 8)); await flush() })
    expect(client.getQueryData(roxKeys.workspaceWork('ws-n'))).toBeUndefined()
    stop()
  })
})

describe('decision: stale-while-revalidate on every revisit', () => {
  it('a revisit after the window paints the cached snapshot and reads in the background', async () => {
    const reads: number[] = []
    let revision = 3
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => { reads.push(revision); await flush(); return snapshot(workspaceId, revision) },
      workspaceWorkWrite: async () => { throw new Error('unused') },
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: () => () => {},
    }
    const client = roxQueryClient()
    // Read 11 s ago; an ACL demotion since then emitted no CHANGED event.
    client.setQueryData(roxKeys.workspaceWork('ws-swr'), snapshot('ws-swr', 3), { updatedAt: Date.now() - ROX_REVALIDATE_AFTER_MS - 1_000 })
    expect(isRecentlyRead(client, roxKeys.workspaceWork('ws-swr'))).toBe(false)
    revision = 3
    const seen: Array<string | null> = []
    function View() { const work = useWorkspaceWork('ws-swr'); seen.push(work.snapshot?.access.actorId ?? null); return null }
    ;(window as unknown as { electronAPI: { workspaceWorkRead: unknown } }).electronAPI.workspaceWorkRead = async (workspaceId: string) => {
      reads.push(revision); await flush(); return { ...snapshot(workspaceId, revision), access: { actorId: 'owner', canWrite: false, canDelete: false, canManage: false } }
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    expect(seen[0]).toBe('owner')
    await act(async () => { await flush(); await flush() })
    expect(reads.length).toBe(1)
    expect(client.getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork('ws-swr'))?.access.canWrite).toBe(false)
    expect(isRecentlyRead(client, roxKeys.workspaceWork('ws-swr'))).toBe(true)
    await act(async () => { root.unmount() })
  })

  it('the agents catalog and inbox use the same window', () => {
    expect(read('pages/workspace-work/AgentProfilesView.tsx')).toContain('staleTime: ROX_REVALIDATE_AFTER_MS')
    expect(read('hooks/useInboxItems.ts')).toContain('INBOX_SHARED_FRESH_MS = ROX_REVALIDATE_AFTER_MS')
    expect(ROX_REVALIDATE_AFTER_MS).toBe(10_000)
  })
})

describe('decision: a finite gcTime is applied to entries written through setQueryData', () => {
  it('entries carry the finite gcTime and the notes task cache is shared', () => {
    expect(ROX_QUERY_GC_MS).toBe(30 * 60_000)
    const client = roxQueryClient()
    client.setQueryData(roxKeys.workspaceWork('ws'), snapshot('ws', 1))
    const tasks = ensureNotesTaskCache<string>('ws')
    for (const key of [roxKeys.workspaceWork('ws'), roxKeys.notesTasks('ws')]) {
      const query = client.getQueryCache().find({ queryKey: key, exact: true }) as unknown as { gcTime: number }
      expect(query.gcTime).toBe(30 * 60_000)
    }
    expect(ensureNotesTaskCache<string>('ws')).toBe(tasks)
  })
})

describe('warning: explicit inbox refresh always starts fresh reads', () => {
  it('reload() reads even inside the shared window; a second mount reuses', async () => {
    const { AppShellProvider } = await import('@/context/AppShellContext')
    const { useInboxItems } = await import('@/hooks/useInboxItems')
    let memoryReads = 0
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      listMemoryProposals: async () => { memoryReads++; return [] },
      listPendingSkills: async () => [],
      getMessagingPendingSenders: async () => [],
    }
    let reload: (() => Promise<void>) | null = null
    function Inbox() { reload = useInboxItems({ withRemote: true }).reload as () => Promise<void>; return null }
    const shell = { activeWorkspaceId: 'ws-inbox', pendingPermissions: new Map(), pendingCredentials: new Map() } as never
    const mount = async () => {
      const root = createRoot(document.createElement('div'))
      await act(async () => { root.render(<AppShellProvider value={shell}><Inbox /></AppShellProvider>) })
      await act(async () => { await flush(); await flush() })
      return root
    }
    const first = await mount()
    expect(memoryReads).toBe(1)
    const second = await mount()
    expect(memoryReads).toBe(1)
    await act(async () => { await reload!() })
    expect(memoryReads).toBe(2)
    await act(async () => { first.unmount(); second.unmount() })
  })
})

describe('warning: Notes and the Home widget adopt the hydrated list', () => {
  it('subscribers receive a list restored after they mounted', async () => {
    const seen: unknown[] = []
    const off = subscribeCachedNotesList('ws-h', notes => seen.push(notes))
    const source = createRoxQueryClient()
    source.setQueryData(roxKeys.notesList('ws-h'), [{ id: 'restored' }])
    const storage = memoryStorage(buildPersistedRoxQueryCache(source, 'ws-h', 'local', Date.now()))
    const persistence = startRoxQueryPersistence(roxQueryClient(), storage, { debounceMs: 0 })
    await persistence.ready
    expect(seen).toEqual([[{ id: 'restored' }]])
    off()
    persistence.stop()
  })

  it('both surfaces subscribe until their first fresh read', () => {
    const notes = read('pages/NotesPage.tsx')
    expect(notes).toContain('subscribeCachedNotesList(activeWorkspaceId')
    expect(notes).toContain('notesFreshWorkspaceRef.current = activeWorkspaceId')
    const widgets = read('platform/home/widgets.tsx')
    expect(widgets).toContain('subscribeCachedNotesList(workspaceId')
    expect(widgets).toContain('if (!cancelled && !fresh)')
  })
})

describe('info: persistence age comes from the entries, and an untouched restore is not re-saved', () => {
  it('restoring without a new successful read writes nothing', async () => {
    const source = createRoxQueryClient()
    source.setQueryData(roxKeys.notesList('ws'), [{ id: 'n' }])
    const storage = memoryStorage(buildPersistedRoxQueryCache(source, 'ws', 'local', Date.now()))
    const persistence = startRoxQueryPersistence(roxQueryClient(), storage, { debounceMs: 0, idle: run => { run(); return () => {} } })
    await persistence.ready
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.log).toEqual(['read'])
    persistence.stop()
  })

  it('an entry older than the max age is dropped even when the record was re-saved recently', async () => {
    const source = createRoxQueryClient()
    const old = Date.now() - ROX_QUERY_CACHE_MAX_AGE_MS - 1_000
    source.setQueryData(roxKeys.notesList('ws'), [{ id: 'old' }], { updatedAt: old })
    source.setQueryData(roxKeys.agentsCatalog('ws'), { sources: [], skills: [] })
    const record = buildPersistedRoxQueryCache(source, 'ws', 'local', Date.now())!
    expect(record.state.queries.map(query => query.queryKey[1])).toEqual(['agents-catalog'])
    const forged: PersistedRoxQueryCache = { ...record, state: { ...record.state, queries: [
      ...record.state.queries,
      { ...record.state.queries[0]!, queryKey: roxKeys.notesList('ws'), queryHash: JSON.stringify(roxKeys.notesList('ws')), state: { ...record.state.queries[0]!.state, data: [{ id: 'old' }], dataUpdatedAt: old } },
    ] } }
    const target = createRoxQueryClient()
    const persistence = startRoxQueryPersistence(target, memoryStorage(forged), { debounceMs: 0 })
    await persistence.ready
    expect(target.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(target.getQueryData<unknown>(roxKeys.agentsCatalog('ws'))).toEqual({ sources: [], skills: [] })
    persistence.stop()
  })
})
