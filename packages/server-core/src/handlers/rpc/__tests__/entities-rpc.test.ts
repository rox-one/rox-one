import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import { registerEntitiesHandlers, registerEntityResolver, resetEntityResolvers, type EntitiesHandlerRuntime } from '../entities.ts'

const roots: string[] = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_ENTITIES_LINKS
})

afterEach(() => {
  closeEntityLinkStores()
  resetEntityResolvers()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Push {
  channel: string
  target: unknown
  args: unknown[]
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-entity-rpc-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const options = new Map<string, RpcHandlerOptions | undefined>()
  const pushes: Push[] = []
  const server = {
    handle(channel: string, handler: HandlerFn, handlerOptions?: RpcHandlerOptions) {
      handlers.set(channel, handler)
      options.set(channel, handlerOptions)
    },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
  } as unknown as RpcServer
  const runtime: EntitiesHandlerRuntime = { workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null) }
  registerEntitiesHandlers(server, {} as HandlerDeps, runtime)
  const ctx: RequestContext = { clientId: 'test', workspaceId: 'ws', webContentsId: null }
  const links = (payload: unknown, context = ctx, workspaceId = 'ws') => Promise.resolve(handlers.get(RPC_CHANNELS.entities.LINKS)!(context, workspaceId, payload))
  const resolve = (payload: unknown, context = ctx) => Promise.resolve(handlers.get(RPC_CHANNELS.entities.RESOLVE)!(context, 'ws', payload))
  return { root, handlers, options, pushes, links, resolve, ctx }
}

const note: EntityRef = { kind: 'note', id: 'n1' }
const task: EntityRef = { kind: 'task', id: 't1' }

describe('entities:links handler', () => {
  it('is inert while the flag is off', async () => {
    delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    const f = fixture()

    expect(await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })).toEqual({ ok: false, reason: 'disabled' })
    expect(await f.links({ op: 'remove', from: note, to: task, relation: 'mentions' })).toEqual({ ok: false, reason: 'disabled' })
    expect(await f.links({ op: 'outgoing', ref: note })).toEqual({ ok: true, op: 'outgoing', links: [] })
    expect(await f.links({ op: 'backlinks', ref: task })).toEqual({ ok: true, op: 'backlinks', links: [] })
    expect(await f.resolve({ refs: [note] })).toEqual([])
    expect(f.pushes).toHaveLength(0)
  })

  it('adds, dedupes, lists and removes links when enabled, pushing workspace changes', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()

    const added = (await f.links({ op: 'add', from: note, to: task, relation: 'mentions', anchor: { line: 4 } })) as { ok: true; link: { linkId: string; createdBy: string; revision: number } }
    expect(added.ok).toBe(true)
    expect(added.link.createdBy).toBe('local')
    expect(added.link.revision).toBe(1)
    expect(f.pushes).toEqual([{ channel: RPC_CHANNELS.entities.LINKS_CHANGED, target: { to: 'workspace', workspaceId: 'ws' }, args: ['ws'] }])

    const again = (await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })) as { ok: true; link: { linkId: string; revision: number } }
    expect(again.link.linkId).toBe(added.link.linkId)
    expect(again.link.revision).toBe(2)

    const outgoing = (await f.links({ op: 'outgoing', ref: note })) as { ok: true; links: unknown[] }
    expect(outgoing.links).toHaveLength(1)
    const backlinks = (await f.links({ op: 'backlinks', ref: task })) as { ok: true; links: unknown[] }
    expect(backlinks.links).toHaveLength(1)

    expect(f.pushes).toHaveLength(2)
    expect(await f.links({ op: 'remove', from: note, to: task, relation: 'mentions' })).toEqual({ ok: true, op: 'remove', removed: true })
    expect(await f.links({ op: 'remove', from: note, to: task, relation: 'mentions' })).toEqual({ ok: true, op: 'remove', removed: false })
    expect(f.pushes).toHaveLength(3)
  })

  it('rejects malformed payloads and unknown workspaces', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()
    expect(f.links({ op: 'add', from: note, to: task, relation: 'squishes' })).rejects.toThrow()
    expect(f.links({ op: 'outgoing', ref: { kind: 'note' } })).rejects.toThrow()
    expect(f.links({ op: 'outgoing', ref: note }, f.ctx, 'other')).rejects.toThrow('Workspace not found')
  })

  it('uses a verified actor as the link author', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()
    const actorCtx: RequestContext = {
      ...f.ctx,
      actor: { principalId: 'principal-9', deviceId: 'd', sessionId: 's', authenticatedWorkspaceIds: ['ws'], expiresAt: 0 },
    }
    const added = (await f.links({ op: 'add', from: note, to: task, relation: 'mentions' }, actorCtx)) as { ok: true; link: { createdBy: string } }
    expect(added.link.createdBy).toBe('principal-9')
  })
})

describe('entities:resolve handler', () => {
  it('resolves local kinds through registered resolvers and returns previews', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs) {
        return refs.map(ref => ({
          ref,
          status: 'ok' as const,
          title: `Note ${ref.id}`,
          kindLabel: 'entities.kind.note',
          icon: 'note',
          authority: 'local' as const,
          etag: 'e1',
        }))
      },
    })

    const previews = (await f.resolve({ refs: [note, { kind: 'goal', id: 'g1' }] })) as Array<{ ref: EntityRef; status: string; title: string }>
    expect(previews).toHaveLength(2)
    expect(previews[0]).toMatchObject({ status: 'ok', title: 'Note n1' })
    expect(previews[1]).toMatchObject({ ref: { kind: 'goal', id: 'g1' }, status: 'unavailable' })
    expect(f.options.get(RPC_CHANNELS.entities.RESOLVE)?.nativeAction).toBe('read')
  })

  it('caps the batch at 500 refs', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()
    const refs = Array.from({ length: 501 }, (_, i) => ({ kind: 'note' as const, id: `n${i}` }))
    expect(f.resolve({ refs })).rejects.toThrow()
  })
})