/**
 * W1-04 (#1501) — `entities:*` handlers call `acl.can` on every resolve, link
 * listing and link write. The default local shim keeps local behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { createAcl, MemoryAclFacts, type Acl, type AclPrincipal } from '@rox/core/acl'
import type { EntityPreview, EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import { registerEntitiesHandlers, registerEntityResolver, resetEntityResolvers } from '../entities.ts'
import type { EntityAclFactory } from '../../../entities/acl-gate.ts'

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

const note: EntityRef = { kind: 'note', id: 'n1' }
const goal: EntityRef = { kind: 'goal', id: 'g1' }
const secretGoal: EntityRef = { kind: 'goal', id: 'g-secret' }
const task: EntityRef = { kind: 'task', id: 't1' }

function fixture(acl?: EntityAclFactory) {
  const root = mkdtempSync(join(tmpdir(), 'rox-entity-acl-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {},
  } as unknown as RpcServer
  registerEntitiesHandlers(server, {} as HandlerDeps, { workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null), ...(acl ? { acl } : {}) })
  const local: RequestContext = { clientId: 'local', workspaceId: 'ws', webContentsId: null }
  const links = (payload: unknown, ctx = local) => Promise.resolve(handlers.get(RPC_CHANNELS.entities.LINKS)!(ctx, 'ws', payload))
  const resolve = (payload: unknown, ctx = local) => Promise.resolve(handlers.get(RPC_CHANNELS.entities.RESOLVE)!(ctx, 'ws', payload))
  return { links, resolve, local }
}

/** Workspace ACL where the local actor ('local') can edit the note, view the goal, and nothing else. */
function workspaceAcl(calls: string[]): Acl {
  const facts = new MemoryAclFacts().setMember('ws', 'local', { role: 'member' })
  facts.setResource({ ref: note, workspaceId: 'ws' })
  facts.setResource({ ref: goal, workspaceId: 'ws' })
  facts.setResource({ ref: secretGoal, workspaceId: 'ws', privacy: 'invited' })
  facts.setResource({ ref: task, workspaceId: 'ws' })
  facts.grant('ws', note, { subjectType: 'principal', subjectId: 'local', role: 'editor' })
  facts.grant('ws', goal, { subjectType: 'principal', subjectId: 'local', role: 'viewer' })
  // The task is workspace-visible: members see it, guests (group subjects void) do not.
  facts.grant('ws', task, { subjectType: 'workspace', subjectId: 'ws', role: 'viewer' })
  const engine = createAcl(facts)
  const wrap = <T extends unknown[], R>(name: string, fn: (...args: T) => R) => (...args: T): R => {
    calls.push(name)
    return fn(...args)
  }
  return {
    can: wrap('can', engine.can),
    evaluate: wrap('evaluate', engine.evaluate),
    evaluateMany: wrap('evaluateMany', engine.evaluateMany),
    roleOf: engine.roleOf,
    isActiveMember: engine.isActiveMember,
  }
}

describe('entities handlers with the default local shim', () => {
  it('local owner keeps full access (unchanged behaviour)', async () => {
    const f = fixture()
    await f.links({ op: 'add', from: note, to: secretGoal, relation: 'mentions' })
    const out = await f.links({ op: 'outgoing', ref: note }) as { links: Array<{ to: EntityRef }> }
    expect(out.links.map(l => l.to)).toEqual([secretGoal])
    const back = await f.links({ op: 'backlinks', ref: secretGoal }) as { links: Array<{ from: EntityRef }> }
    expect(back.links.map(l => l.from)).toEqual([note])
  })
})

describe('entities handlers with a workspace ACL', () => {
  it('outgoing redacts unviewable targets and omits secret goals', async () => {
    const calls: string[] = []
    const f = fixture(async () => ({ acl: workspaceAcl(calls) }))
    for (const to of [goal, secretGoal, task]) await f.links({ op: 'add', from: note, to, relation: 'mentions' })
    calls.length = 0
    const out = await f.links({ op: 'outgoing', ref: note }) as { links: Array<{ to: EntityRef }> }
    expect(out.links.map(l => l.to)).toEqual([goal, task])
    expect(calls).toContain('evaluateMany')
  })

  it('backlinks omit unviewable sources; unviewable targets list nothing', async () => {
    const calls: string[] = []
    const f = fixture(async () => ({ acl: workspaceAcl(calls) }))
    await f.links({ op: 'add', from: note, to: goal, relation: 'mentions' })
    const back = await f.links({ op: 'backlinks', ref: goal }) as { links: Array<{ from: EntityRef }> }
    expect(back.links.map(l => l.from)).toEqual([note])
    const none = await f.links({ op: 'backlinks', ref: secretGoal }) as { links: unknown[] }
    expect(none.links).toEqual([])
  })

  it('link writes require edit on the source', async () => {
    const calls: string[] = []
    const f = fixture(async () => ({ acl: workspaceAcl(calls) }))
    await expect(f.links({ op: 'add', from: goal, to: note, relation: 'mentions' })).rejects.toThrow('Entity link access denied')
    await expect(f.links({ op: 'remove', from: task, to: note, relation: 'mentions' })).rejects.toThrow('Entity link access denied') // viewer only
    expect(await f.links({ op: 'add', from: note, to: goal, relation: 'mentions' })).toMatchObject({ ok: true, op: 'add' })
    expect(calls.filter(c => c === 'can').length).toBe(3)
  })

  it('resolve computes previews with the viewer rights', async () => {
    const calls: string[] = []
    const seen: EntityRef[] = []
    registerEntityResolver({
      kinds: ['goal', 'note', 'task'],
      async resolve(refs): Promise<EntityPreview[]> {
        seen.push(...refs)
        return refs.map(ref => ({ ref, status: 'ok', title: `T ${ref.id}`, kindLabel: 'k', icon: 'i', authority: 'workspace', etag: 'e' }))
      },
    })
    const f = fixture(async () => ({ acl: workspaceAcl(calls) }))
    const previews = await f.resolve({ refs: [goal, secretGoal, task] }) as EntityPreview[]
    expect(previews.map(p => [p.status, p.title])).toEqual([['ok', 'T g1'], ['no_access', ''], ['ok', 'T t1']])
    expect(seen).toEqual([goal, task])
    expect(calls).toContain('evaluateMany')
  })

  it('installs the ACL gate once per workspace host, not per request', async () => {
    registerEntityResolver({
      kinds: ['goal'],
      async resolve(refs): Promise<EntityPreview[]> {
        return refs.map(ref => ({ ref, status: 'ok', title: `T ${ref.id}`, kindLabel: 'k', icon: 'i', authority: 'workspace', etag: 'e' }))
      },
    })
    const calls: string[] = []
    let factoryCalls = 0
    const f = fixture(async () => { factoryCalls += 1; return { acl: workspaceAcl(calls) } })
    for (let i = 0; i < 3; i++) {
      const previews = await f.resolve({ refs: [goal, secretGoal] }) as EntityPreview[]
      expect(previews.map(p => p.status)).toEqual(['ok', 'no_access'])
    }
    expect(factoryCalls).toBe(1)
  })

  it('uses the injected principalFor (guest kind, status) like WorkspaceAcl', async () => {
    registerEntityResolver({
      kinds: ['goal', 'note', 'task'],
      async resolve(refs): Promise<EntityPreview[]> {
        return refs.map(ref => ({ ref, status: 'ok', title: `T ${ref.id}`, kindLabel: 'k', icon: 'i', authority: 'workspace', etag: 'e' }))
      },
    })
    const calls: string[] = []
    const asGuest = fixture(async workspaceId => ({
      acl: workspaceAcl(calls),
      principalFor: async (actor): Promise<AclPrincipal> => ({ id: actor.id, workspaceId, kind: 'guest' }),
    }))
    // Members see the workspace-visible task; the guest mapping voids the workspace subject.
    expect((await asGuest.resolve({ refs: [goal, task] }) as EntityPreview[]).map(p => p.status)).toEqual(['ok', 'no_access'])
    await asGuest.links({ op: 'add', from: note, to: task, relation: 'mentions' })
    expect((await asGuest.links({ op: 'outgoing', ref: note }) as { links: Array<{ to: EntityRef }> }).links.map(l => l.to)).toEqual([{ kind: 'task', id: 'restricted' }])
  })

  it('a placeholder principal from the injected mapping is denied everything', async () => {
    resetEntityResolvers()
    const calls: string[] = []
    const f = fixture(async workspaceId => ({
      acl: workspaceAcl(calls),
      principalFor: (actor): AclPrincipal => ({ id: actor.id, workspaceId, status: 'placeholder' }),
    }))
    await expect(f.links({ op: 'add', from: note, to: goal, relation: 'mentions' })).rejects.toThrow('Entity link access denied')
    expect((await f.resolve({ refs: [goal] }) as EntityPreview[]).map(p => p.status)).toEqual(['no_access'])
  })

  it('a failed async gate is not cached: the next request retries the factory', async () => {
    const calls: string[] = []
    let attempts = 0
    const f = fixture(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('acl backend down')
      return { acl: workspaceAcl(calls) }
    })
    await expect(f.resolve({ refs: [goal] })).rejects.toThrow('acl backend down')
    await Promise.resolve()
    expect((await f.resolve({ refs: [goal] }) as EntityPreview[]).length).toBe(1)
    expect(attempts).toBe(2)
  })
})
