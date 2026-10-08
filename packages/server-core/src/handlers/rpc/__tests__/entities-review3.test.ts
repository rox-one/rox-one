/**
 * Review 3 regressions for the entity RPC surface:
 * - #4: `entities:links add` canonicalises `t-`/`k-`/`seq-` fragments, so
 *   the RPC can never store a second encoding of the same ref.
 * - #7: `invalidateEntity` targets only its workspace host.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { entityRoute, type EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import { invalidateEntity, registerEntitiesHandlers, registerEntityResolver, resetEntityResolvers } from '../entities.ts'

const roots: string[] = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
})

afterEach(() => {
  closeEntityLinkStores()
  resetEntityResolvers()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const rootA = mkdtempSync(join(tmpdir(), 'rox-entity-r3a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'rox-entity-r3b-'))
  roots.push(rootA, rootB)
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {},
  } as unknown as RpcServer
  const workspaces: Record<string, { id: string; rootPath: string }> = {
    A: { id: 'A', rootPath: rootA },
    B: { id: 'B', rootPath: rootB },
  }
  registerEntitiesHandlers(server, {} as HandlerDeps, { workspaceFor: id => workspaces[id] ?? null })
  const ctx = (workspaceId: string): RequestContext => ({ clientId: 'test', workspaceId, webContentsId: null })
  const links = (workspaceId: string, payload: unknown) =>
    Promise.resolve(handlers.get(RPC_CHANNELS.entities.LINKS)!(ctx(workspaceId), workspaceId, payload))
  const resolve = (workspaceId: string, refs: EntityRef[]) =>
    Promise.resolve(handlers.get(RPC_CHANNELS.entities.RESOLVE)!(ctx(workspaceId), workspaceId, { refs })) as Promise<Array<{ title: string }>>
  return { links, resolve }
}

describe('entities:links add canonicalises fragments (review 3 #4)', () => {
  it('stores one encoding for t-3 and 3', async () => {
    const f = fixture()
    const note: EntityRef = { kind: 'note', id: 'n1' }
    const first = await f.links('A', { op: 'add', from: note, to: { kind: 'goal-target', id: 'g1', fragment: 't-3' }, relation: 'mentions' }) as {
      ok: true
      link: { to: EntityRef; revision: number; linkId: string }
    }
    expect(first.link.to).toEqual({ kind: 'goal-target', id: 'g1', fragment: '3' })
    expect(entityRoute(first.link.to)).not.toContain('t-t-')
    const second = await f.links('A', { op: 'add', from: note, to: { kind: 'goal-target', id: 'g1', fragment: '3' }, relation: 'mentions' }) as {
      ok: true
      link: { revision: number; linkId: string }
    }
    expect(second.link.linkId).toBe(first.link.linkId)
    expect(second.link.revision).toBe(2)
    const backlinks = await f.links('A', { op: 'backlinks', ref: { kind: 'goal-target', id: 'g1', fragment: '3' } }) as { links: unknown[] }
    expect(backlinks.links).toHaveLength(1)
  })
})

describe('invalidateEntity is scoped to its workspace (review 3 #7)', () => {
  it('drops only the named workspace host cache', async () => {
    const f = fixture()
    let calls = 0
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs) {
        calls += 1
        return refs.map(ref => ({
          ref,
          status: 'ok' as const,
          title: `v${calls}`,
          kindLabel: 'entities.kind.note',
          icon: 'note',
          authority: 'local' as const,
          etag: `e${calls}`,
        }))
      },
    })
    const ref: EntityRef = { kind: 'note', id: 'n1' }
    await f.resolve('A', [ref])
    await f.resolve('B', [ref])
    expect(calls).toBe(2)
    invalidateEntity('A', ref)
    await f.resolve('A', [ref])
    expect(calls).toBe(3)
    await f.resolve('B', [ref])
    expect(calls).toBe(3)
  })
})
