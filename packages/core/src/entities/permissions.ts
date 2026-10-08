/**
 * W1-04 (#1501) — Permission rules and the matrix generator (DATA-MODEL §8.3).
 *
 * `PERMISSION_RULES` is the single source for "which role / contextual tag
 * may perform which action". The ACL engine (`../acl/evaluate.ts`) applies
 * these rules; `generatePermissionMatrix()` enumerates every
 * action × role × contextual-tag scenario into a stable, flat table that the
 * W1-10 (#1507) contract harness and the matrix tests consume.
 *
 * Contextual tags (DATA-MODEL §8.2.2) also *raise the role* before a rule is
 * applied (champion → manager, reviewer / contributor / assignee → editor,
 * resource owner → owner). The rules below additionally name the tags that
 * grant an action directly (e.g. "check in: champion, or ≥ manager").
 *
 * Note on §8.1 vs §8.3: the §8.1 table lists `react` among the viewer verbs,
 * while the §8.3 action matrix says "Comment / react ≥ commenter". The action
 * matrix is the normative rule table, so `react` requires `commenter` here.
 */

import { ACL_ACTIONS, type AclAction } from '../acl/actions.ts'
import { ACL_ROLES, roleAtLeast, type AclRole } from '../acl/roles.ts'
import type { EntityKind } from './kinds.ts'

/** Contextual role tags (DATA-MODEL §8.2.2). */
export const CONTEXTUAL_TAGS = ['owner', 'champion', 'reviewer', 'contributor', 'assignee'] as const

export type ContextualTag = (typeof CONTEXTUAL_TAGS)[number]

/** Role a contextual tag implies on its resource (DATA-MODEL §8.2.2). */
export const CONTEXTUAL_TAG_ROLE: Readonly<Record<ContextualTag, AclRole>> = {
  owner: 'owner',
  champion: 'manager',
  reviewer: 'editor',
  contributor: 'editor',
  assignee: 'editor',
}

export type PermissionBlocker = 'has_children'

export interface PermissionRule {
  action: AclAction
  /** Minimum lattice role that grants the action; `null` = no role path (tags only). */
  minRole: AclRole | null
  /** Contextual tags that grant the action regardless of role. */
  grantTags?: readonly ContextualTag[]
  /** Tags that grant only while the resource has no champion (Operately rule). */
  grantTagsWhenChampionAbsent?: readonly ContextualTag[]
  /** Conditions that block the action even when a role/tag grants it. */
  blockers?: ReadonlyArray<{ when: PermissionBlocker; kinds: readonly EntityKind[] }>
  /** Human-readable rule from DATA-MODEL §8.3 (docs + reports only). */
  rule: string
}

/** DATA-MODEL §8.3, one rule per action (order = `ACL_ACTIONS`). Frozen contract. */
export const PERMISSION_RULES: readonly PermissionRule[] = [
  { action: 'view_title', minRole: 'minimal', rule: 'Title / status in trees and Work Map: ≥ minimal' },
  { action: 'view', minRole: 'viewer', rule: 'Read entity / preview: ≥ viewer (minimal gets a title-only preview)' },
  { action: 'comment', minRole: 'commenter', rule: 'Comment: ≥ commenter' },
  { action: 'react', minRole: 'commenter', rule: 'React: ≥ commenter' },
  { action: 'edit', minRole: 'editor', rule: 'Edit fields, add targets / checks / milestones, move tasks: ≥ editor' },
  {
    action: 'check_in',
    minRole: 'manager',
    grantTags: ['champion'],
    grantTagsWhenChampionAbsent: ['reviewer'],
    rule: 'Check in: champion (or ≥ manager); reviewer may check in if the champion is absent',
  },
  { action: 'acknowledge', minRole: 'manager', grantTags: ['reviewer'], rule: 'Acknowledge check-in / retrospective: reviewer (or manager)' },
  { action: 'close', minRole: 'manager', grantTags: ['champion'], rule: 'Close / reopen / pause / resume / move space: champion or manager' },
  {
    action: 'delete',
    minRole: 'manager',
    blockers: [{ when: 'has_children', kinds: ['goal'] }],
    rule: 'Delete goal / project: manager or owner; blocked while children exist (goal)',
  },
  { action: 'manage_access', minRole: 'manager', rule: 'Share / change privacy: manager' },
  { action: 'create_child', minRole: 'editor', rule: 'Create in a container (space / list / folder / project): ≥ editor on the container' },
  { action: 'transfer', minRole: 'owner', rule: 'Transfer ownership: owner only (manager may not transfer)' },
]

const RULE_BY_ACTION: ReadonlyMap<AclAction, PermissionRule> = new Map(PERMISSION_RULES.map(rule => [rule.action, rule]))

export function permissionRule(action: AclAction): PermissionRule {
  const rule = RULE_BY_ACTION.get(action)
  if (!rule) throw new Error(`No permission rule for action ${action}`)
  return rule
}

export interface PermissionContext {
  /** Effective lattice role (already raised by contextual tags), `null` = no access. */
  role: AclRole | null
  tags?: ReadonlySet<ContextualTag> | readonly ContextualTag[]
  /** True when the resource has no champion (enables the reviewer check-in path). */
  championAbsent?: boolean
  /** True when the resource still has children (blocks goal deletion). */
  hasChildren?: boolean
  /** Kind of the resource, for kind-scoped blockers. */
  kind?: EntityKind
}

export type PermissionOutcome =
  | { allowed: true; via: 'role' | 'tag' }
  | { allowed: false; reason: 'insufficient_role' | PermissionBlocker }

function hasTag(tags: PermissionContext['tags'], tag: ContextualTag): boolean {
  if (!tags) return false
  return Array.isArray(tags) ? tags.includes(tag) : (tags as ReadonlySet<ContextualTag>).has(tag)
}

/** Apply one §8.3 rule. Pure; the ACL engine and the matrix generator share it. */
export function applyPermissionRule(action: AclAction, context: PermissionContext): PermissionOutcome {
  const rule = permissionRule(action)
  let via: 'role' | 'tag' | null = null
  if (rule.minRole && roleAtLeast(context.role, rule.minRole)) via = 'role'
  else if (rule.grantTags?.some(tag => hasTag(context.tags, tag))) via = 'tag'
  else if (context.championAbsent && rule.grantTagsWhenChampionAbsent?.some(tag => hasTag(context.tags, tag))) via = 'tag'
  if (!via) return { allowed: false, reason: 'insufficient_role' }
  for (const blocker of rule.blockers ?? []) {
    if (blocker.when === 'has_children' && context.hasChildren && context.kind && blocker.kinds.includes(context.kind)) {
      return { allowed: false, reason: 'has_children' }
    }
  }
  return { allowed: true, via }
}

/** Raise a lattice role by the contextual tags held on the resource. */
export function roleWithTags(role: AclRole | null, tags: Iterable<ContextualTag>): AclRole | null {
  let best = role
  for (const tag of tags) {
    const implied = CONTEXTUAL_TAG_ROLE[tag]
    if (!best || roleAtLeast(implied, best)) best = implied
  }
  return best
}

export interface PermissionMatrixRow {
  action: AclAction
  /** Effective role *before* contextual tags are applied (`null` = no row / no_access). */
  role: AclRole | null
  /** Contextual tags held (sorted). */
  tags: readonly ContextualTag[]
  championAbsent: boolean
  hasChildren: boolean
  kind: EntityKind
  /** Role after tags (what the engine evaluates). */
  effectiveRole: AclRole | null
  allowed: boolean
  reason?: 'insufficient_role' | PermissionBlocker
}

/** Tag scenarios enumerated by the generator (stable order). */
export const PERMISSION_MATRIX_TAG_SCENARIOS: ReadonlyArray<{ tags: readonly ContextualTag[]; championAbsent: boolean }> = [
  { tags: [], championAbsent: false },
  { tags: ['champion'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: true },
  { tags: ['contributor'], championAbsent: false },
  { tags: ['assignee'], championAbsent: false },
  { tags: ['owner'], championAbsent: false },
]

export interface GeneratePermissionMatrixOptions {
  /** Kinds to enumerate (default: goal + project + task + note — the §8.3 subjects). */
  kinds?: readonly EntityKind[]
}

/**
 * Enumerate the §8.3 matrix: action × role (incl. no access) × tag scenario ×
 * has-children, per kind. Output order is deterministic so snapshots and the
 * W1-10 harness can diff it. Frozen contract (W1-10 consumes it).
 */
export function generatePermissionMatrix(options: GeneratePermissionMatrixOptions = {}): PermissionMatrixRow[] {
  const kinds = options.kinds ?? (['goal', 'project', 'task', 'note'] as const)
  const roles: (AclRole | null)[] = [null, ...ACL_ROLES]
  const rows: PermissionMatrixRow[] = []
  for (const kind of kinds) {
    for (const action of ACL_ACTIONS) {
      for (const role of roles) {
        for (const scenario of PERMISSION_MATRIX_TAG_SCENARIOS) {
          for (const hasChildren of [false, true]) {
            const tags = [...scenario.tags].sort()
            const effective = roleWithTags(role, tags)
            const outcome = applyPermissionRule(action, {
              role: effective,
              tags,
              championAbsent: scenario.championAbsent,
              hasChildren,
              kind,
            })
            rows.push({
              action,
              role,
              tags,
              championAbsent: scenario.championAbsent,
              hasChildren,
              kind,
              effectiveRole: effective,
              allowed: outcome.allowed,
              ...(outcome.allowed ? {} : { reason: outcome.reason }),
            })
          }
        }
      }
    }
  }
  return rows
}
