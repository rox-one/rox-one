/**
 * W1-04 (#1501) — DATA-MODEL §8.3 matrix tests.
 *
 * 1. The generated matrix is checked against an independent, hand-written
 *    transcription of §8.3 (not against the rule table it was generated from).
 * 2. Every generated row is replayed through the real ACL engine with facts
 *    that produce the row's role / tags, so `acl.can` and the matrix agree.
 */

import { describe, expect, it } from 'bun:test'
import { ACL_ACTIONS, type AclAction } from '../../acl/actions.ts'
import { ACL_ROLES, roleAtLeast, type AclRole } from '../../acl/roles.ts'
import { createAcl } from '../../acl/evaluate.ts'
import { MemoryAclFacts } from '../../acl/memory-facts.ts'
import {
  PERMISSION_RULES,
  generatePermissionMatrix,
  type ContextualTag,
  type PermissionMatrixRow,
} from '../permissions.ts'

/** §8.3 transcribed by hand: minimum lattice role per action. */
const SPEC_MIN_ROLE: Record<AclAction, AclRole> = {
  view_title: 'minimal',
  view: 'viewer',
  comment: 'commenter',
  react: 'commenter',
  edit: 'editor',
  check_in: 'manager',
  acknowledge: 'manager',
  close: 'manager',
  delete: 'manager',
  manage_access: 'manager',
  create_child: 'editor',
  transfer: 'owner',
}

/** §8.2.2 transcribed by hand. */
const SPEC_TAG_ROLE: Record<ContextualTag, AclRole> = {
  owner: 'owner',
  champion: 'manager',
  reviewer: 'editor',
  contributor: 'editor',
  assignee: 'editor',
}

function specAllowed(row: PermissionMatrixRow): boolean {
  let role: AclRole | null = row.role
  for (const tag of row.tags) {
    const implied = SPEC_TAG_ROLE[tag]
    if (!role || roleAtLeast(implied, role)) role = implied
  }
  let allowed = roleAtLeast(role, SPEC_MIN_ROLE[row.action])
  // "Check in: champion (or ≥ manager); reviewer may check in if the champion is absent"
  if (row.action === 'check_in' && row.tags.includes('champion')) allowed = true
  if (row.action === 'check_in' && row.tags.includes('reviewer') && row.championAbsent) allowed = true
  // "Acknowledge: reviewer (or manager)"
  if (row.action === 'acknowledge' && row.tags.includes('reviewer')) allowed = true
  // "Close / reopen / pause / resume / move space: champion or manager"
  if (row.action === 'close' && row.tags.includes('champion')) allowed = true
  // "Delete goal: blocked while children exist"
  if (row.action === 'delete' && row.kind === 'goal' && row.hasChildren) allowed = false
  return allowed
}

const matrix = generatePermissionMatrix()

describe('generatePermissionMatrix (DATA-MODEL §8.3)', () => {
  it('has one rule per frozen action, in action order', () => {
    expect(PERMISSION_RULES.map(rule => rule.action)).toEqual([...ACL_ACTIONS])
  })

  it('enumerates kind × action × role × tag scenario × has-children deterministically', () => {
    expect(matrix.length).toBe(4 * ACL_ACTIONS.length * (ACL_ROLES.length + 1) * 7 * 2)
    expect(generatePermissionMatrix()).toEqual(matrix)
  })

  it('matches the hand-written §8.3 transcription on every row', () => {
    const mismatches = matrix.filter(row => row.allowed !== specAllowed(row))
    expect(mismatches).toEqual([])
  })

  it('no access (no row) grants nothing without a tag', () => {
    const rows = matrix.filter(row => row.role === null && row.tags.length === 0)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => !row.allowed && row.reason === 'insufficient_role')).toBe(true)
  })

  it('minimal sees titles only', () => {
    const minimal = matrix.filter(row => row.role === 'minimal' && row.tags.length === 0 && row.kind === 'note' && !row.hasChildren)
    expect(minimal.filter(row => row.allowed).map(row => row.action)).toEqual(['view_title'])
  })

  it('manager may not transfer; owner may', () => {
    const pick = (role: AclRole) => matrix.find(row => row.action === 'transfer' && row.role === role && row.tags.length === 0)!
    expect(pick('manager').allowed).toBe(false)
    expect(pick('owner').allowed).toBe(true)
  })

  it('goal deletion is blocked while children exist, project deletion is not', () => {
    const goal = matrix.find(row => row.action === 'delete' && row.role === 'owner' && row.kind === 'goal' && row.hasChildren && !row.tags.length)!
    const project = matrix.find(row => row.action === 'delete' && row.role === 'owner' && row.kind === 'project' && row.hasChildren && !row.tags.length)!
    expect(goal).toMatchObject({ allowed: false, reason: 'has_children' })
    expect(project.allowed).toBe(true)
  })

  it('a reviewer checks in only while the champion is absent', () => {
    const present = matrix.find(row => row.action === 'check_in' && row.role === null && row.tags.join() === 'reviewer' && !row.championAbsent)!
    const absent = matrix.find(row => row.action === 'check_in' && row.role === null && row.tags.join() === 'reviewer' && row.championAbsent)!
    expect(present.allowed).toBe(false)
    expect(absent.allowed).toBe(true)
  })
})

describe('acl.can agrees with the generated matrix', () => {
  const ws = 'ws-1'
  const me = 'p-me'

  it('replays every row through the engine', async () => {
    const mismatches: string[] = []
    let n = 0
    for (const row of matrix) {
      const facts = new MemoryAclFacts().setMember(ws, me, { role: 'member' })
      const ref = { kind: row.kind, id: `r${n++}` }
      facts.setResource({
        ref,
        workspaceId: ws,
        ownerId: row.tags.includes('owner') ? me : 'someone-else',
        championId: row.tags.includes('champion') ? me : row.championAbsent ? null : 'someone-else',
        reviewerId: row.tags.includes('reviewer') ? me : null,
        contributorIds: row.tags.includes('contributor') ? [me] : [],
        assigneeIds: row.tags.includes('assignee') ? [me] : [],
        hasChildren: row.hasChildren,
      })
      if (row.role) facts.grant(ws, ref, { subjectType: 'principal', subjectId: me, role: row.role })
      const acl = createAcl(facts)
      const allowed = await acl.can({ id: me, workspaceId: ws }, row.action, ref)
      if (allowed !== row.allowed) mismatches.push(`${row.kind}/${row.action}/${row.role}/${row.tags.join('+')}/${row.championAbsent}/${row.hasChildren}`)
    }
    expect(mismatches).toEqual([])
  })
})
