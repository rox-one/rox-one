/**
 * PERF-09 (#1576): shared renderer query cache — keys, persistence, event
 * bridge, request dedupe and the workspace-work hook on top of it.
 */
import { installDom, uninstallDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyWorkspaceWorkState, type WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { createRoxQueryClient, resetRoxQueryClientForTests, roxQueryClient } from '../client'
import { roxKeys } from '../keys'
import {
  PERSISTED_DOMAINS,
  ROX_QUERY_CACHE_BUSTER,
  ROX_QUERY_CACHE_MAX_AGE_MS,
  buildPersistedRoxQueryCache,
  isRestorableRoxQueryCache,
  restoreRoxQueryCache,
  startRoxQueryPersistence,
  type PersistedRoxQueryCache,
  type RoxQueryStorage,
} from '../persist'
import { startRoxQueryEventBridge } from '../event-bridge'
import { cachedNotesList, fetchNotesList, notesTaskCache } from '../notes-cache'
import { useWorkspaceWork } from '../../useWorkspaceWork'

installDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => uninstallDom())

const renderer = join(import.meta.dir, '../../..')

beforeEach(() => { resetRoxQueryClientForTests(createRoxQueryClient()) })

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

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('keys', () => {
  it('start with the workspace id, so workspaces never share an entry', () => {
    const keys = [
      roxKeys.workspaceWork('ws'), roxKeys.notesList('ws'), roxKeys.notesTasks('ws'), roxKeys.agentsCatalog('ws'),
      roxKeys.feed('ws', 'actor'), roxKeys.inbox('ws', 'actor', 'memory'),
    ]
    for (const key of keys) expect(key[0]).toBe('ws')
    expect(roxKeys.inbox('a', 'actor', 'memory')).not.toEqual(roxKeys.inbox('b', 'actor', 'memory'))
    expect(roxKeys.inbox('a', 'actor-1', 'memory')).not.toEqual(roxKeys.inbox('a', 'actor-2', 'memory'))
  })
})

describe('request dedupe', () => {
  it('concurrent reads of one key make one request', async () => {
    let calls = 0
    const read = async () => { calls++; await flush(); return [{ id: 'n1' }] as never[] }
    const [a, b, c] = await Promise.all([fetchNotesList('ws', read), fetchNotesList('ws', read), fetchNotesList('ws', read)])
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(cachedNotesList('ws')).toEqual([{ id: 'n1' }] as never[])
    expect(cachedNotesList('other')).toBeNull()
  })

  it('the notes task cache is shared per workspace and separate across workspaces', () => {
    const a = notesTaskCache<string>('a')
    a.tasks.set('note', ['task'])
    expect(notesTaskCache<string>('a').tasks.get('note')).toEqual(['task'])
    expect(notesTaskCache<string>('b').tasks.size).toBe(0)
    expect(notesTaskCache<string>(null).tasks.size).toBe(0)
  })
})

describe('persistence', () => {
  function seed() {
    const client = roxQueryClient()
    client.setQueryData(roxKeys.notesList('ws-a'), [{ id: 'n1', title: 'Note' }])
    client.setQueryData(roxKeys.agentsCatalog('ws-a'), { sources: [], skills: [{ slug: 's', name: 'S' }] })
    client.setQueryData(roxKeys.notesList('ws-b'), [{ id: 'other' }])
    client.setQueryData(roxKeys.inbox('ws-a', 'actor', 'memory'), [{ id: 'proposal', text: 'quoted session text' }])
    client.setQueryData(roxKeys.feed('ws-a', 'actor'), { items: [] })
    client.setQueryData(roxKeys.workspaceWork('ws-a'), { workspaceId: 'ws-a', revision: 1 })
    return client
  }

  it('stores one workspace and only metadata domains', () => {
    const record = buildPersistedRoxQueryCache(seed(), 'ws-a', 1_000)!
    expect(record.workspaceId).toBe('ws-a')
    expect(record.buster).toBe(ROX_QUERY_CACHE_BUSTER)
    const keys = record.state.queries.map(query => query.queryKey)
    expect(keys).toEqual(expect.arrayContaining([roxKeys.notesList('ws-a'), roxKeys.agentsCatalog('ws-a')]))
    expect(keys.length).toBe(2)
    expect(JSON.stringify(record)).not.toContain('quoted session text')
    expect([...PERSISTED_DOMAINS].sort()).toEqual(['agents-catalog', 'notes-list'])
  })

  it('rejects stale, foreign-buster or smuggled records', () => {
    const record = buildPersistedRoxQueryCache(seed(), 'ws-a', 1_000)!
    expect(isRestorableRoxQueryCache(record, 2_000)).toBe(true)
    expect(isRestorableRoxQueryCache({ ...record, buster: 'old' }, 2_000)).toBe(false)
    expect(isRestorableRoxQueryCache(record, 1_000 + ROX_QUERY_CACHE_MAX_AGE_MS + 1)).toBe(false)
    const smuggled: PersistedRoxQueryCache = {
      ...record,
      state: { ...record.state, queries: [...record.state.queries, { ...record.state.queries[0]!, queryKey: roxKeys.notesList('ws-b') }] },
    }
    expect(isRestorableRoxQueryCache(smuggled, 2_000)).toBe(false)
    const inbox: PersistedRoxQueryCache = {
      ...record,
      state: { ...record.state, queries: [{ ...record.state.queries[0]!, queryKey: roxKeys.inbox('ws-a', 'actor', 'memory') }] },
    }
    expect(isRestorableRoxQueryCache(inbox, 2_000)).toBe(false)
    expect(isRestorableRoxQueryCache(null)).toBe(false)
  })

  it('restored entries paint and are revalidated on first read', () => {
    const record = buildPersistedRoxQueryCache(seed(), 'ws-a', Date.now())!
    const fresh = createRoxQueryClient()
    restoreRoxQueryCache(fresh, record)
    expect(fresh.getQueryData(roxKeys.notesList('ws-a'))).toEqual([{ id: 'n1', title: 'Note' }])
    expect(fresh.getQueryState(roxKeys.notesList('ws-a'))?.isInvalidated).toBe(true)
    expect(fresh.getQueryData(roxKeys.notesList('ws-b'))).toBeUndefined()
  })

  it('writes the last-used workspace at idle time and restores it on start', async () => {
    const storage = memoryStorage()
    const idles: Array<() => void> = []
    const persistence = startRoxQueryPersistence(roxQueryClient(), storage, { debounceMs: 0, idle: run => { idles.push(run); return () => {} } })
    await persistence.ready
    await fetchNotesList('ws-a', async () => [{ id: 'n1' }] as never[])
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(storage.log).not.toContain('write')
    expect(idles.length).toBe(1)
    idles.shift()!()
    await flush()
    expect((storage.value() as PersistedRoxQueryCache).workspaceId).toBe('ws-a')
    persistence.stop()

    const next = createRoxQueryClient()
    const restored = startRoxQueryPersistence(next, storage, { debounceMs: 0, idle: run => { run(); return () => {} } })
    await restored.ready
    expect(next.getQueryData(roxKeys.notesList('ws-a'))).toEqual([{ id: 'n1' }])
    restored.stop()
  })

  it('clear() (identity change) wins over an in-flight restore', async () => {
    const record = buildPersistedRoxQueryCache(seed(), 'ws-a', Date.now())!
    const storage = memoryStorage(record)
    const next = createRoxQueryClient()
    const persistence = startRoxQueryPersistence(next, storage, { debounceMs: 0 })
    await persistence.clear()
    await persistence.ready
    expect(next.getQueryData(roxKeys.notesList('ws-a'))).toBeUndefined()
    expect(storage.value()).toBeUndefined()
    persistence.stop()
  })
})

describe('event bridge', () => {
  function fakeApi() {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const api = new Proxy({}, {
      get: (_target, name: string) => (callback: (...args: unknown[]) => void) => { listeners.set(name, callback); return () => listeners.delete(name) },
    })
    return { api: api as never, emit: (name: string, ...args: unknown[]) => listeners.get(name)?.(...args), listeners }
  }

  it('invalidates the affected workspace and domain only', () => {
    const client = roxQueryClient()
    client.setQueryData(roxKeys.agentsCatalog('a'), { sources: [], skills: [] })
    client.setQueryData(roxKeys.agentsCatalog('b'), { sources: [], skills: [] })
    client.setQueryData(roxKeys.inbox('a', 'actor', 'memory'), [])
    client.setQueryData(roxKeys.inbox('a', 'actor', 'senders'), [])
    client.setQueryData(roxKeys.workspaceWork('a'), { workspaceId: 'a', revision: 5 })
    const { api, emit } = fakeApi()
    const stop = startRoxQueryEventBridge(client, api)
    emit('onSkillsChanged', 'a', [])
    expect(client.getQueryState(roxKeys.agentsCatalog('a'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(roxKeys.agentsCatalog('b'))?.isInvalidated).toBe(false)
    emit('onMemoryChanged', 'a', 'both')
    expect(client.getQueryState(roxKeys.inbox('a', 'actor', 'memory'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(roxKeys.inbox('a', 'actor', 'senders'))?.isInvalidated).toBe(false)
    emit('onWorkspaceWorkChanged', 'a', 5)
    expect(client.getQueryState(roxKeys.workspaceWork('a'))?.isInvalidated).toBe(false)
    emit('onWorkspaceWorkChanged', 'a', 6)
    expect(client.getQueryState(roxKeys.workspaceWork('a'))?.isInvalidated).toBe(true)
    stop()
  })

  it('drops everything on an identity change', () => {
    const client = roxQueryClient()
    client.setQueryData(roxKeys.notesList('a'), [])
    let cleared = 0
    const { api, emit } = fakeApi()
    const stop = startRoxQueryEventBridge(client, api, { onIdentityChanged: () => { cleared++ } })
    emit('onIdentityChanged')
    expect(client.getQueryData(roxKeys.notesList('a'))).toBeUndefined()
    expect(cleared).toBe(1)
    stop()
  })
})

describe('useWorkspaceWork on the shared cache', () => {
  function snapshot(workspaceId: string, revision: number): WorkspaceWorkSnapshot {
    return { ...emptyWorkspaceWorkState(workspaceId), revision, access: { actorId: 'owner', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }
  }

  function installApi(revision: { value: number }) {
    const reads: string[] = []
    const changed = new Set<(workspaceId: string, revision: number) => void>()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => { reads.push(workspaceId); await flush(); return snapshot(workspaceId, revision.value) },
      workspaceWorkWrite: async (workspaceId: string, input: { expectedRevision: number }) => ({ snapshot: snapshot(workspaceId, input.expectedRevision + 1), receipt: {} }),
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: (callback: (workspaceId: string, revision: number) => void) => { changed.add(callback); return () => changed.delete(callback) },
    }
    return { reads, emit: (workspaceId: string, next: number) => { for (const callback of changed) callback(workspaceId, next) } }
  }

  async function mount(views: number, seen: Array<number | null>) {
    function View() {
      const work = useWorkspaceWork('ws')
      seen.push(work.snapshot?.revision ?? null)
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<>{Array.from({ length: views }, (_, index) => <View key={index} />)}</>) })
    await act(async () => { await flush(); await flush() })
    return () => act(async () => { root.unmount() })
  }

  it('two views share one read; a revisit paints at once with zero reads', async () => {
    const revision = { value: 3 }
    const api = installApi(revision)
    const firstSeen: Array<number | null> = []
    const unmount = await mount(2, firstSeen)
    expect(api.reads).toEqual(['ws'])
    expect(firstSeen[0]).toBeNull()
    await unmount()

    const revisit: Array<number | null> = []
    const unmountAgain = await mount(1, revisit)
    expect(revisit[0]).toBe(3)
    expect(api.reads).toEqual(['ws'])
    await unmountAgain()
  })

  it('a newer revision announced while away is painted from cache, then revalidated', async () => {
    const revision = { value: 3 }
    const api = installApi(revision)
    const stop = startRoxQueryEventBridge(roxQueryClient(), window.electronAPI as never)
    const unmount = await mount(1, [])
    await unmount()
    revision.value = 4
    api.emit('ws', 4)
    const revisit: Array<number | null> = []
    const unmountAgain = await mount(1, revisit)
    expect(revisit[0]).toBe(3)
    expect(revisit.at(-1)).toBe(4)
    expect(api.reads).toEqual(['ws', 'ws'])
    await unmountAgain()
    stop()
  })
})

describe('useWorkspaceWork writes from a verified revision', () => {
  it('a write issued while a cached snapshot revalidates uses the fresh revision', async () => {
    const writes: number[] = []
    let serverRevision = 4
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      workspaceWorkRead: async (workspaceId: string) => { await flush(); return { ...emptyWorkspaceWorkState(workspaceId), revision: serverRevision, access: { actorId: 'o', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] } },
      workspaceWorkWrite: async (workspaceId: string, input: { expectedRevision: number }) => {
        writes.push(input.expectedRevision)
        serverRevision = input.expectedRevision + 1
        return { snapshot: { ...emptyWorkspaceWorkState(workspaceId), revision: serverRevision, access: { actorId: 'o', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }, receipt: {} }
      },
      workspaceWorkDelete: async () => { throw new Error('unused') },
      workspaceWorkSnapshotProfile: async () => null,
      onWorkspaceWorkChanged: () => () => {},
    }
    const client = roxQueryClient()
    client.setQueryData(roxKeys.workspaceWork('ws'), { ...emptyWorkspaceWorkState('ws'), revision: 3, access: { actorId: 'o', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] })
    await client.invalidateQueries({ queryKey: roxKeys.workspaceWork('ws'), refetchType: 'none' })
    let handle: ReturnType<typeof useWorkspaceWork> | null = null
    function View() { handle = useWorkspaceWork('ws'); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<View />) })
    expect(handle!.snapshot?.revision).toBe(3)
    let ok = false
    await act(async () => { ok = await handle!.write({ kind: 'createTask', input: { title: 'T' } } as never) })
    expect(ok).toBe(true)
    expect(writes).toEqual([4])
    expect(client.getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork('ws'))?.revision).toBe(5)
    await act(async () => { root.unmount() })
  })
})

describe('surface wiring (source guards)', () => {
  const read = (file: string) => readFileSync(join(renderer, file), 'utf8')
  it('notes, home, agents, inbox and feed read through the shared cache', () => {
    expect(read('pages/NotesPage.tsx')).toContain('fetchNotesList(activeWorkspaceId')
    expect(read('pages/NotesPage.tsx')).toContain('notesTaskCache<NoteTask>(activeWorkspaceId)')
    expect(read('platform/home/widgets.tsx')).toContain('fetchNotesList(workspaceId')
    expect(read('pages/workspace-work/AgentProfilesView.tsx')).toContain('roxKeys.agentsCatalog(workspaceId)')
    expect(read('hooks/useInboxItems.ts')).toContain('roxKeys.inbox(workspaceId, captured.actorKey!, key)')
    expect(read('pages/FeedPage.tsx')).toContain('roxKeys.feed(workspaceId, caller.preferenceKey)')
  })

  it('the runtime starts before the first React render', () => {
    const main = read('main.tsx')
    const start = main.indexOf('startRoxQueryRuntime(window.electronAPI)')
    expect(start).toBeGreaterThan(-1)
    expect(start).toBeLessThan(main.indexOf('ReactDOM.createRoot('))
  })
})
