/**
 * W1-04 (#1501) — ACL engine: role sources, inheritance, guests, secret
 * goals, policy-epoch caching and the PLAN §1.4 negative cases.
 */

import { describe, expect, it } from 'bun:test'
import type { EntityRef } from '../../entities/refs.ts'
import { createAcl, listingVisibility, type AclPrincipal, type AclResourceNode } from '../evaluate.ts'
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

/** space → goal, space → project (goal edge ignored) → task, plus a secret goal in the same space. */
function tree(): MemoryAclFacts {
  const facts = new MemoryAclFacts()
  for (const id of ['alice', 'bob', 'gina']) facts.setMember(WS, id, { role: 'member' })
  facts.setMember(WS, 'olga', { role: 'owner' })
  facts.setResource({ ref: space, workspaceId: WS })
  facts.setResource({ ref: goal, workspaceId: WS, parents: [space], spaceId: 'sp1', championId: 'bob' })
  // project → goal is a non-inheriting edge (own privacy); project → space is space-wide.
  facts.setResource({ ref: project, workspaceId: WS, parents: [goal, space], spaceId: 'sp1' })
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
    facts.setResource({ ref: project, workspaceId: WS, parents: [goal, space], spaceId: 'sp1', championId: 'alice' })
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
    // Bob champions the goal but is not a space member (tags void), and goal → project carries nothing …
    expect(await acl.can(bob, 'view', task)).toBe(false)
    // … and he has no role on the (non-secret) doc.
    const denied = await acl.evaluate(bob, 'view', doc)
    expect(denied).toMatchObject({ allowed: false, secret: false })
    expect(listingVisibility(denied)).toBe('restricted')
  })

  it('invited people (explicit / champion) see them', async () => {
    const facts = tree().grant(WS, secretGoal, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
    facts.grant(WS, space, { subjectType: 'principal', subjectId: 'bob', role: 'viewer' }) // the champion is a space member
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

describe('workspace owner (owner decision: non-secret resources only)', () => {
  it('is manager on non-secret resources but cannot transfer', async () => {
    const acl = createAcl(tree())
    expect(await acl.evaluate(owner, 'manage_access', task)).toMatchObject({ allowed: true, source: 'workspace-admin' })
    expect(await acl.can(owner, 'transfer', task)).toBe(false)
  })

  it("cannot see another person's personal (secret) goal, nor what hangs below it", async () => {
    const personal: EntityRef = { kind: 'goal', id: 'g-personal' }
    const target: EntityRef = { kind: 'goal-target', id: 'gt-personal' }
    const facts = tree()
    facts.setResource({ ref: personal, workspaceId: WS, privacy: 'invited', ownerId: 'alice' })
    facts.setResource({ ref: target, workspaceId: WS, parents: [personal] })
    const acl = createAcl(facts)
    for (const ref of [personal, target, secretGoal]) {
      const decision = await acl.evaluate(owner, 'view', ref)
      expect(decision, ref.id).toMatchObject({ allowed: false, secret: true, preview: 'none' })
      expect(listingVisibility(decision)).toBe('hide')
    }
    expect(await acl.can(alice, 'transfer', personal)).toBe(true)
    expect(await acl.can(alice, 'edit', target)).toBe(true)
  })

  it('keeps a secret resource the owner holds a grant on, at that grant', async () => {
    const facts = tree().grant(WS, secretGoal, { subjectType: 'principal', subjectId: 'olga', role: 'viewer' })
    const acl = createAcl(facts)
    expect(await acl.evaluate(owner, 'view', secretGoal)).toMatchObject({ allowed: true, role: 'viewer', source: 'explicit' })
    expect(await acl.can(owner, 'manage_access', secretGoal)).toBe(false)
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
      const acl = createAcl(facts)
      expect(await acl.can(bob, 'view', doc)).toBe(false)
      expect(await acl.can(bob, 'edit', project)).toBe(false) // not a space member; the parent goal's champion gets nothing
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
    counting.setResource({ ref: project, workspaceId: WS, parents: [goal, space], spaceId: 'sp1' })
    counting.grant(WS, space, { subjectType: 'principal', subjectId: 'alice', role: 'viewer' })
    const refs: EntityRef[] = Array.from({ length: 20 }, (_, i) => (i % 2 ? project : { kind: 'task', id: `missing-${i}` }))
    const acl = createAcl(counting, { concurrency: 4 })
    const decisions = await acl.evaluateMany(alice, 'view', refs)
    expect(counting.epochReads).toBe(1)
    expect(decisions.map(d => d.allowed)).toEqual(refs.map(r => r.kind === 'project'))
    // project and space read once each (goal → project carries neither role nor secrecy,
    // so the goal is never read); the 10 distinct missing tasks once each.
    expect(counting.resourceReads).toBe(12)
  })
})

describe('goal edges (owner decision: goal → child goal / project carry no inheritance)', () => {
  const companyGoal: EntityRef = { kind: 'goal', id: 'g-co' }
  const childGoal: EntityRef = { kind: 'goal', id: 'g-child' }
  const childProject: EntityRef = { kind: 'project', id: 'p-child' }
  const childTask: EntityRef = { kind: 'task', id: 't-child' }
  const target: EntityRef = { kind: 'goal-target', id: 'gt-1' }
  const check: EntityRef = { kind: 'goal-check', id: 'gc-1' }
  const checkIn: EntityRef = { kind: 'check-in', id: 'ci-1' }
  const otherSpace: EntityRef = { kind: 'space', id: 'sp2' }
  const carl: AclPrincipal = { id: 'carl', workspaceId: WS }

  function goals(): MemoryAclFacts {
    const facts = tree().setMember(WS, 'carl', { role: 'member' })
    facts.setResource({ ref: otherSpace, workspaceId: WS })
    // Company goal (company scope → workspace viewer), championed by carl.
    facts.setResource({ ref: companyGoal, workspaceId: WS, championId: 'carl' })
    facts.grant(WS, companyGoal, { subjectType: 'workspace', subjectId: WS, role: 'viewer' })
    // Child goal and project live in members-only space sp2 (no policy).
    facts.setResource({ ref: childGoal, workspaceId: WS, parents: [companyGoal, otherSpace], spaceId: 'sp2' })
    facts.setResource({ ref: childProject, workspaceId: WS, parents: [childGoal, otherSpace], spaceId: 'sp2' })
    facts.setResource({ ref: childTask, workspaceId: WS, parents: [childProject], spaceId: 'sp2' })
    for (const ref of [target, check, checkIn]) facts.setResource({ ref, workspaceId: WS, parents: [companyGoal] })
    return facts
  }

  it('company goal → space child goal is not visible to non-members of that space', async () => {
    const acl = createAcl(goals())
    expect(await acl.can(alice, 'view', companyGoal)).toBe(true)
    for (const ref of [childGoal, childProject, childTask]) expect(await acl.can(alice, 'view', ref), ref.id).toBe(false)
    // Members of sp1 (alice) do not see sp2 goals hanging under a goal either.
  })

  it("the parent goal's champion is not manager of descendant goals / projects", async () => {
    const acl = createAcl(goals())
    expect(await acl.can(carl, 'manage_access', companyGoal)).toBe(true)
    for (const ref of [childGoal, childProject, childTask]) expect(await acl.can(carl, 'view', ref), ref.id).toBe(false)
  })

  it('targets, checks and check-ins still inherit from their goal', async () => {
    const acl = createAcl(goals())
    for (const ref of [target, check, checkIn]) {
      expect(await acl.evaluate(carl, 'edit', ref), ref.kind).toMatchObject({ allowed: true, role: 'manager', source: 'inherited' })
      expect(await acl.evaluate(alice, 'view', ref), ref.kind).toMatchObject({ allowed: true, role: 'viewer' })
    }
  })
})

describe('secret propagation', () => {
  it('a secret ancestor hides the child from listings when there is no view role', async () => {
    const privateProject: EntityRef = { kind: 'project', id: 'p-private' }
    const privateTask: EntityRef = { kind: 'task', id: 't-private' }
    const facts = tree()
    facts.setResource({ ref: privateProject, workspaceId: WS, privacy: 'invited', parents: [space], spaceId: 'sp1' })
    facts.setResource({ ref: privateTask, workspaceId: WS, parents: [privateProject], spaceId: 'sp1' })
    facts.grant(WS, privateProject, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
    const acl = createAcl(facts)
    const hidden = await acl.evaluate(alice, 'view', privateTask)
    expect(hidden).toMatchObject({ allowed: false, secret: true, preview: 'none' })
    expect(listingVisibility(hidden)).toBe('hide')
    expect(await acl.evaluate(bob, 'edit', privateTask)).toMatchObject({ allowed: true, role: 'editor', source: 'inherited' })
  })
})

describe('chat → child edges (owner decision)', () => {
  const chat: EntityRef = { kind: 'channel', id: 'ch-1' }
  const privateChat: EntityRef = { kind: 'channel', id: 'ch-private' }
  const chatFolder: EntityRef = { kind: 'folder', id: 'f-chat' }
  const chatList: EntityRef = { kind: 'task-list', id: 'l-chat' }
  const chatDoc: EntityRef = { kind: 'note', id: 'd-chat' }
  const privateFolder: EntityRef = { kind: 'folder', id: 'f-private' }

  function chats(): MemoryAclFacts {
    const facts = tree()
    // Public chat: non-joined workspace members get minimal; bob is a member (commenter), alice an admin (editor).
    facts.setResource({ ref: chat, workspaceId: WS })
    facts.grant(WS, chat, { subjectType: 'workspace', subjectId: WS, role: 'minimal' })
    facts.grant(WS, chat, { subjectType: 'principal', subjectId: 'bob', role: 'commenter' })
    facts.grant(WS, chat, { subjectType: 'principal', subjectId: 'alice', role: 'manager' })
    facts.setResource({ ref: chatFolder, workspaceId: WS, parents: [chat] })
    facts.setResource({ ref: chatList, workspaceId: WS, parents: [chat] })
    facts.setPolicy(WS, chatList, { defaultSubject: null, defaultRole: 'editor' })
    facts.setResource({ ref: chatDoc, workspaceId: WS, parents: [chatFolder] })
    facts.setResource({ ref: privateChat, workspaceId: WS, privacy: 'invited' })
    facts.grant(WS, privateChat, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
    facts.setResource({ ref: privateFolder, workspaceId: WS, parents: [privateChat] })
    return facts.setMember(WS, 'carl', { role: 'member' })
  }

  it('non-joined members see a public chat only as minimal, and nothing of its children', async () => {
    const acl = createAcl(chats())
    const carl: AclPrincipal = { id: 'carl', workspaceId: WS }
    const onChat = await acl.evaluate(carl, 'view', chat)
    expect(onChat).toMatchObject({ allowed: false, role: 'minimal', preview: 'minimal' })
    expect(listingVisibility(onChat)).toBe('title-only')
    for (const ref of [chatFolder, chatList, chatDoc]) expect(await acl.evaluate(carl, 'view_title', ref), ref.id).toMatchObject({ allowed: false, role: null })
  })

  it('children inherit min(chat role, child preset role), viewer by default', async () => {
    const acl = createAcl(chats())
    expect(await acl.evaluate(alice, 'view', chatFolder)).toMatchObject({ allowed: true, role: 'viewer' }) // min(manager, viewer)
    expect(await acl.evaluate(alice, 'edit', chatList)).toMatchObject({ allowed: true, role: 'editor' }) // min(manager, editor)
    expect(await acl.evaluate(bob, 'view', chatList)).toMatchObject({ role: 'commenter' }) // min(commenter, editor)
    expect(await acl.evaluate(bob, 'view', chatDoc)).toMatchObject({ allowed: true, role: 'viewer' }) // folder → item
  })

  it('a private chat hides its children from non-members; members inherit capped', async () => {
    const acl = createAcl(chats())
    const hidden = await acl.evaluate(alice, 'view', privateFolder)
    expect(hidden).toMatchObject({ allowed: false, secret: true })
    expect(listingVisibility(hidden)).toBe('hide')
    expect(await acl.evaluate(bob, 'view', privateFolder)).toMatchObject({ allowed: true, role: 'viewer' })
  })

  it('a removed chat member (no chat grant left) loses the chat and its children', async () => {
    const facts = chats().revoke(WS, privateChat, 'principal', 'bob')
    const acl = createAcl(facts)
    expect(await acl.can(bob, 'view', privateChat)).toBe(false)
    expect(await acl.can(bob, 'view', privateFolder)).toBe(false)
  })
})

describe('batch failure and row-derived facts', () => {
  it('the first failing ref stops the other batch workers (shared failed flag)', async () => {
    const memory = new MemoryAclFacts().setMember(WS, 'alice', { role: 'member' })
    const facts = {
      reads: 0,
      policyEpoch: (ws: string) => memory.policyEpoch(ws),
      membership: (ws: string, p: string) => memory.membership(ws, p),
      entries: (ws: string, ref: EntityRef) => memory.entries(ws, ref),
      policy: (ws: string, ref: EntityRef) => memory.policy(ws, ref),
      groups: (ws: string, p: string) => memory.groups(ws, p),
      resource(ws: string, ref: EntityRef): Promise<AclResourceNode | null> {
        facts.reads += 1
        if (ref.id === 'boom') return Promise.reject(new Error('db down'))
        return new Promise(resolve => setTimeout(() => resolve(memory.resource(ws, ref)), 5))
      },
    }
    const acl = createAcl(facts, { concurrency: 2 })
    const refs: EntityRef[] = [{ kind: 'task', id: 'boom' }, ...Array.from({ length: 20 }, (_, i) => ({ kind: 'task' as const, id: `t${i}` }))]
    await expect(acl.evaluateMany(alice, 'view', refs)).rejects.toThrow('db down')
    await new Promise(resolve => setTimeout(resolve, 30))
    // boom + the one ref already in flight on the second worker; nothing after the failure.
    expect(facts.reads).toBeLessThanOrEqual(2)
  })

  it('honours row-derived implicit entries and default policy carried on the node', async () => {
    const legacy: EntityRef = { kind: 'project', id: 'p-legacy' }
    const publicDoc: EntityRef = { kind: 'note', id: 'd-public' }
    const facts = tree()
    facts.setResource({ ref: legacy, workspaceId: WS, implicitEntries: [{ subjectType: 'workspace', subjectId: WS, role: 'viewer' }] })
    facts.setResource({ ref: publicDoc, workspaceId: WS, defaultPolicy: { defaultSubject: 'link', defaultRole: 'viewer', linkToken: 'tok' } })
    const acl = createAcl(facts)
    expect(await acl.evaluate(bob, 'view', legacy)).toMatchObject({ allowed: true, role: 'viewer', source: 'explicit' })
    expect(await acl.evaluate({ ...bob, linkToken: 'tok' }, 'view', publicDoc)).toMatchObject({ allowed: true, source: 'link' })
    // A stored resource_policy row wins over the row-derived default.
    facts.setPolicy(WS, publicDoc, { defaultSubject: null, defaultRole: null })
    expect(await createAcl(facts).can({ ...bob, linkToken: 'tok' }, 'view', publicDoc)).toBe(false)
  })
})

describe('secrecy is decoupled from role flow (review 3)', () => {
  const personal: EntityRef = { kind: 'goal', id: 'g-personal-3' }
  const goalFolder: EntityRef = { kind: 'folder', id: 'f-goal' }
  const goalDoc: EntityRef = { kind: 'note', id: 'd-goal' }
  const privateProject: EntityRef = { kind: 'project', id: 'p-private-3' }
  const membersList: EntityRef = { kind: 'task-list', id: 'l-members' }
  const listTask: EntityRef = { kind: 'task', id: 't-list' }
  const secretSpace: EntityRef = { kind: 'space', id: 'sp-secret' }
  const spaceChat: EntityRef = { kind: 'channel', id: 'ch-secret-space' }
  const chatFolder: EntityRef = { kind: 'folder', id: 'f-chat-3' }
  const childGoal: EntityRef = { kind: 'goal', id: 'g-under-personal' }

  function facts(): MemoryAclFacts {
    const f = tree()
    // (1) A folder owned by a personal goal (cut edge → secrecy-only ancestor) and a doc in it.
    f.setResource({ ref: personal, workspaceId: WS, privacy: 'invited', ownerId: 'alice' })
    f.setResource({ ref: goalFolder, workspaceId: WS, ancestors: [personal] })
    f.setResource({ ref: goalDoc, workspaceId: WS, parents: [goalFolder] })
    f.grant(WS, goalFolder, { subjectType: 'principal', subjectId: 'bob', role: 'editor' })
    // (2) A members-mode task list of a private project, and a task reachable only through it.
    f.setResource({ ref: privateProject, workspaceId: WS, privacy: 'invited' })
    f.setResource({ ref: membersList, workspaceId: WS, ancestors: [privateProject] })
    f.setResource({ ref: listTask, workspaceId: WS, parents: [membersList] })
    f.grant(WS, membersList, { subjectType: 'principal', subjectId: 'bob', role: 'commenter' })
    // (3) A chat in a secret space, and a chat-owned folder.
    f.setResource({ ref: secretSpace, workspaceId: WS, privacy: 'invited' })
    f.setResource({ ref: spaceChat, workspaceId: WS, parents: [secretSpace] })
    // Bob holds an explicit grant (a self-joined `via: 'chat'` membership would not count here).
    f.grant(WS, spaceChat, { subjectType: 'principal', subjectId: 'bob', role: 'commenter' })
    f.grant(WS, spaceChat, { subjectType: 'principal', subjectId: 'carl', role: 'commenter', via: 'chat' })
    f.setResource({ ref: chatFolder, workspaceId: WS, parents: [spaceChat] })
    // (4) A company goal under a personal goal (goal → child goal carries no secrecy: own privacy).
    f.setResource({ ref: childGoal, workspaceId: WS, ancestors: [personal] })
    f.grant(WS, childGoal, { subjectType: 'workspace', subjectId: WS, role: 'viewer' })
    return f
  }

  for (const [label, refs] of [
    ['a goal-owned folder (and its doc) under a personal goal', [goalFolder, goalDoc]],
    ["a members-mode list of a private project (and the list's task)", [membersList, listTask]],
    ['a chat in a secret space (and its folder)', [spaceChat, chatFolder]],
  ] as const) {
    it(`${label}: hidden from non-members, no owner bypass`, async () => {
      const acl = createAcl(facts())
      for (const ref of refs) {
        for (const who of [alice, owner]) {
          const decision = await acl.evaluate(who, 'view', ref)
          expect(decision, `${who.id} ${ref.id}`).toMatchObject({ allowed: false, secret: true, preview: 'none' })
          expect(listingVisibility(decision)).toBe('hide')
        }
        expect(await acl.can(bob, 'view', ref), ref.id).toBe(true)
      }
    })
  }

  it('a company goal below a personal goal is governed by its own privacy (company-viewable, owner bypass)', async () => {
    const acl = createAcl(facts())
    expect(await acl.evaluate(alice, 'view', childGoal)).toMatchObject({ allowed: true, role: 'viewer', secret: false })
    expect(await acl.evaluate(owner, 'manage_access', childGoal)).toMatchObject({ allowed: true, role: 'manager', source: 'workspace-admin' })
    // A project under the personal goal likewise carries its own privacy.
    const f = facts()
    const project3: EntityRef = { kind: 'project', id: 'p-under-personal' }
    f.setResource({ ref: project3, workspaceId: WS, parents: [personal] })
    expect(await createAcl(f).evaluate(owner, 'edit', project3)).toMatchObject({ allowed: true, secret: false })
  })

  it('a goal-owned folder under a secret (invited) goal is still secret', async () => {
    const f = facts()
    const invitedGoal: EntityRef = { kind: 'goal', id: 'g-invited-3' }
    const folder: EntityRef = { kind: 'folder', id: 'f-invited-goal' }
    f.setResource({ ref: invitedGoal, workspaceId: WS, privacy: 'invited' })
    f.setResource({ ref: folder, workspaceId: WS, ancestors: [invitedGoal] })
    const decision = await createAcl(f).evaluate(owner, 'view', folder)
    expect(decision).toMatchObject({ allowed: false, secret: true })
    expect(listingVisibility(decision)).toBe('hide')
  })

  it("a self-joined member of a secret space's public chat gets nothing from it", async () => {
    const carl: AclPrincipal = { id: 'carl', workspaceId: WS }
    const f = facts().setMember(WS, 'carl', { role: 'member' })
    const acl = createAcl(f)
    for (const ref of [spaceChat, chatFolder]) expect(await acl.evaluate(carl, 'view_title', ref), ref.id).toMatchObject({ allowed: false, role: null })
  })
})

describe('incomplete ancestry fails closed (review 3)', () => {
  it('a folder chain deeper than maxDepth counts as secret', async () => {
    const f = tree()
    const chain: EntityRef[] = Array.from({ length: 6 }, (_, i) => ({ kind: 'folder', id: `deep-${i}` }))
    chain.forEach((ref, i) => f.setResource({ ref, workspaceId: WS, parents: i ? [chain[i - 1]!] : [] }))
    const leaf = chain[chain.length - 1]!
    const acl = createAcl(f, { maxDepth: 3 })
    const forOwner = await acl.evaluate(owner, 'view', leaf)
    expect(forOwner).toMatchObject({ allowed: false, secret: true, ancestryIncomplete: true, preview: 'none' })
    expect(listingVisibility(await acl.evaluate(alice, 'view', leaf))).toBe('hide')
    // Within the limit the owner bypass applies.
    expect(await createAcl(f, { maxDepth: 16 }).evaluate(owner, 'view', leaf)).toMatchObject({ allowed: true, secret: false, source: 'workspace-admin' })
  })

  it('an unloadable (deleted / missing) parent counts as secret', async () => {
    const f = tree()
    const orphan: EntityRef = { kind: 'task', id: 't-orphan' }
    f.setResource({ ref: orphan, workspaceId: WS, parents: [{ kind: 'project', id: 'p-deleted' }] })
    f.setResource({ ref: { kind: 'project', id: 'p-deleted' }, workspaceId: WS, deleted: true })
    const acl = createAcl(f)
    expect(await acl.evaluate(owner, 'view', orphan)).toMatchObject({ allowed: false, secret: true, ancestryIncomplete: true })
    expect(listingVisibility(await acl.evaluate(alice, 'view', orphan))).toBe('hide')
  })
})

describe('space goal tags need space membership (owner decision, review 3)', () => {
  it('a champion who is a space member manages the goal; once removed, keeps nothing beyond the edges', async () => {
    const f = tree().grant(WS, space, { subjectType: 'principal', subjectId: 'bob', role: 'viewer' })
    expect(await createAcl(f).evaluate(bob, 'manage_access', goal)).toMatchObject({ allowed: true, role: 'manager', source: 'contextual' })
    f.revoke(WS, space, 'principal', 'bob')
    const decision = await createAcl(f).evaluate(bob, 'view', goal)
    expect(decision).toMatchObject({ allowed: false, role: null })
  })

  it("a personal goal's creator (no space) stays owner", async () => {
    const personal: EntityRef = { kind: 'goal', id: 'g-mine' }
    const f = tree()
    f.setResource({ ref: personal, workspaceId: WS, privacy: 'invited', ownerId: 'alice' })
    expect(await createAcl(f).evaluate(alice, 'transfer', personal)).toMatchObject({ allowed: true, role: 'owner' })
  })
})

describe('space membership through a public space chat (owner decision, review 3)', () => {
  const chatSpace: EntityRef = { kind: 'space', id: 'sp-chat' }
  const spaceGoal: EntityRef = { kind: 'goal', id: 'g-chat-space' }

  function withSpace(node: Partial<import('../evaluate.ts').AclResourceNode>): MemoryAclFacts {
    const f = tree()
    f.setResource({ ref: chatSpace, workspaceId: WS, chatId: 'ch-space', ...node })
    f.setResource({ ref: spaceGoal, workspaceId: WS, parents: [chatSpace], spaceId: 'sp-chat' })
    f.setGroups(WS, 'bob', { departmentIds: [], channelIds: ['ch-space'] })
    f.grant(WS, chatSpace, { subjectType: 'principal', subjectId: 'bob', role: 'editor', via: 'chat' })
    return f
  }

  it('joining the public chat of a members-only space does not grant the space', async () => {
    expect(await createAcl(withSpace({ chatPublic: true, companyWide: false })).can(bob, 'view', spaceGoal)).toBe(false)
  })

  it('joining the public chat of a secret space does not grant it either', async () => {
    expect(await createAcl(withSpace({ chatPublic: true, companyWide: true, privacy: 'invited' })).can(bob, 'view', spaceGoal)).toBe(false)
  })

  it('a public chat of a company-wide space, or a private (invite-only) space chat, still counts', async () => {
    expect(await createAcl(withSpace({ chatPublic: true, companyWide: true })).can(bob, 'view', spaceGoal)).toBe(true)
    expect(await createAcl(withSpace({ chatPublic: false })).can(bob, 'view', spaceGoal)).toBe(true)
  })

  it("a secret space's chat stays invisible and its title is not listed", async () => {
    const secretSpace: EntityRef = { kind: 'space', id: 'sp-hidden' }
    const chat: EntityRef = { kind: 'channel', id: 'ch-hidden' }
    const f = tree()
    f.setResource({ ref: secretSpace, workspaceId: WS, privacy: 'invited', chatId: 'ch-hidden', chatPublic: true })
    // Even if a stale workspace minimal were present on the chat, the secret space hides it.
    f.setResource({ ref: chat, workspaceId: WS, parents: [secretSpace], implicitEntries: [{ subjectType: 'workspace', subjectId: WS, role: 'minimal' }] })
    const acl = createAcl(f)
    expect(await acl.evaluate(alice, 'view_title', chat)).toMatchObject({ allowed: false, role: null, secret: true, preview: 'none' })
    expect(listingVisibility(await acl.evaluate(alice, 'view', chat))).toBe('hide')
    expect(listingVisibility(await acl.evaluate(owner, 'view', chat))).toBe('hide')
  })

  it('a public chat in a members-only space gets no workspace minimal; one with no space does', async () => {
    const membersSpace: EntityRef = { kind: 'space', id: 'sp-members' }
    const inSpace: EntityRef = { kind: 'channel', id: 'ch-in-space' }
    const loose: EntityRef = { kind: 'channel', id: 'ch-loose' }
    const minimal = [{ subjectType: 'workspace' as const, subjectId: WS, role: 'minimal' as const }]
    const f = tree()
    f.setResource({ ref: membersSpace, workspaceId: WS, companyWide: false })
    f.setResource({ ref: inSpace, workspaceId: WS, parents: [membersSpace], implicitEntries: minimal })
    f.setResource({ ref: loose, workspaceId: WS, implicitEntries: minimal })
    const acl = createAcl(f)
    expect(await acl.evaluate(alice, 'view_title', inSpace)).toMatchObject({ allowed: false, role: null })
    expect(await acl.evaluate(alice, 'view_title', loose)).toMatchObject({ allowed: true, role: 'minimal' })
  })
})

describe('space node role via chat membership (review 4)', () => {
  const chatSpace: EntityRef = { kind: 'space', id: 'sp-r4' }
  const carl: AclPrincipal = { id: 'carl', workspaceId: WS }

  function spaceWith(node: Partial<import('../evaluate.ts').AclResourceNode>, role: 'editor' | 'manager' = 'editor'): MemoryAclFacts {
    const f = tree().setMember(WS, 'carl', { role: 'member' })
    f.setResource({ ref: chatSpace, workspaceId: WS, chatId: 'ch-r4', ...node })
    f.setGroups(WS, 'carl', { departmentIds: [], channelIds: ['ch-r4'] })
    f.grant(WS, chatSpace, { subjectType: 'principal', subjectId: 'carl', role, via: 'chat' })
    return f
  }

  it('a self-joiner of the public chat of a members-only space gets no role on the space', async () => {
    const decision = await createAcl(spaceWith({ chatPublic: true, companyWide: false })).evaluate(carl, 'view', chatSpace)
    expect(decision.role === null || decision.role === 'minimal').toBe(true)
    expect(decision.allowed).toBe(false)
  })

  it('the same joiner of a secret space gets no role on the space', async () => {
    const decision = await createAcl(spaceWith({ chatPublic: true, companyWide: true, privacy: 'invited' })).evaluate(carl, 'view', chatSpace)
    expect(decision.role === null || decision.role === 'minimal').toBe(true)
    expect(decision).toMatchObject({ allowed: false, secret: true })
  })

  it('members of a private space chat or a company-space chat keep editor / manager', async () => {
    expect(await createAcl(spaceWith({ chatPublic: false })).evaluate(carl, 'edit', chatSpace)).toMatchObject({ allowed: true, role: 'editor' })
    expect(await createAcl(spaceWith({ chatPublic: true, companyWide: true }, 'manager')).evaluate(carl, 'manage_access', chatSpace)).toMatchObject({ allowed: true, role: 'manager' })
    expect(await createAcl(spaceWith({ chatPublic: false, privacy: 'invited' }, 'manager')).evaluate(carl, 'manage_access', chatSpace)).toMatchObject({ allowed: true, role: 'manager' })
  })

  it('an explicit (non-chat) grant on a members-only space still counts', async () => {
    const f = spaceWith({ chatPublic: true, companyWide: false })
    f.grant(WS, chatSpace, { subjectType: 'principal', subjectId: 'carl', role: 'commenter' })
    expect(await createAcl(f).evaluate(carl, 'comment', chatSpace)).toMatchObject({ allowed: true, role: 'commenter' })
  })
})
