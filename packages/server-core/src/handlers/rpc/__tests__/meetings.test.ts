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
  it('registers list/get/search/delete', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.meetings.LIST,
      RPC_CHANNELS.meetings.GET,
      RPC_CHANNELS.meetings.SEARCH,
      RPC_CHANNELS.meetings.DELETE,
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
})
