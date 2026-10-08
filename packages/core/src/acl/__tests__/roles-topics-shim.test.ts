/**
 * W1-04 (#1501) — role lattice, action vocabulary, local shim and the
 * realtime topic authorizer.
 */

import { describe, expect, it } from 'bun:test'
import { ACL_ACTIONS, aclActionForRox2Verb, isAclAction } from '../actions.ts'
import {
  ACL_ROLES,
  effectiveRole,
  maxRole,
  minRole,
  normalizeRoleAlias,
  operatelyLevelForRole,
  roleAtLeast,
  roleFromOperatelyLevel,
} from '../roles.ts'
import { createAcl } from '../evaluate.ts'
import { createLocalAcl, LOCAL_OWNER_PRINCIPAL_ID } from '../local-shim.ts'
import { MemoryAclFacts } from '../memory-facts.ts'
import { createAclTopicAuthorizer, parseTopicRef } from '../topics.ts'
import * as barrel from '../index.ts'

describe('role lattice (DATA-MODEL §8.1)', () => {
  it('is ordered by Operately level', () => {
    expect(ACL_ROLES.map(role => operatelyLevelForRole(role))).toEqual([1, 10, 40, 70, 90, 100])
    expect(roleAtLeast('editor', 'commenter')).toBe(true)
    expect(roleAtLeast('commenter', 'editor')).toBe(false)
    expect(roleAtLeast(null, 'minimal')).toBe(false)
    expect(maxRole('viewer', 'manager')).toBe('manager')
    expect(maxRole(null, 'viewer')).toBe('viewer')
    expect(minRole('owner', 'editor')).toBe('editor')
    expect(minRole(null, 'editor')).toBeNull()
  })

  it('converts Operately levels', () => {
    expect(roleFromOperatelyLevel(0)).toBeNull()
    expect(roleFromOperatelyLevel(1)).toBe('minimal')
    expect(roleFromOperatelyLevel(10)).toBe('viewer')
    expect(roleFromOperatelyLevel(40)).toBe('commenter')
    expect(roleFromOperatelyLevel(70)).toBe('editor')
    expect(roleFromOperatelyLevel(90)).toBe('manager')
    expect(roleFromOperatelyLevel(100)).toBe('owner')
    expect(roleFromOperatelyLevel(55)).toBe('commenter')
  })

  it('folds Lark special roles and aliases', () => {
    expect(effectiveRole('follower')).toBe('viewer')
    expect(effectiveRole('guest')).toBe('viewer')
    expect(effectiveRole('free_busy')).toBe('minimal')
    expect(normalizeRoleAlias('full_access')).toBe('manager')
    expect(normalizeRoleAlias('edit_access')).toBe('editor')
    expect(normalizeRoleAlias('Viewer')).toBe('viewer')
    expect(normalizeRoleAlias('no_access')).toBeNull()
  })
})

describe('action vocabulary (contract freeze)', () => {
  it('is one exported const array', () => {
    expect([...ACL_ACTIONS]).toEqual([
      'view_title', 'view', 'comment', 'react', 'edit', 'check_in', 'acknowledge',
      'close', 'delete', 'manage_access', 'create_child', 'transfer',
    ])
    expect(isAclAction('view')).toBe(true)
    expect(isAclAction('destroy')).toBe(false)
  })

  it('maps Rox2 verbs', () => {
    expect(aclActionForRox2Verb('read')).toBe('view')
    expect(aclActionForRox2Verb('write')).toBe('edit')
    expect(aclActionForRox2Verb('share')).toBe('manage_access')
    expect(aclActionForRox2Verb('destroy')).toBe('delete')
    expect(aclActionForRox2Verb('spend')).toBeNull()
  })

  it('the barrel exposes acl + matrix generator', () => {
    expect(typeof barrel.createAcl).toBe('function')
    expect(typeof barrel.generatePermissionMatrix).toBe('function')
    expect(typeof barrel.createLocalAcl).toBe('function')
  })
})

describe('local single-user shim', () => {
  it('is owner of everything for the local actor', async () => {
    const acl = createLocalAcl()
    const local = { id: LOCAL_OWNER_PRINCIPAL_ID, workspaceId: 'ws' }
    for (const action of ACL_ACTIONS) {
      expect(await acl.can(local, action, { kind: 'session', id: 's1' })).toBe(true)
    }
    expect(await acl.evaluate(local, 'transfer', { kind: 'goal', id: 'g' })).toMatchObject({ role: 'owner', source: 'local-owner', preview: 'full' })
  })

  it('can be restricted to known owners', async () => {
    const acl = createLocalAcl({ ownerPrincipalIds: ['local'] })
    expect(await acl.can({ id: 'local', workspaceId: 'ws' }, 'edit', { kind: 'note', id: 'n' })).toBe(true)
    expect(await acl.evaluate({ id: 'stranger', workspaceId: 'ws' }, 'view', { kind: 'note', id: 'n' }))
      .toMatchObject({ allowed: false, reason: 'not_member' })
  })

  it('denies placeholders', async () => {
    expect(await createLocalAcl().can({ id: 'p', workspaceId: 'ws', status: 'placeholder' }, 'view', { kind: 'note', id: 'n' })).toBe(false)
  })
})

describe('topic authorizer (TECH-SPEC §3.5)', () => {
  it('parses topics into refs', () => {
    expect(parseTopicRef('entity:task:t1')).toEqual({ type: 'entity', ref: { kind: 'task', id: 't1' } })
    expect(parseTopicRef('entity:doc:d1')).toEqual({ type: 'entity', ref: { kind: 'note', id: 'd1' } })
    expect(parseTopicRef('space:sp1')).toEqual({ type: 'entity', ref: { kind: 'space', id: 'sp1' } })
    expect(parseTopicRef('channel:c1')).toEqual({ type: 'entity', ref: { kind: 'channel', id: 'c1' } })
    expect(parseTopicRef('doc:d1')).toEqual({ type: 'entity', ref: { kind: 'note', id: 'd1' } })
    expect(parseTopicRef('meeting:m1')).toEqual({ type: 'entity', ref: { kind: 'call', id: 'm1' } })
    expect(parseTopicRef('task-list:l1')).toEqual({ type: 'entity', ref: { kind: 'task-list', id: 'l1' } })
    expect(parseTopicRef('user:u1')).toEqual({ type: 'user', principalId: 'u1' })
    for (const bad of ['', 'nope', 'bogus:1', 'entity:bogus:1', 'entity:task', 'space:', 'space:a b', 'user:a:b']) {
      expect(parseTopicRef(bad)).toBeNull()
    }
  })

  it('every subscribe calls acl.can(view)', async () => {
    const facts = new MemoryAclFacts()
      .setMember('ws', 'alice', { role: 'member' })
      .setResource({ ref: { kind: 'channel', id: 'c1' }, workspaceId: 'ws' })
      .setResource({ ref: { kind: 'goal', id: 'g-secret' }, workspaceId: 'ws', privacy: 'invited' })
      .grant('ws', { kind: 'channel', id: 'c1' }, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
    const acl = createAcl(facts)
    const calls: string[] = []
    const spy = { ...acl, can: async (...args: Parameters<typeof acl.can>) => { calls.push(`${args[1]}:${args[2].kind}:${args[2].id}`); return acl.can(...args) } }
    const authorize = createAclTopicAuthorizer(spy)
    const alice = { id: 'alice', workspaceId: 'ws' }
    expect(await authorize(alice, 'channel:c1')).toBe(true)
    expect(await authorize(alice, 'entity:goal:g-secret')).toBe(false)
    expect(await authorize(alice, 'user:alice')).toBe(true)
    expect(await authorize(alice, 'user:bob')).toBe(false)
    expect(await authorize(alice, 'garbage')).toBe(false)
    expect(calls).toEqual(['view:channel:c1', 'view:goal:g-secret'])
  })

  it('user:{id} requires an active principal with an active workspace membership', async () => {
    const facts = new MemoryAclFacts()
      .setMember('ws', 'alice', { role: 'member', status: 'active' })
      .setMember('ws', 'lena', { role: 'member', status: 'left' })
      .setMember('ws', 'rita', { role: 'member', status: 'removed' })
      .setMember('ws', 'ivan', { role: 'member', status: 'invited' })
    const authorize = createAclTopicAuthorizer(createAcl(facts))
    expect(await authorize({ id: 'alice', workspaceId: 'ws' }, 'user:alice')).toBe(true)
    expect(await authorize({ id: 'alice', workspaceId: 'ws', status: 'deactivated' }, 'user:alice')).toBe(false)
    expect(await authorize({ id: 'alice', workspaceId: 'ws', status: 'placeholder' }, 'user:alice')).toBe(false)
    for (const id of ['lena', 'rita', 'ivan']) expect(await authorize({ id, workspaceId: 'ws' }, `user:${id}`)).toBe(false)
    expect(await authorize({ id: 'nobody', workspaceId: 'ws' }, 'user:nobody')).toBe(false)
    expect(await authorize({ id: 'alice', workspaceId: 'other' }, 'user:alice')).toBe(false)
    // Membership is re-read on every subscribe (never cached).
    facts.setMember('ws', 'alice', { role: 'member', status: 'left' })
    expect(await authorize({ id: 'alice', workspaceId: 'ws' }, 'user:alice')).toBe(false)
  })

  it('local shim: user topics for admitted active principals only', async () => {
    const authorize = createAclTopicAuthorizer(createLocalAcl({ ownerPrincipalIds: ['local'] }))
    expect(await authorize({ id: 'local', workspaceId: 'ws' }, 'user:local')).toBe(true)
    expect(await authorize({ id: 'other', workspaceId: 'ws' }, 'user:other')).toBe(false)
    expect(await authorize({ id: 'local', workspaceId: 'ws', status: 'deactivated' }, 'user:local')).toBe(false)
  })
})
