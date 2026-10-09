/**
 * PERF-09 (#1576) review round 3: regression tests for every finding.
 */
import { installDom, uninstallDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { QueryObserver, type QueryClient } from '@tanstack/react-query'
import { createRoxQueryClient, isRecentlyRead, resetRoxQueryClientForTests, roxQueryClient } from '../client'
import { roxKeys } from '../keys'
import { startRoxQueryEventBridge } from '../event-bridge'
import { fetchNotesList } from '../notes-cache'
import { invalidateRoxQueries, sharedRead } from '../shared-read'
import { resetAnnouncedWorkspaceWorkRevisions } from '../workspace-work-revision'

installDom()
afterAll(() => uninstallDom())

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 8; i++) await flush() }

beforeEach(() => {
  resetRoxQueryClientForTests(createRoxQueryClient())
  resetAnnouncedWorkspaceWorkRevisions()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function eventApi() {
  const listeners = new Map<string, () => void>()
  const value = {
    onIdentityChanged: (callback: () => void) => { listeners.set('identity', callback); return () => listeners.delete('identity') },
    onReconnected: (callback: () => void) => { listeners.set('reconnected', callback); return () => listeners.delete('reconnected') },
    onNotesChanged: (callback: (payload: unknown) => void) => { listeners.set('notes', () => callback('ws')); return () => listeners.delete('notes') },
  }
  return { value, emit: (name: 'identity' | 'reconnected' | 'notes') => listeners.get(name)?.() }
}

/** A bridge whose principal reads are answered one by one, in any order. */
function bridge(client: QueryClient, initial = 'A') {
  const reads: Array<ReturnType<typeof deferred<string | null>>> = []
  const { value, emit } = eventApi()
  const outcome = { cleared: 0, confirmed: 0 }
  const stop = startRoxQueryEventBridge(client, value as never, {
    initialPrincipal: Promise.resolve(initial),
    principal: () => { const read = deferred<string | null>(); reads.push(read); return read.promise },
    onIdentityChanged: () => { outcome.cleared++ },
    onIdentityConfirmed: () => { outcome.confirmed++ },
  })
  return { reads, emit, outcome, stop }
}

function seed(client: QueryClient) {
  client.setQueryData(roxKeys.notesList('ws'), [{ id: 'A-private' }])
  client.setQueryData(roxKeys.agentsCatalog('ws'), { sources: [{ slug: 'A-source', name: 'A' }], skills: [] })
  client.setQueryData(roxKeys.feed('ws', 'caller-A'), { items: [] })
}

describe('error: overlapping identity/reconnect checks compare against the confirmed principal', () => {
  it('reconnect then identity:changed across A→B clears; A\'s parked entries never come back', async () => {
    const client = roxQueryClient()
    seed(client)
    const { reads, emit, outcome, stop } = bridge(client)
    emit('reconnected')
    emit('identity')
    reads[0]!.resolve('B')
    reads[1]!.resolve('B')
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 0 })
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    expect(client.getQueryData(roxKeys.agentsCatalog('ws'))).toBeUndefined()
    expect(client.getQueryCache().getAll()).toEqual([])
    stop()
  })

  it('identity:changed twice across A→B clears', async () => {
    const client = roxQueryClient()
    seed(client)
    const { reads, emit, outcome, stop } = bridge(client)
    emit('identity')
    emit('identity')
    reads[0]!.resolve('B')
    reads[1]!.resolve('B')
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 0 })
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    stop()
  })

  it('A→B→A inside one chain still clears (a superseded check keeps its "differs")', async () => {
    const client = roxQueryClient()
    seed(client)
    const { reads, emit, outcome, stop } = bridge(client)
    emit('identity')
    emit('reconnected')
    reads[0]!.resolve('B')
    reads[1]!.resolve('A')
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 0 })
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    stop()
  })

  it('the newest check waits for older ones: an older read that resolves last and differs still clears', async () => {
    const client = roxQueryClient()
    seed(client)
    const { reads, emit, outcome, stop } = bridge(client)
    emit('reconnected')
    emit('identity')
    reads[1]!.resolve('A')
    await settle()
    expect(outcome).toEqual({ cleared: 0, confirmed: 0 })
    reads[0]!.resolve(null)
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 0 })
    stop()
  })

  it('after a clear the new principal is the confirmed one: B→B confirms, then B→A clears', async () => {
    const client = roxQueryClient()
    const { reads, emit, outcome, stop } = bridge(client)
    emit('identity')
    reads[0]!.resolve('B')
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 0 })
    client.setQueryData(roxKeys.notesList('ws'), [{ id: 'B-note' }])
    emit('reconnected')
    emit('identity')
    reads[1]!.resolve('B')
    reads[2]!.resolve('B')
    await settle()
    expect(outcome).toEqual({ cleared: 1, confirmed: 1 })
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'B-note' }])
    expect(client.getQueryState(roxKeys.notesList('ws'))?.isInvalidated).toBe(true)
    emit('identity')
    reads[3]!.resolve('A')
    await settle()
    expect(outcome).toEqual({ cleared: 2, confirmed: 1 })
    stop()
  })

  it('matching overlapping checks confirm once and restore the parked entries', async () => {
    const client = roxQueryClient()
    seed(client)
    const { reads, emit, outcome, stop } = bridge(client)
    emit('reconnected')
    emit('identity')
    reads[0]!.resolve('A')
    reads[1]!.resolve('A')
    await settle()
    expect(outcome).toEqual({ cleared: 0, confirmed: 1 })
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'A-private' }])
    stop()
  })
})

describe('info: a read that started before a change event keeps the entry invalidated', () => {
  it('the late write lands, stays invalidated, and the next mount read revalidates', async () => {
    const client = roxQueryClient()
    const { value, emit } = eventApi()
    const stop = startRoxQueryEventBridge(client, value as never)
    const gate = deferred<never[]>()
    let reads = 0
    const inflight = fetchNotesList('ws', () => { reads++; return gate.promise })
    emit('notes')
    gate.resolve([{ id: 'pre-change' }] as never[])
    await inflight
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'pre-change' }])
    expect(client.getQueryState(roxKeys.notesList('ws'))?.isInvalidated).toBe(true)
    expect(isRecentlyRead(client, roxKeys.notesList('ws'))).toBe(false)
    await fetchNotesList('ws', async () => { reads++; return [{ id: 'post-change' }] as never[] }, { mount: true })
    expect(reads).toBe(2)
    expect(isRecentlyRead(client, roxKeys.notesList('ws'))).toBe(true)
    stop()
  })

  it('counts requests, not TanStack events: a second change on an already invalidated entry is not lost', async () => {
    const client = roxQueryClient()
    const key = roxKeys.inbox('ws', 'actor', 'memory')
    client.setQueryData(key, [])
    await invalidateRoxQueries(client, { queryKey: key, exact: true, refetchType: 'none' })
    const gate = deferred<string[]>()
    const inflight = sharedRead(client, key, () => gate.promise)
    await invalidateRoxQueries(client, { queryKey: key, exact: true, refetchType: 'none' })
    gate.resolve(['late'])
    await inflight
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    // A read that starts after the change clears it as usual.
    await sharedRead(client, key, async () => ['fresh'])
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  })
})

describe('info: parking keeps observed queries bound', () => {
  it('an observed workspace-only query is reset in place (hidden, refetching); unobserved ones are removed', async () => {
    const client = roxQueryClient()
    seed(client)
    let fetches = 0
    const observer = new QueryObserver(client, {
      queryKey: roxKeys.agentsCatalog('ws'),
      queryFn: async () => { fetches++; return { sources: [{ slug: 'fresh', name: 'F' }], skills: [] } },
      staleTime: Infinity,
    })
    const off = observer.subscribe(() => {})
    const bound = client.getQueryCache().find({ queryKey: roxKeys.agentsCatalog('ws'), exact: true })
    const { reads, emit, stop } = bridge(client)
    emit('reconnected')
    // Not paintable from the old principal; the observer still owns the cached query and refetches it.
    expect(client.getQueryCache().find({ queryKey: roxKeys.agentsCatalog('ws'), exact: true })).toBe(bound)
    expect(observer.getCurrentQuery() as unknown).toBe(bound)
    expect(client.getQueryData(roxKeys.notesList('ws'))).toBeUndefined()
    await settle()
    expect(fetches).toBe(1)
    reads[0]!.resolve('A')
    await settle()
    // Confirmed: the newer refetch wins over the parked value, and the reconnect invalidation reaches the observer.
    expect(client.getQueryData<{ sources: Array<{ slug: string }> }>(roxKeys.agentsCatalog('ws'))?.sources[0]!.slug).toBe('fresh')
    expect(fetches).toBe(2)
    expect(client.getQueryData<unknown>(roxKeys.notesList('ws'))).toEqual([{ id: 'A-private' }])
    off()
    stop()
  })
})
