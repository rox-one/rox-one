/**
 * W1-04 (#1501) — resolver host ACL: previews are computed with the viewer's
 * rights; denied refs never reach a resolver; minimal → title only.
 */

import { describe, expect, it, spyOn } from 'bun:test'
import { createAcl, MemoryAclFacts } from '@rox/core/acl'
import type { Actor, EntityPreview, EntityRef, Resolver } from '@rox/core/entities'
import { DefaultResolverHost } from '../resolver-host.ts'
import { createEntityAclGate, filterBacklinks, filterOutgoingLinks, noAccessPreview, principalForActor, resolveEntityAclGate, RESTRICTED_REF_ID } from '../acl-gate.ts'

/** Gate over an injected ACL with the (required) principal mapping. */
const gateFor = (acl: ReturnType<typeof createAcl>) => createEntityAclGate(WS, acl, actor => principalForActor(WS, actor))

const WS = 'ws'
const alice: Actor = { id: 'alice', kind: 'user' }
const open: EntityRef = { kind: 'goal', id: 'open' }
const secret: EntityRef = { kind: 'goal', id: 'secret' }
const minimal: EntityRef = { kind: 'goal', id: 'min' }
const plain: EntityRef = { kind: 'goal', id: 'plain' }

function facts(): MemoryAclFacts {
  const f = new MemoryAclFacts().setMember(WS, 'alice', { role: 'member' })
  f.setResource({ ref: open, workspaceId: WS })
  f.setResource({ ref: secret, workspaceId: WS, privacy: 'invited' })
  f.setResource({ ref: minimal, workspaceId: WS })
  f.setResource({ ref: plain, workspaceId: WS })
  f.grant(WS, open, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
  f.grant(WS, minimal, { subjectType: 'principal', subjectId: 'alice', role: 'minimal' })
  return f
}

function recordingResolver(seen: EntityRef[]): Resolver {
  return {
    kinds: ['goal'],
    async resolve(refs: EntityRef[]): Promise<EntityPreview[]> {
      seen.push(...refs)
      return refs.map(ref => ({
        ref,
        status: 'ok',
        title: `Secret title of ${ref.id}`,
        kindLabel: 'entities.kind.goal',
        icon: 'target',
        authority: 'workspace',
        fields: [{ id: 'owner', label: 'Owner', value: 'Bob' }],
        container: [{ ref: { kind: 'space', id: 'sp' }, title: 'Space' }],
        etag: `e-${ref.id}`,
      }))
    },
  }
}

describe('DefaultResolverHost with an ACL gate', () => {
  it('redacts denied refs without calling the resolver and strips minimal previews', async () => {
    const seen: EntityRef[] = []
    const host = new DefaultResolverHost({ acl: gateFor(createAcl(facts())) })
    host.register(recordingResolver(seen))
    const previews = await host.resolve([open, secret, minimal, plain], alice)

    expect(seen).toEqual([open, minimal])
    expect(previews[0]).toMatchObject({ status: 'ok', title: 'Secret title of open' })
    for (const denied of [previews[1]!, previews[3]!]) {
      expect(denied).toMatchObject({ status: 'no_access', title: '', etag: '' })
      expect(denied.fields).toBeUndefined()
      expect(denied.container).toBeUndefined()
    }
    expect(previews[1]).toEqual(noAccessPreview(secret))
    expect(previews[2]).toEqual({
      ref: minimal, status: 'minimal', title: 'Secret title of min', kindLabel: 'entities.kind.goal', icon: 'target', authority: 'workspace', etag: 'e-min',
    })
  })

  it('a revoked grant takes effect on the next resolve even though previews are cached', async () => {
    const f = facts()
    const seen: EntityRef[] = []
    const host = new DefaultResolverHost({ acl: gateFor(createAcl(f)) })
    host.register(recordingResolver(seen))
    expect((await host.resolve([open], alice))[0]!.status).toBe('ok')
    f.revoke(WS, open, 'principal', 'alice')
    expect((await host.resolve([open], alice))[0]).toMatchObject({ status: 'no_access', title: '' })
  })

  it('without a gate behaves exactly as before (no ACL)', async () => {
    const seen: EntityRef[] = []
    const host = new DefaultResolverHost()
    host.register(recordingResolver(seen))
    const previews = await host.resolve([secret], alice)
    expect(previews[0]!.status).toBe('ok')
  })

  it('the default local shim lets the local owner see everything', async () => {
    const seen: EntityRef[] = []
    const host = new DefaultResolverHost({ acl: createEntityAclGate(WS) })
    host.register(recordingResolver(seen))
    const previews = await host.resolve([open, secret], { id: 'local', kind: 'system' })
    expect(previews.map(p => p.status)).toEqual(['ok', 'ok'])
  })
})

describe('link listing filters', () => {
  const link = (from: EntityRef, to: EntityRef) => ({
    linkId: `${from.id}-${to.id}`, from, to, relation: 'relates-to' as const, createdBy: 'x', createdAt: '2026-10-08T00:00:00Z', revision: 1,
  })

  it('outgoing: viewable targets kept, unviewable redacted, secret omitted', async () => {
    const gate = gateFor(createAcl(facts()))
    const out = await filterOutgoingLinks(gate, alice, open, [link(open, minimal), link(open, plain), link(open, secret)])
    expect(out.map(l => l.to)).toEqual([minimal, { kind: 'goal', id: RESTRICTED_REF_ID }])
  })

  it('outgoing of an unviewable source is empty', async () => {
    const gate = gateFor(createAcl(facts()))
    expect(await filterOutgoingLinks(gate, alice, plain, [link(plain, open)])).toEqual([])
    expect(await filterOutgoingLinks(gate, alice, minimal, [link(minimal, open)])).toEqual([])
  })

  it('backlinks: unviewable sources are omitted; unviewable target lists nothing', async () => {
    const gate = gateFor(createAcl(facts()))
    const back = await filterBacklinks(gate, alice, open, [link(plain, open), link(secret, open), link(minimal, open)])
    expect(back.map(l => l.from)).toEqual([minimal])
    expect(await filterBacklinks(gate, alice, secret, [link(open, secret)])).toEqual([])
  })
})

describe('injected ACL requires its principal mapping (review 3)', () => {
  it('an injected ACL without principalFor is rejected (only the local shim may default)', async () => {
    const acl = createAcl(facts())
    expect(() => (createEntityAclGate as (ws: string, acl: unknown, p?: unknown) => unknown)(WS, acl)).toThrow('requires principalFor')
    await expect(resolveEntityAclGate(WS, async () => ({ acl }) as never)).rejects.toThrow('requires principalFor')
  })

  it('a principal mapped into another workspace fails closed', async () => {
    const gate = createEntityAclGate(WS, createAcl(facts()), actor => ({ id: actor.id, workspaceId: 'other-ws' }))
    const principal = await gate.principalFor(alice)
    expect(principal).toMatchObject({ workspaceId: WS, status: 'deactivated' })
    expect(await gate.acl.evaluate(principal, 'view', open)).toMatchObject({ allowed: false, reason: 'inactive' })
    const host = new DefaultResolverHost({ acl: gate })
    const seen: EntityRef[] = []
    host.register(recordingResolver(seen))
    expect((await host.resolve([open], alice)).map(p => p.status)).toEqual(['no_access'])
    expect(seen).toEqual([])
  })

  it('a principal of the gate workspace passes through unchanged', async () => {
    const gate = createEntityAclGate(WS, createAcl(facts()), actor => ({ id: actor.id, workspaceId: WS, kind: 'guest' }))
    expect(await gate.principalFor(alice)).toEqual({ id: 'alice', workspaceId: WS, kind: 'guest' })
  })
})

describe('acl-gate mismatch and denial mapping (review 4)', () => {
  it('a workspace mismatch is denied and warns once with the workspace ids only', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const gate = createEntityAclGate(WS, createAcl(facts()), actor => ({ id: actor.id, workspaceId: 'cloud-uuid', kind: 'human' }))
      for (let i = 0; i < 2; i++) expect(await gate.principalFor(alice)).toMatchObject({ workspaceId: WS, status: 'deactivated' })
      expect(warn).toHaveBeenCalledTimes(1)
      const [message, details] = warn.mock.calls[0]!
      expect(String(message)).toContain('workspace mismatch')
      expect(details).toEqual({ gateWorkspaceId: WS, principalWorkspaceId: 'cloud-uuid' })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('alice')
    } finally {
      warn.mockRestore()
    }
  })

  it('a principalFor FORBIDDEN / non-member throw becomes a denial, not an error', async () => {
    for (const error of [Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' }), Object.assign(new Error('x'), { code: 'not_member' }), Object.assign(new Error('y'), { statusCode: 403 })]) {
      const gate = createEntityAclGate(WS, createAcl(facts()), () => { throw error })
      const principal = await gate.principalFor(alice)
      expect(await gate.acl.evaluate(principal, 'view', open)).toMatchObject({ allowed: false, reason: 'inactive' })
      const host = new DefaultResolverHost({ acl: gate })
      host.register(recordingResolver([]))
      expect((await host.resolve([open], alice)).map(p => p.status)).toEqual(['no_access'])
    }
  })

  it('other principalFor failures still propagate (fail closed as an error)', async () => {
    const gate = createEntityAclGate(WS, createAcl(facts()), async () => { throw new Error('db down') })
    await expect(gate.principalFor(alice)).rejects.toThrow('db down')
  })
})
