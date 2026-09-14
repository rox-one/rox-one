import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { encodeMeetingCursor, type MeetingQueryRecord } from '../../../meetings/queries.ts'
import { saveMeetingQueryIndex } from '../../../meetings/query-store.ts'
import { HANDLED_CHANNELS, registerMeetingsHandlers } from '../meetings.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness(opts: {
  dir: string
  allowed?: boolean
}) {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  }
  registerMeetingsHandlers(server as unknown as RpcServer, {} as never, {
    resolveActor: (workspaceId) => ({ workspaceId, allowed: opts.allowed !== false }),
    resolveStoreDir: () => opts.dir,
  })
  return {
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing ${channel}`)
      return handler({}, ...args) as Promise<T>
    },
  }
}

function meeting(partial: Partial<MeetingQueryRecord> & Pick<MeetingQueryRecord, 'id'>): MeetingQueryRecord {
  return {
    workspaceId: 'ws-a',
    title: partial.title ?? partial.id,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe('meetings RPC (issue 368)', () => {
  it('registers list/read/lifecycle/segments and export channels', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.meetings.LIST,
      RPC_CHANNELS.meetings.READ,
      RPC_CHANNELS.meetings.GET,
      RPC_CHANNELS.meetings.CREATE,
      RPC_CHANNELS.meetings.START,
      RPC_CHANNELS.meetings.PAUSE,
      RPC_CHANNELS.meetings.RESUME,
      RPC_CHANNELS.meetings.STOP,
      RPC_CHANNELS.meetings.SEARCH,
      RPC_CHANNELS.meetings.SEGMENTS,
      RPC_CHANNELS.meetings.SUBSCRIBE,
      RPC_CHANNELS.meetings.CORRECT_SEGMENT,
      RPC_CHANNELS.meetings.ADD_MANUAL_NOTE,
      RPC_CHANNELS.meetings.DELETE,
      RPC_CHANNELS.meetings.EXPORT,
      RPC_CHANNELS.meetings.IMPORT,
      RPC_CHANNELS.meetings.SHARE,
      RPC_CHANNELS.meetings.REVOKE_SHARE,
    ])
  })

  it('applies ACL before search and does not treat denied as empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-rpc-'))
    await saveMeetingQueryIndex(dir, [meeting({ id: 'm1', title: 'Standup', sources: [{ id: 's', text: 'roadmap' }] })])
    const denied = createHarness({ dir, allowed: false })
    expect(await denied.invoke(RPC_CHANNELS.meetings.LIST, 'ws-a')).toEqual({ items: [], state: 'denied' })
    expect(await denied.invoke(RPC_CHANNELS.meetings.SEARCH, 'ws-a', 'roadmap')).toEqual({ items: [], state: 'denied' })
    expect(await denied.invoke(RPC_CHANNELS.meetings.GET, 'ws-a', 'm1')).toEqual({ state: 'denied' })
    await expect(denied.invoke(RPC_CHANNELS.meetings.DELETE, 'ws-a', 'm1')).rejects.toThrow('denied')
  })

  it('tombstones a delete and keeps it after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-rpc-'))
    await saveMeetingQueryIndex(dir, [
      meeting({ id: 'm1', title: 'Keep', updatedAt: 2 }),
      meeting({ id: 'm2', title: 'Drop', updatedAt: 1 }),
    ])
    const first = createHarness({ dir })
    const deleted = await first.invoke<{ state: string; meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.DELETE, 'ws-a', 'm2')
    expect(deleted.state).toBe('deleted')
    expect(deleted.meeting?.title).toBe('Drop')
    const listed = await first.invoke<{ items: MeetingQueryRecord[]; state: string }>(RPC_CHANNELS.meetings.LIST, 'ws-a')
    expect(listed.items.map((item) => item.id)).toEqual(['m1'])
    const restarted = createHarness({ dir })
    const after = await restarted.invoke<{ state: string; meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.GET, 'ws-a', 'm2')
    expect(after.state).toBe('deleted')
    expect(after.meeting?.title).toBe('Drop')
  })

  it('rejects a stale cursor and hides private sources from search', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-rpc-'))
    await saveMeetingQueryIndex(dir, [
      meeting({ id: 'm1', title: 'Alpha', updatedAt: 3 }),
      meeting({
        id: 'm2',
        title: 'Beta',
        updatedAt: 2,
        sources: [
          { id: 'public', text: 'roadmap' },
          { id: 'secret', private: true, text: 'salary-band' },
        ],
      }),
    ])
    const rpc = createHarness({ dir })
    const first = await rpc.invoke<{ items: MeetingQueryRecord[]; nextCursor?: string }>(RPC_CHANNELS.meetings.LIST, 'ws-a', { limit: 1 })
    expect(first.items.map((item) => item.id)).toEqual(['m1'])
    expect(first.nextCursor).toBe(encodeMeetingCursor(first.items[0]!))
    await expect(rpc.invoke(RPC_CHANNELS.meetings.LIST, 'ws-a', {
      cursor: encodeMeetingCursor({ id: 'gone', updatedAt: 9 }),
      limit: 1,
    })).rejects.toThrow('stale-cursor')
    const found = await rpc.invoke<{ items: MeetingQueryRecord[] }>(RPC_CHANNELS.meetings.SEARCH, 'ws-a', 'roadmap')
    expect(found.items.map((item) => item.id)).toEqual(['m2'])
    const hidden = await rpc.invoke<{ items: MeetingQueryRecord[]; state: string }>(RPC_CHANNELS.meetings.SEARCH, 'ws-a', 'salary-band')
    expect(hidden.items).toEqual([])
    expect(hidden.state).toBe('empty')
  })

  it('rejects a forged session workspace and exports without private notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-rpc-'))
    await saveMeetingQueryIndex(dir, [meeting({
      id: 'm1',
      title: 'Standup',
      sources: [
        { id: 'public', text: 'roadmap' },
        { id: 'secret', private: true, text: 'salary-band' },
      ],
    })])
    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    }
    registerMeetingsHandlers(server as unknown as RpcServer, {} as never, {
      resolveActor: (workspaceId) => ({ workspaceId, allowed: true, accountId: 'acct-1' }),
      resolveStoreDir: () => dir,
    })
    const invoke = <T>(channel: string, ctx: unknown, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing ${channel}`)
      return handler(ctx, ...args) as Promise<T>
    }
    await expect(invoke(RPC_CHANNELS.meetings.LIST, { workspaceId: 'ws-a' }, 'ws-other')).rejects.toThrow('forged-workspace')
    const bundle = await invoke<{ notes: Array<{ audience: string; text: string }> }>(
      RPC_CHANNELS.meetings.EXPORT,
      { workspaceId: 'ws-a' },
      'ws-a',
      'm1',
      { format: 'json', audience: 'shared' },
    )
    expect(bundle.notes.some((note) => note.text.includes('salary-band'))).toBe(false)
    expect(bundle.notes.some((note) => note.text.includes('roadmap'))).toBe(true)
  })

  it('creates, starts, notes, and corrects a segment through RPC', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-rpc-'))
    const rpc = createHarness({ dir })
    const created = await rpc.invoke<{ meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.CREATE, 'ws-a', {
      commandId: 'cmd-1',
      id: 'm-new',
      title: 'Standup',
    })
    expect(created.meeting?.id).toBe('m-new')
    const started = await rpc.invoke<{ meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.START, 'ws-a', 'm-new')
    expect(started.meeting?.status).toBe('capturing')
    expect(started.meeting?.capture).toBe('device-required')
    await rpc.invoke(RPC_CHANNELS.meetings.ADD_MANUAL_NOTE, 'ws-a', 'm-new', { note: 'keep this' })
    const corrected = await rpc.invoke<{ meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.CORRECT_SEGMENT, 'ws-a', 'm-new', {
      streamId: 's1',
      segmentId: 'seg1',
      revision: 2,
      text: 'Срок — понедельник',
    })
    expect(corrected.meeting?.manualNotes).toContain('keep this')
    expect(corrected.meeting?.segments?.[0]?.text).toBe('Срок — понедельник')
    const read = await rpc.invoke<{ meeting?: MeetingQueryRecord }>(RPC_CHANNELS.meetings.READ, 'ws-a', 'm-new')
    expect(read.meeting?.id).toBe('m-new')
    const subscribed = await rpc.invoke<{ items: unknown[] }>(RPC_CHANNELS.meetings.SUBSCRIBE, 'ws-a', 'm-new')
    expect(subscribed.items).toHaveLength(1)
  })

  it('shares and revokes a member without leaking private notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-share-'))
    await saveMeetingQueryIndex(dir, [meeting({
      id: 'm1',
      title: 'Standup',
      sources: [
        { id: 'public', text: 'roadmap' },
        { id: 'secret', private: true, text: '123-45-6789' },
      ],
    })])
    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    }
    registerMeetingsHandlers(server as unknown as RpcServer, {} as never, {
      resolveActor: (workspaceId) => ({ workspaceId, allowed: true, accountId: 'acct-1' }),
      resolveStoreDir: () => dir,
    })
    const invoke = <T>(channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing ${channel}`)
      return handler({}, ...args) as Promise<T>
    }
    const shared = await invoke<{ members: Array<{ accountId: string }> }>(
      RPC_CHANNELS.meetings.SHARE,
      'ws-a',
      'm1',
      { accountId: 'acct-2' },
    )
    expect(shared.members.some((member) => member.accountId === 'acct-2')).toBe(true)
    const revoked = await invoke<{ members: Array<{ accountId: string; revokedAt?: number }> }>(
      RPC_CHANNELS.meetings.REVOKE_SHARE,
      'ws-a',
      'm1',
      { accountId: 'acct-2' },
    )
    expect(revoked.members.find((member) => member.accountId === 'acct-2')?.revokedAt).toBeDefined()
  })
})
