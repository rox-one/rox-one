import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import {
  registerEntitiesHandlers,
  registerEntityResolver,
  resetEntityResolvers,
  type EntitiesHandlerRuntime,
} from '../entities.ts'

const roots: string[] = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  resetEntityResolvers()
})

afterEach(() => {
  closeEntityLinkStores()
  resetEntityResolvers()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(workspaces: Record<string, string> = {}) {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
    push() {},
  } as unknown as RpcServer
  const runtime: EntitiesHandlerRuntime = {
    workspaceFor: id => {
      if (workspaces[id]) return { id, rootPath: workspaces[id]! }
      return null
    },
  }
  registerEntitiesHandlers(server, {} as HandlerDeps, runtime)
  const resolve = (payload: unknown, context: RequestContext, workspaceId: string) =>
    Promise.resolve(handlers.get(RPC_CHANNELS.entities.RESOLVE)!(context, workspaceId, payload))
  return { resolve }
}

const ctxFor = (principalId: string, workspaceId = 'ws'): RequestContext => ({
  clientId: 'test',
  workspaceId,
  webContentsId: null,
  actor: { principalId, deviceId: 'd', sessionId: 's', authenticatedWorkspaceIds: [workspaceId], expiresAt: 0 },
})

const note: EntityRef = { kind: 'note', id: 'n1' }

function preview(ref: EntityRef, title: string): EntityPreview {
  return {
    ref,
    status: 'ok',
    title,
    kindLabel: 'entities.kind.note',
    icon: 'note',
    authority: 'local',
    etag: 'e1',
  }
}

describe('reviewer fix #1 — workspace and actor isolation plus redaction', () => {
  it('does not leak cached previews across workspaces', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const rootA = mkdtempSync(join(tmpdir(), 'rox-ws-a-'))
    const rootB = mkdtempSync(join(tmpdir(), 'rox-ws-b-'))
    roots.push(rootA, rootB)
    const f = fixture({ a: rootA, b: rootB })
    let calls = 0
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs, _actor) {
        calls++
        return refs.map(ref => preview(ref, `ws-call-${calls}`))
      },
    })
    const ctx = ctxFor('u')
    const fromA = (await f.resolve({ refs: [note] }, ctx, 'a')) as EntityPreview[]
    const fromB = (await f.resolve({ refs: [note] }, ctx, 'b')) as EntityPreview[]
    expect(fromA[0]!.title).toBe('ws-call-1')
    expect(fromB[0]!.title).toBe('ws-call-2')
    expect(calls).toBe(2)
  })

  it('does not leak cached previews across actors', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const root = mkdtempSync(join(tmpdir(), 'rox-ws-'))
    roots.push(root)
    const f = fixture({ ws: root })
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs, actor) {
        return refs.map(ref => preview(ref, `for-${actor.id}`))
      },
    })
    const a = (await f.resolve({ refs: [note] }, ctxFor('alice'), 'ws')) as EntityPreview[]
    const b = (await f.resolve({ refs: [note] }, ctxFor('bob'), 'ws')) as EntityPreview[]
    expect(a[0]!.title).toBe('for-alice')
    expect(b[0]!.title).toBe('for-bob')
  })

  it('redacts no_access previews before returning', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const root = mkdtempSync(join(tmpdir(), 'rox-ws-'))
    roots.push(root)
    const f = fixture({ ws: root })
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs, _actor) {
        return refs.map(ref => ({
          ref,
          status: 'no_access' as const,
          title: 'Secret title',
          kindLabel: 'entities.kind.note',
          icon: 'note',
          authority: 'local' as const,
          badges: [{ id: 'b', label: 'Secret badge' }],
          fields: [{ id: 'f', label: 'Secret', value: 'classified' }],
          etag: 'e-secret',
        }))
      },
    })
    const previews = (await f.resolve({ refs: [note] }, ctxFor('alice'), 'ws')) as EntityPreview[]
    expect(previews).toHaveLength(1)
    expect(previews[0]!.status).toBe('no_access')
    expect(previews[0]!.title).toBe('')
    expect(JSON.stringify(previews[0])).not.toContain('Secret')
    expect(JSON.stringify(previews[0])).not.toContain('classified')
    expect(previews[0]).not.toHaveProperty('badges')
    expect(previews[0]).not.toHaveProperty('fields')
  })
})

describe('reviewer fix #2 — reset unregisters resolvers', () => {
  it('drops registrations so later resolves go unavailable', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const root = mkdtempSync(join(tmpdir(), 'rox-ws-'))
    roots.push(root)
    const f = fixture({ ws: root })
    registerEntityResolver({
      kinds: ['note'],
      async resolve(refs, _actor) {
        return refs.map(ref => preview(ref, 'here'))
      },
    })
    const before = (await f.resolve({ refs: [note] }, ctxFor('u'), 'ws')) as EntityPreview[]
    expect(before[0]!.status).toBe('ok')
    resetEntityResolvers()
    const after = (await f.resolve({ refs: [note] }, ctxFor('u'), 'ws')) as EntityPreview[]
    expect(after[0]).toMatchObject({ status: 'unavailable', title: '' })
  })
})

describe('reviewer fix #9 — flag-off resolve keeps the response shape', () => {
  it('returns one unavailable preview per input ref', async () => {
    delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    const root = mkdtempSync(join(tmpdir(), 'rox-ws-'))
    roots.push(root)
    const f = fixture({ ws: root })
    const refs: EntityRef[] = [
      { kind: 'note', id: 'n1' },
      { kind: 'task', id: 't1' },
    ]
    const previews = (await f.resolve({ refs }, ctxFor('u'), 'ws')) as EntityPreview[]
    expect(previews).toHaveLength(2)
    expect(previews[0]).toMatchObject({ ref: refs[0], status: 'unavailable', title: '' })
    expect(previews[1]).toMatchObject({ ref: refs[1], status: 'unavailable', title: '' })
  })
})
