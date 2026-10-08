import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { ENTITIES_LINKS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import { resetEntitiesWorkbenchFlags, setEntitiesWorkbenchFlags } from '../../../entities/workbench-flags.ts'
import {
  invalidateEntity,
  invalidateWorkspaceEntities,
  registerEntitiesHandlers,
  registerEntityResolver,
  resetEntityResolvers,
  type EntitiesHandlerRuntime,
} from '../entities.ts'

const roots: string[] = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  resetEntitiesWorkbenchFlags()
})

afterEach(() => {
  closeEntityLinkStores()
  resetEntityResolvers()
  resetEntitiesWorkbenchFlags()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(runtime: EntitiesHandlerRuntime = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-entity-live-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const shutdowns: Array<() => void> = []
  const server = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
    push() {},
    onShutdown(dispose: () => void) {
      shutdowns.push(dispose)
      return () => {}
    },
  } as unknown as RpcServer
  registerEntitiesHandlers(server, {} as HandlerDeps, {
    workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null),
    ...runtime,
  })
  const ctx: RequestContext = { clientId: 'test', workspaceId: 'ws', webContentsId: null }
  const links = (payload: unknown, asWorkspace = 'ws', asCtx: RequestContext = ctx) =>
    Promise.resolve(handlers.get(RPC_CHANNELS.entities.LINKS)!(asCtx, asWorkspace, payload))
  const resolve = (payload: unknown, asWorkspace = 'ws', asCtx: RequestContext = ctx) =>
    Promise.resolve(handlers.get(RPC_CHANNELS.entities.RESOLVE)!(asCtx, asWorkspace, payload))
  return { links, resolve, shutdowns, ctx }
}

const note: EntityRef = { kind: 'note', id: 'n1' }

const noteResolver = (tag: string) => ({
  kinds: ['note' as const],
  async resolve(refs: EntityRef[], _actor: unknown): Promise<EntityPreview[]> {
    return refs.map(ref => ({
      ref,
      status: 'ok' as const,
      title: `${tag}:${ref.id}`,
      kindLabel: 'entities.kind.note',
      icon: 'link',
      authority: 'local' as const,
      etag: 'e1',
    }))
  },
})

describe('entities handlers: live workbench flag source', () => {
  it('a live getter applies toggles without re-registering', async () => {
    let enabled = false
    const f = fixture({ enabledWorkbenchFlags: () => (enabled ? new Set([ENTITIES_LINKS_WORKBENCH_FLAG]) : new Set()) })
    expect(await f.links({ op: 'outgoing', ref: note })).toEqual({ ok: true, op: 'outgoing', links: [] })
    enabled = true
    const added = (await f.links({ op: 'add', from: note, to: { kind: 'task', id: 't1' }, relation: 'mentions' })) as {
      ok: boolean
    }
    expect(added.ok).toBe(true)
    enabled = false
    expect(await f.links({ op: 'outgoing', ref: note })).toEqual({ ok: true, op: 'outgoing', links: [] })
  })

  it('the process-wide live source enables handlers (main publishes renderer toggles there)', async () => {
    const f = fixture()
    expect(await f.links({ op: 'outgoing', ref: note })).toEqual({ ok: true, op: 'outgoing', links: [] })
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    const added = (await f.links({ op: 'add', from: note, to: { kind: 'task', id: 't1' }, relation: 'mentions' })) as {
      ok: boolean
    }
    expect(added.ok).toBe(true)
  })

  it('env override still wins over the live source in both directions', async () => {
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '0'
    const f = fixture()
    expect(await f.links({ op: 'outgoing', ref: note })).toEqual({ ok: true, op: 'outgoing', links: [] })
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    resetEntitiesWorkbenchFlags()
    const added = (await f.links({ op: 'add', from: note, to: { kind: 'task', id: 't1' }, relation: 'mentions' })) as {
      ok: boolean
    }
    expect(added.ok).toBe(true)
  })
})

describe('entities:resolve workspace trust', () => {
  it('rejects cross-workspace resolve for native principals (FORBIDDEN)', async () => {
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    registerEntityResolver(noteResolver('v1'))
    const f = fixture()
    const nativeCtx: RequestContext = {
      clientId: 'native',
      workspaceId: 'ws',
      webContentsId: null,
      principal: { credentialId: 'c1' } as unknown as RequestContext['principal'],
    }
    await expect(f.resolve({ refs: [note] }, 'other', nativeCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const previews = (await f.resolve({ refs: [note] }, 'ws', nativeCtx)) as EntityPreview[]
    expect(previews[0]).toMatchObject({ status: 'ok', title: 'v1:n1' })
  })

  it('unknown workspace ids fail before any host is allocated', async () => {
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    const f = fixture()
    await expect(f.resolve({ refs: [note] }, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(f.links({ op: 'outgoing', ref: note }, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('preview invalidation exports', () => {
  it('invalidateEntity drops the cached preview; workspace invalidate clears all', async () => {
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    let calls = 0
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs: EntityRef[]): Promise<EntityPreview[]> {
        calls++
        return refs.map(ref => ({
          ref,
          status: 'ok' as const,
          title: `v${calls}`,
          kindLabel: 'entities.kind.note',
          icon: 'link',
          authority: 'local' as const,
          etag: 'e1',
        }))
      },
    })
    const f = fixture()
    const first = (await f.resolve({ refs: [note] })) as EntityPreview[]
    expect(first[0]!.title).toBe('v1')
    const cached = (await f.resolve({ refs: [note] })) as EntityPreview[]
    expect(cached[0]!.title).toBe('v1')
    invalidateEntity('ws', note)
    const after = (await f.resolve({ refs: [note] })) as EntityPreview[]
    expect(after[0]!.title).toBe('v2')
    invalidateWorkspaceEntities('ws')
    const cleared = (await f.resolve({ refs: [note] })) as EntityPreview[]
    expect(cleared[0]!.title).toBe('v3')
    expect(calls).toBe(3)
  })

  it('registers link-store teardown on server shutdown', () => {
    setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    const f = fixture()
    expect(f.shutdowns.length).toBeGreaterThan(0)
  })
})
