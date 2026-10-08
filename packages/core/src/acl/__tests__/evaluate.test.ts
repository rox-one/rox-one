/**
 * W1-04 (#1501) — ACL engine: role sources, inheritance, guests, secret
 * goals, policy-epoch caching and the PLAN §1.4 negative cases.
 */

import { describe, expect, it } from 'bun:test'
import type { EntityRef } from '../../entities/refs.ts'
import { createAcl, listingVisibility, type AclPrincipal } from '../evaluate.ts'
import { MemoryAclFacts } from '../memory-facts.ts'

const WS = 'ws-a'
const OTHER_WS = 'ws-b'

const space: EntityRef = { kind: 'space', id: 'sp1' }
const goal: EntityRef = { kind: 'goal', id: 'g1' }
const project: EntityRef = { kind: 'project', id: 'pr1' }
const task: EntityRef = { kind: 'task', id: 't1' }
const secretGoal: EntityRef = { kind: 'goal', id: 'g-secret' }
const doc: EntityRef = { kind: 'note', id: 'd1' }

const alice: AclPrincipal = { id: 'alice', workspaceId: WS }
const bob: AclPrincipal = { id: 'bob', workspaceId: WS }
const guest: AclPrincipal = { id: 'gina', workspaceId: WS, kind: 'guest' }
const owner: AclPrincipal = { id: 'olga', workspaceId: WS }

/** space → goal → project → task, plus a secret goal in the same space. */
function tree(): MemoryAclFacts {
  const facts = new MemoryAclFacts()
  for (const id of ['alice', 'bob', 'gina']) facts.setMember(WS, id, { role: 'member' })
  facts.setMember(WS, 'olga', { role: 'owner' })
  facts.setResource({ ref: space, workspaceId: WS })
  facts.setResource({ ref: goal, workspaceId: WS, parents: [space], spaceId: 'sp1', championId: 'bob' })
  facts.setResource({ ref: project, workspaceId: WS, parents: [goal], spaceId: 'sp1' })
  facts.setResource({ ref: task, workspaceId: WS, parents: [project], spaceId: 'sp1' })
  facts.setResource({ ref: secretGoal, workspaceId: WS, parents: [space], spaceId: 'sp1', privacy: 'invited', championId: 'bob' })
  facts.setResource({ ref: doc, workspaceId: WS })
  // Alice is a space member with comment access.
  facts.grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'commenter' })
  return facts
}

describe('inheritance space → goal → project → task', () => {
  it('space members get the space-wide default (viewer) down the chain, not their space role', async () => {
    const acl = createAcl(tree())
    expect(await acl.evaluate(alice, 'comment', space)).toMatchObject({ allowed: true, role: 'commenter' })
    for (const ref of [goal, project, task]) {
      expect(await acl.evaluate(alice, 'view', ref), ref.kind).toMatchObject({ allowed: true, role: 'viewer', source: 'inherited' })
      expect(await acl.can(alice, 'comment', ref)).toBe(false)
    }
  })

  it('a contextual tag lower in the chain raises only its subtree', async () => {
    const facts = tree()
    facts.setResource({ ref: project, workspaceId: WS, parents: [goal], spaceId: 'sp1', championId: 'alice' })
    const acl = createAcl(facts)
    expect(await acl.can(alice, 'close', project)).toBe(true)
    expect(await acl.can(alice, 'edit', task)).toBe(true)
    expect(await acl.can(alice, 'edit', goal)).toBe(false)
  })

  it('an explicit higher grant on a child wins over the inherited role', async () => {
    const facts = tree().grant(WS, task, { subjectType: 'principal', subjectId: 'alice', role: 'editor' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(alice, 'edit', task)).toMatchObject({ allowed: true, role: 'editor', source: 'explicit' })
    expect(await acl.can(alice, 'edit', project)).toBe(false)
  })

  it('department and space subjects grant through group membership', async () => {
    const facts = tree()
      .setGroups(WS, 'bob', { departmentIds: ['dep-eng'], channelIds: [] })
      .grant(WS, project, { subjectType: 'department', subjectId: 'dep-eng', role: 'editor' })
      .grant(WS, doc, { subjectType: 'space', subjectId: 'sp1', role: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(bob, 'edit', project)).toBe(true)
    expect(await acl.can(alice, 'view', doc)).toBe(true) // alice is a member of sp1
    expect(await acl.can(bob, 'view', doc)).toBe(false) // bob is not
  })

  it('privacy presets: everyone in the company / in the space', async () => {
    const facts = tree()
      .setPolicy(WS, doc, { defaultSubject: 'workspace', defaultRole: 'commenter' })
    facts.setResource({ ref: { kind: 'note', id: 'd2' }, workspaceId: WS, spaceId: 'sp1' })
    facts.setPolicy(WS, { kind: 'note', id: 'd2' }, { defaultSubject: 'space', defaultRole: 'editor' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(bob, 'comment', doc)).toMatchObject({ allowed: true, source: 'policy' })
    expect(await acl.can(alice, 'edit', { kind: 'note', id: 'd2' })).toBe(true)
    expect(await acl.can(bob, 'view', { kind: 'note', id: 'd2' })).toBe(false)
  })

  it('survives parent cycles', async () => {
    const facts = tree()
    const a: EntityRef = { kind: 'folder', id: 'fa' }
    const b: EntityRef = { kind: 'folder', id: 'fb' }
    facts.setResource({ ref: a, workspaceId: WS, parents: [b] })
    facts.setResource({ ref: b, workspaceId: WS, parents: [a, space] })
    const acl = createAcl(facts)
    expect(await acl.can(alice, 'view', a)).toBe(true)
    expect(await acl.can(bob, 'view', a)).toBe(false)
  })
})

describe('secret goals', () => {
  it('do not inherit space roles and are hidden from listings', async () => {
    const acl = createAcl(tree())
    const decision = await acl.evaluate(alice, 'view', secretGoal)
    expect(decision).toMatchObject({ allowed: false, preview: 'none', secret: true, reason: 'no_access' })
    expect(listingVisibility(decision)).toBe('hide')
  })

  it('a non-secret unviewable ref is a redacted row, not hidden', async () => {
    const acl = createAcl(tree())
    // Bob champions the goal, so he inherits manager on project/task …
    expect(await acl.can(bob, 'close', task)).toBe(true)
    // … but he has no role on the (non-secret) doc.
    const denied = await acl.evaluate(bob, 'view', doc)
    expect(denied).toMatchObject({ allowed: false, secret: false })
    expect(listingVisibility(denied)).toBe('restricted')
  })

  it('invited people (explicit / champion) see them', async () => {
    const facts = tree().grant(WS, secretGoal, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(alice, 'view', secretGoal)).toBe(true)
    expect(await acl.can(bob, 'close', secretGoal)).toBe(true)
  })

  it('ignore company/space presets', async () => {
    const facts = tree().setPolicy(WS, secretGoal, { defaultSubject: 'workspace', defaultRole: 'editor' })
    expect(await createAcl(facts).can(alice, 'view', secretGoal)).toBe(false)
  })

  it('minimal role yields a title-only listing row', async () => {
    const facts = tree().grant(WS, secretGoal, { subjectType: 'principal', subjectId: 'alice', role: 'minimal' })
    const decision = await createAcl(facts).evaluate(alice, 'view', secretGoal)
    expect(decision).toMatchObject({ allowed: false, preview: 'minimal' })
    expect(listingVisibility(decision)).toBe('title-only')
  })
})

describe('guests', () => {
  it('see only refs shared with them explicitly', async () => {
    const facts = tree()
      .grant(WS, doc, { subjectType: 'workspace', subjectId: WS, role: 'viewer' })
      .grant(WS, project, { subjectType: 'principal', subjectId: 'gina', role: 'commenter' })
      .grant(WS, space, { subjectType: 'workspace', subjectId: WS, role: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(guest, 'view', doc)).toBe(false) // workspace subject ignored
    expect(await acl.can(guest, 'view', space)).toBe(false)
    expect(await acl.can(guest, 'view', goal)).toBe(false)
    expect(await acl.can(guest, 'comment', project)).toBe(true)
    expect(await acl.can(guest, 'view', task)).toBe(true) // inherits only her own grant
  })

  it('ignore policy defaults and group subjects', async () => {
    const facts = tree()
      .setGroups(WS, 'gina', { departmentIds: ['dep-x'], channelIds: ['ch-1'] })
      .grant(WS, doc, { subjectType: 'department', subjectId: 'dep-x', role: 'editor' })
      .setPolicy(WS, goal, { defaultSubject: 'workspace', defaultRole: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(guest, 'view', doc)).toBe(false)
    expect(await acl.can(guest, 'view', goal)).toBe(false)
  })

  it('are capped at editor', async () => {
    const facts = tree().grant(WS, doc, { subjectType: 'principal', subjectId: 'gina', role: 'owner' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(guest, 'edit', doc)).toMatchObject({ allowed: true, role: 'editor' })
    expect(await acl.can(guest, 'manage_access', doc)).toBe(false)
    expect(await acl.can(guest, 'delete', doc)).toBe(false)
  })
})

describe('public links', () => {
  const linkPrincipal = (token: string): AclPrincipal => ({ id: 'bob', workspaceId: WS, linkToken: token })

  it('grant the preset role to holders of a valid token (docs only)', async () => {
    const facts = tree().setPolicy(WS, doc, { defaultSubject: 'link', defaultRole: 'viewer', linkToken: 'tok-1' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(linkPrincipal('tok-1'), 'view', doc)).toMatchObject({ allowed: true, source: 'link' })
    expect(await acl.can(linkPrincipal('tok-2'), 'view', doc)).toBe(false)
    expect(await acl.can(bob, 'view', doc)).toBe(false)
  })

  it('negative: an expired link grants nothing', async () => {
    const facts = tree()
      .setPolicy(WS, doc, { defaultSubject: 'link', defaultRole: 'editor', linkToken: 'tok-1', linkExpiresAt: '2026-01-01T00:00:00Z' })
      .grant(WS, doc, { subjectType: 'link', subjectId: 'tok-1', role: 'editor' })
    const acl = createAcl(facts, { now: () => Date.parse('2026-10-08T00:00:00Z') })
    expect(await acl.evaluate(linkPrincipal('tok-1'), 'view', doc)).toMatchObject({ allowed: false, reason: 'no_access' })
  })

  it('negative: links never apply to goals/projects', async () => {
    const facts = tree().grant(WS, goal, { subjectType: 'link', subjectId: 'tok-g', role: 'viewer' })
    expect(await createAcl(facts).can({ id: 'gina', workspaceId: WS, kind: 'guest', linkToken: 'tok-g' }, 'view', goal)).toBe(false)
  })
})

describe('negatives (PLAN §1.4)', () => {
  it('revoked membership denies even with explicit grants', async () => {
    const facts = tree().grant(WS, doc, { subjectType: 'principal', subjectId: 'alice', role: 'owner' })
    const acl = createAcl(facts)
    expect(await acl.can(alice, 'view', doc)).toBe(true)
    facts.setMember(WS, 'alice', null)
    expect(await acl.evaluate(alice, 'view', doc)).toMatchObject({ allowed: false, reason: 'not_member' })
  })

  it('left / removed membership status denies', async () => {
    const facts = tree().setMember(WS, 'alice', { role: 'member', status: 'removed' })
    expect(await createAcl(facts).evaluate(alice, 'view', space)).toMatchObject({ allowed: false, reason: 'not_member' })
  })

  it('a guest outside the share is denied', async () => {
    const facts = tree().grant(WS, project, { subjectType: 'principal', subjectId: 'gina', role: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(guest, 'view', secretGoal)).toBe(false)
    expect(await acl.can(guest, 'view', doc)).toBe(false)
    expect(await acl.can(guest, 'view', goal)).toBe(false)
  })

  it('a principal from another workspace is denied', async () => {
    const facts = tree()
    facts.setMember(OTHER_WS, 'mallory', { role: 'owner' })
    // The resource exists only in WS; mallory asks for it from OTHER_WS.
    const acl = createAcl(facts)
    expect(await acl.evaluate({ id: 'mallory', workspaceId: OTHER_WS }, 'view', doc)).toMatchObject({ allowed: false, reason: 'not_found' })
    // A fact source that returns a foreign-workspace node is rejected too.
    // reported exactly like a missing ref (no cross-workspace existence oracle).
    facts.setResource({ ref: { kind: 'note', id: 'foreign' }, workspaceId: WS }, OTHER_WS)
    const foreign = await acl.evaluate({ id: 'mallory', workspaceId: OTHER_WS }, 'view', { kind: 'note', id: 'foreign' })
    const missing = await acl.evaluate({ id: 'mallory', workspaceId: OTHER_WS }, 'view', { kind: 'note', id: 'never' })
    expect(foreign).toEqual(missing)
    expect(foreign).toMatchObject({ allowed: false, reason: 'not_found' })
  })

  it('placeholder and deactivated principals cannot act', async () => {
    const acl = createAcl(tree())
    expect(await acl.evaluate({ ...alice, status: 'placeholder' }, 'view', space)).toMatchObject({ allowed: false, reason: 'placeholder' })
    expect(await acl.evaluate({ ...alice, status: 'deactivated' }, 'view', space)).toMatchObject({ allowed: false, reason: 'inactive' })
  })

  it('unknown or deleted resources are denied', async () => {
    const facts = tree()
    facts.setResource({ ref: { kind: 'note', id: 'gone' }, workspaceId: WS, deleted: true })
    const acl = createAcl(facts)
    expect(await acl.evaluate(owner, 'view', { kind: 'note', id: 'nope' })).toMatchObject({ allowed: false, reason: 'not_found' })
    expect(await acl.evaluate(owner, 'view', { kind: 'note', id: 'gone' })).toMatchObject({ allowed: false, reason: 'not_found' })
  })

  it('deleting a goal with children is blocked even for managers', async () => {
    const facts = tree()
    facts.setResource({ ref: goal, workspaceId: WS, parents: [space], championId: 'bob', hasChildren: true })
    expect(await createAcl(facts).evaluate(owner, 'delete', goal)).toMatchObject({ allowed: false, reason: 'has_children' })
  })
})

describe('workspace owner', () => {
  it('is manager everywhere, including secret goals, but cannot transfer', async () => {
    const acl = createAcl(tree())
    expect(await acl.evaluate(owner, 'manage_access', secretGoal)).toMatchObject({ allowed: true, source: 'workspace-admin' })
    expect(await acl.can(owner, 'transfer', task)).toBe(false)
  })
})

describe('policy_epoch cache', () => {
  it('serves repeated checks from cache and invalidates on epoch bump', async () => {
    const facts = tree()
    const acl = createAcl(facts)
    expect(await acl.can(bob, 'view', doc)).toBe(false)
    const reads = facts.resourceReads
    expect(await acl.can(bob, 'view', doc)).toBe(false)
    expect(facts.resourceReads).toBe(reads)
    facts.grant(WS, doc, { subjectType: 'principal', subjectId: 'bob', role: 'viewer' })
    expect(await acl.can(bob, 'view', doc)).toBe(true)
  })

  it('is bounded', async () => {
    const facts = tree()
    const acl = createAcl(facts, { cacheCapacity: 3 })
    for (let i = 0; i < 10; i++) await acl.can(alice, 'view', { kind: 'note', id: `n${i}` })
    expect(acl.cacheSize).toBe(3)
  })

  it('fragments share the entity decision', async () => {
    const acl = createAcl(tree())
    expect(await acl.can(alice, 'view', { ...task, fragment: 'b-1' })).toBe(true)
  })
})

describe('space → child inheritance (DATA-MODEL §8.2.3, owner decision)', () => {
  const kpi: EntityRef = { kind: 'kpi', id: 'k1' }
  const spaceDoc: EntityRef = { kind: 'note', id: 'sd1' }

  function spaceTree(): MemoryAclFacts {
    const facts = tree()
    facts.setResource({ ref: kpi, workspaceId: WS, parents: [space], spaceId: 'sp1' })
    facts.setResource({ ref: spaceDoc, workspaceId: WS, parents: [space], spaceId: 'sp1' })
    return facts
  }

  it('no policy: space-visible kinds inherit viewer even for space managers; other kinds inherit nothing', async () => {
    const facts = spaceTree().grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'manager' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(alice, 'manage_access', space)).toMatchObject({ allowed: true, role: 'manager' })
    expect(await acl.evaluate(alice, 'view', kpi)).toMatchObject({ allowed: true, role: 'viewer', source: 'inherited' })
    expect(await acl.can(alice, 'edit', kpi)).toBe(false)
    expect(await acl.can(alice, 'edit', goal)).toBe(false)
    expect(await acl.can(alice, 'view', spaceDoc)).toBe(false) // notes are not space-visible by default
    expect(await acl.can(bob, 'view', kpi)).toBe(false) // not a space member
  })

  it('"Everyone in the space can edit" preset: members inherit editor; a preset without a role caps at viewer', async () => {
    const facts = spaceTree()
      .setPolicy(WS, kpi, { defaultSubject: 'space', defaultRole: 'editor' })
      .setPolicy(WS, spaceDoc, { defaultSubject: 'space', defaultRole: null })
    const acl = createAcl(facts)
    expect(await acl.evaluate(alice, 'edit', kpi)).toMatchObject({ allowed: true, role: 'editor' })
    expect(await acl.evaluate(alice, 'view', spaceDoc)).toMatchObject({ allowed: true, role: 'viewer' })
    expect(await acl.can(alice, 'comment', spaceDoc)).toBe(false)
    expect(await acl.can(bob, 'view', kpi)).toBe(false)
  })

  it('"Everyone in the space can view" yields viewer even for space editors, except explicit per-resource grants', async () => {
    const facts = spaceTree()
      .grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'editor' })
      .grant(WS, space, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
      .setPolicy(WS, kpi, { defaultSubject: 'space', defaultRole: 'viewer' })
      .grant(WS, kpi, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(alice, 'view', kpi)).toMatchObject({ allowed: true, role: 'viewer' })
    expect(await acl.can(alice, 'edit', kpi)).toBe(false)
    expect(await acl.evaluate(bob, 'edit', kpi)).toMatchObject({ allowed: true, role: 'editor', source: 'explicit' })
  })

  it('company access of a space (default_access company_edit) reaches only company-wide children, capped at their preset', async () => {
    const carl: AclPrincipal = { id: 'carl', workspaceId: WS }
    const companyChild: EntityRef = { kind: 'goal', id: 'g-company' }
    const facts = spaceTree()
      .setMember(WS, 'carl', { role: 'member' })
      .grant(WS, space, { subjectType: 'workspace', subjectId: WS, role: 'editor' }) // company_edit
    facts.setResource({ ref: companyChild, workspaceId: WS, parents: [space], spaceId: 'sp1' })
    facts.setPolicy(WS, companyChild, { defaultSubject: 'workspace', defaultRole: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.can(carl, 'edit', space)).toBe(true)
    expect(await acl.can(carl, 'view', goal)).toBe(false) // space-wide child: carl is not a space member
    expect(await acl.can(carl, 'view', kpi)).toBe(false)
    expect(await acl.evaluate(carl, 'view', companyChild)).toMatchObject({ allowed: true, role: 'viewer', source: 'policy' })
    expect(await acl.can(carl, 'edit', companyChild)).toBe(false)
  })

  it('secret / invited children never inherit, whatever their preset', async () => {
    const facts = spaceTree()
      .setPolicy(WS, secretGoal, { defaultSubject: 'space', defaultRole: 'editor' })
      .grant(WS, secretGoal, { subjectType: 'space', subjectId: 'sp1', role: 'editor' })
      .grant(WS, secretGoal, { subjectType: 'workspace', subjectId: WS, role: 'viewer' })
    const acl = createAcl(facts)
    const decision = await acl.evaluate(alice, 'view', secretGoal)
    expect(decision).toMatchObject({ allowed: false, secret: true })
    expect(listingVisibility(decision)).toBe('hide')
  })

  it('folder → items still inherit the folder role; the folder itself is capped by the space rule', async () => {
    const folder: EntityRef = { kind: 'folder', id: 'f1' }
    const item: EntityRef = { kind: 'note', id: 'fi1' }
    const facts = spaceTree().grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'manager' })
    facts.setResource({ ref: folder, workspaceId: WS, parents: [space], spaceId: 'sp1' })
    facts.setResource({ ref: item, workspaceId: WS, parents: [folder], spaceId: 'sp1' })
    facts.grant(WS, folder, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(alice, 'view', item)).toMatchObject({ allowed: true, role: 'viewer' })
    expect(await acl.evaluate(bob, 'edit', item)).toMatchObject({ allowed: true, role: 'editor', source: 'inherited' })
  })
})

describe('space membership (owner decision)', () => {
  it('space chat membership makes a space member', async () => {
    const facts = tree()
    facts.setResource({ ref: space, workspaceId: WS, chatId: 'ch-space' })
    facts.setGroups(WS, 'bob', { departmentIds: [], channelIds: ['ch-space'] })
    const acl = createAcl(facts)
    expect(await acl.evaluate(bob, 'view', goal)).toMatchObject({ allowed: true })
    expect(await acl.can({ id: 'olga', workspaceId: WS, kind: 'guest' }, 'view', goal)).toBe(false)
  })

  for (const role of ['minimal', 'free_busy', 'follower'] as const) {
    it(`a ${role} grant on the space does not make a space member`, async () => {
      const facts = tree()
        .setGroups(WS, 'bob', { departmentIds: ['dep-1'], channelIds: [] })
        .grant(WS, space, { subjectType: 'principal', subjectId: 'bob', role })
        .grant(WS, space, { subjectType: 'department', subjectId: 'dep-1', role })
        .grant(WS, doc, { subjectType: 'space', subjectId: 'sp1', role: 'editor' })
        .setPolicy(WS, project, { defaultSubject: 'space', defaultRole: 'editor' })
      facts.setResource({ ref: project, workspaceId: WS, parents: [goal], spaceId: 'sp1' })
      const acl = createAcl(facts)
      expect(await acl.can(bob, 'view', doc)).toBe(false)
      expect(await acl.can(bob, 'edit', project)).toBe(true) // champion of the parent goal → manager, unrelated to space
      expect((await acl.evaluate(bob, 'view', { kind: 'kpi', id: 'none' })).reason).toBe('not_found')
      expect(await acl.can(alice, 'view', doc)).toBe(true) // alice's commenter grant does count
    })
  }

  it('viewer / department / channel grants (≥ viewer) do make space members', async () => {
    const facts = tree()
      .setGroups(WS, 'bob', { departmentIds: ['dep-1'], channelIds: [] })
      .grant(WS, space, { subjectType: 'department', subjectId: 'dep-1', role: 'viewer' })
      .grant(WS, doc, { subjectType: 'space', subjectId: 'sp1', role: 'commenter' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(bob, 'comment', doc)).toMatchObject({ allowed: true, role: 'commenter' })
  })
})

describe('role cache TTL and batching', () => {
  class CountingFacts extends MemoryAclFacts {
    epochReads = 0
    override policyEpoch(workspaceId: string): string {
      this.epochReads += 1
      return super.policyEpoch(workspaceId)
    }
  }

  it('a cached role expires after 45 s even without an epoch bump', async () => {
    const facts = tree()
    let clock = 1_000_000
    const acl = createAcl(facts, { now: () => clock })
    expect(await acl.can(alice, 'view', goal)).toBe(true)
    const reads = facts.resourceReads
    clock += 44_000
    expect(await acl.can(alice, 'view', goal)).toBe(true)
    expect(facts.resourceReads).toBe(reads)
    clock += 2_000
    expect(await acl.can(alice, 'view', goal)).toBe(true)
    expect(facts.resourceReads).toBeGreaterThan(reads)
  })

  it('evaluateMany reads the epoch once and each fact once per batch, keeping order', async () => {
    const counting = new CountingFacts()
    for (const id of ['alice', 'bob']) counting.setMember(WS, id, { role: 'member' })
    counting.setResource({ ref: space, workspaceId: WS })
    counting.setResource({ ref: goal, workspaceId: WS, parents: [space], spaceId: 'sp1' })
    counting.setResource({ ref: project, workspaceId: WS, parents: [goal], spaceId: 'sp1' })
    counting.grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
    const refs: EntityRef[] = Array.from({ length: 20 }, (_, i) => (i % 2 ? project : { kind: 'task', id: `missing-${i}` }))
    const acl = createAcl(counting, { concurrency: 4 })
    const decisions = await acl.evaluateMany(alice, 'view', refs)
    expect(counting.epochReads).toBe(1)
    expect(decisions.map(d => d.allowed)).toEqual(refs.map(r => r.kind === 'project'))
    // project, goal, space each read once; the 10 distinct missing tasks once each.
    expect(counting.resourceReads).toBe(13)
  })
})
