/**
 * W1-04 (#1501) — ACL engine: `acl.can(principal, action, ref)`.
 *
 * DATA-MODEL §8.2 role sources, evaluated in order (the highest role wins):
 *   1. explicit `acl_entry` rows (subjects: principal | department | channel |
 *      space | workspace | link);
 *   2. contextual role tags (owner, champion, reviewer, contributor, assignee);
 *   3. parent inheritance (space → goal → project → task, folder → items, …)
 *      unless the resource is secret ("Only invited people");
 *   4. privacy presets / `resource_policy` defaults (space, workspace, link).
 * Then the §8.3 rule for the action is applied (`../entities/permissions.ts`).
 *
 * Hard denials come first and are never overridden by any grant:
 *   - principal from another workspace (`cross_workspace`);
 *   - no active workspace membership — revoked / left / removed (`not_member`);
 *   - placeholder or deactivated principal (`placeholder` / `inactive`);
 *   - unknown or deleted resource (`not_found`).
 *
 * Guests (`principal.kind === 'guest'`) only receive roles from grants made to
 * them explicitly (principal entries, contextual tags, valid share links) and
 * the inheritance of those grants down the tree; group subjects (workspace,
 * space, department, channel) and policy defaults never apply to them, and
 * their role is capped at `editor`.
 *
 * Results are cached per workspace `policy_epoch` (✔ `workspace.policy_epoch`):
 * a bump invalidates every cached role for that workspace. Writers of ACL
 * facts (entries, policies, memberships, contextual tags) must bump the epoch.
 *
 * The engine is pure TypeScript over an injected `AclFactSource`; the server
 * (`apps/workspace-service/src/modules/acl`) backs it with Postgres and the
 * local single-user host uses `./local-shim.ts`.
 */

import { applyPermissionRule, roleWithTags, type ContextualTag } from '../entities/permissions.ts'
import type { EntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { AclAction } from './actions.ts'
import { effectiveRole, maxRole, minRole, roleAtLeast, type AclRole, type AclStoredRole } from './roles.ts'

/** `acl_entry.resource_type` values (DDL `503-acl.sql`). */
export const ACL_RESOURCE_TYPES = [
  'channel', 'note', 'folder', 'wiki-space', 'task-list', 'task', 'calendar', 'base', 'form',
  'okr-cycle', 'goal', 'project', 'space', 'kpi', 'project-template', 'doc', 'file', 'drive-link',
] as const

export type AclResourceType = (typeof ACL_RESOURCE_TYPES)[number]

const RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(ACL_RESOURCE_TYPES)

/**
 * Entity kind → ACL resource type when the kind carries its own `acl_entry`
 * rows; `null` when its access derives from a parent (goal-target → goal,
 * milestone → project, channel-message → channel, calendar-event → calendar…).
 */
export function aclResourceTypeForKind(kind: EntityKind): AclResourceType | null {
  return RESOURCE_TYPE_SET.has(kind) ? (kind as AclResourceType) : null
}

/** `acl_entry.subject_type` values (DATA-MODEL §8.1). */
export const ACL_SUBJECT_TYPES = ['principal', 'department', 'channel', 'space', 'workspace', 'link'] as const

export type AclSubjectType = (typeof ACL_SUBJECT_TYPES)[number]

/** `principal.kind` (DDL `502-directory.sql`). */
export type AclPrincipalKind = 'human' | 'bot' | 'guest' | 'service'

/** `principal.status` (DDL `513-identity-lifecycle.sql`). */
export type AclPrincipalStatus = 'active' | 'placeholder' | 'deactivated'

export interface AclPrincipal {
  id: string
  /** Workspace the principal is acting in (authenticated workspace). */
  workspaceId: string
  kind?: AclPrincipalKind
  status?: AclPrincipalStatus
  /** Share-link token presented with the request, if any. */
  linkToken?: string
}

export interface AclMembership {
  role: 'owner' | 'member'
  /** `workspace_member.status` (v2); absent = active. */
  status?: 'invited' | 'active' | 'left' | 'removed'
}

export interface AclResourceNode {
  ref: EntityRef
  workspaceId: string
  /** Parents for inheritance (e.g. task → project, project → goal, goal → space). */
  parents?: readonly EntityRef[]
  /** `invited` = secret: "Only invited people" — no inheritance, no policy defaults. */
  privacy?: 'inherit' | 'invited'
  /** Owning space, for `space` subjects / presets. */
  spaceId?: string | null
  ownerId?: string | null
  championId?: string | null
  reviewerId?: string | null
  contributorIds?: readonly string[]
  assigneeIds?: readonly string[]
  /** Goal still has child goals / projects (blocks delete). */
  hasChildren?: boolean
  deleted?: boolean
}

export interface AclEntryFact {
  subjectType: AclSubjectType
  subjectId: string
  role: AclStoredRole
}

export interface AclPolicyFact {
  defaultSubject?: 'space' | 'workspace' | 'link' | null
  defaultRole?: 'viewer' | 'commenter' | 'editor' | null
  /** Share-link token for `defaultSubject: 'link'`. */
  linkToken?: string | null
  /** ISO timestamp after which every link grant on this resource is void. */
  linkExpiresAt?: string | null
}

export interface AclPrincipalGroups {
  departmentIds: readonly string[]
  channelIds: readonly string[]
}

type MaybePromise<T> = T | Promise<T>

/** Facts the engine needs; the server backs this with SQL, tests with memory. */
export interface AclFactSource {
  policyEpoch(workspaceId: string): MaybePromise<string>
  membership(workspaceId: string, principalId: string): MaybePromise<AclMembership | null>
  resource(workspaceId: string, ref: EntityRef): MaybePromise<AclResourceNode | null>
  entries(workspaceId: string, ref: EntityRef): MaybePromise<readonly AclEntryFact[]>
  policy(workspaceId: string, ref: EntityRef): MaybePromise<AclPolicyFact | null>
  groups(workspaceId: string, principalId: string): MaybePromise<AclPrincipalGroups>
}

export type AclRoleSource =
  | 'explicit'
  | 'contextual'
  | 'inherited'
  | 'policy'
  | 'link'
  | 'workspace-admin'
  | 'local-owner'

export type AclDenyReason =
  | 'cross_workspace'
  | 'not_member'
  | 'placeholder'
  | 'inactive'
  | 'not_found'
  | 'no_access'
  | 'insufficient_role'
  | 'has_children'

export interface AclDecision {
  allowed: boolean
  action: AclAction
  role: AclRole | null
  source: AclRoleSource | null
  /** Preview level the actor may see (§8.3 "Read entity / preview"). */
  preview: 'full' | 'minimal' | 'none'
  /** Resource is secret; unviewable secret refs are omitted from listings. */
  secret: boolean
  reason?: AclDenyReason
}

/** Role evaluation result for one principal × ref (cached per policy epoch). */
export interface AclRoleResult {
  role: AclRole | null
  source: AclRoleSource | null
  secret: boolean
  tags: readonly ContextualTag[]
  championAbsent: boolean
  hasChildren: boolean
  kind: EntityKind
  denied?: Extract<AclDenyReason, 'cross_workspace' | 'not_member' | 'placeholder' | 'inactive' | 'not_found'>
}

export interface Acl {
  /** `acl.can(principal, action, ref)` — the contracts-v1 entry point. */
  can(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<boolean>
  evaluate(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<AclDecision>
  evaluateMany(principal: AclPrincipal, action: AclAction, refs: readonly EntityRef[]): Promise<AclDecision[]>
  roleOf(principal: AclPrincipal, ref: EntityRef): Promise<AclRoleResult>
}

export interface AclEngine extends Acl {
  /** Drop every cached role (tests; a policy-epoch bump does this per workspace). */
  clearCache(): void
  readonly cacheSize: number
}

export interface CreateAclOptions {
  /** Clock for link expiry (tests). */
  now?: () => number
  /** Max cached role results (default 10 000). */
  cacheCapacity?: number
  /** Max inheritance depth (default 16; cycles are also guarded). */
  maxDepth?: number
}

/** Kinds where share links may grant access (DATA-MODEL §8.2.4: docs, forms only). */
export const LINK_SHAREABLE_KINDS: readonly EntityKind[] = ['note', 'form', 'file']

/** Guests never exceed this role. */
export const GUEST_ROLE_CAP: AclRole = 'editor'

const PREVIEW_FOR_DENIED: AclDecision['preview'] = 'none'

function aclRefKey(ref: EntityRef): string {
  // Fragments address a sub-part; access is decided on the entity itself.
  return `${ref.kind}:${ref.id}`
}

function linkExpired(policy: AclPolicyFact | null, now: number): boolean {
  if (!policy?.linkExpiresAt) return false
  const at = Date.parse(policy.linkExpiresAt)
  return !Number.isFinite(at) || at <= now
}

function tagsFor(node: AclResourceNode, principalId: string): ContextualTag[] {
  const tags: ContextualTag[] = []
  if (node.ownerId && node.ownerId === principalId) tags.push('owner')
  if (node.championId && node.championId === principalId) tags.push('champion')
  if (node.reviewerId && node.reviewerId === principalId) tags.push('reviewer')
  if (node.contributorIds?.includes(principalId)) tags.push('contributor')
  if (node.assigneeIds?.includes(principalId)) tags.push('assignee')
  return tags.sort()
}

function previewFor(role: AclRole | null): AclDecision['preview'] {
  if (roleAtLeast(role, 'viewer')) return 'full'
  if (roleAtLeast(role, 'minimal')) return 'minimal'
  return 'none'
}

/** Build a decision from a role result. Shared with the local shim. */
export function decide(action: AclAction, result: AclRoleResult): AclDecision {
  if (result.denied) {
    return { allowed: false, action, role: null, source: null, preview: PREVIEW_FOR_DENIED, secret: result.secret, reason: result.denied }
  }
  const outcome = applyPermissionRule(action, {
    role: result.role,
    tags: result.tags,
    championAbsent: result.championAbsent,
    hasChildren: result.hasChildren,
    kind: result.kind,
  })
  const preview = previewFor(result.role)
  if (outcome.allowed) {
    return { allowed: true, action, role: result.role, source: result.source, preview, secret: result.secret }
  }
  return {
    allowed: false,
    action,
    role: result.role,
    source: result.source,
    preview,
    secret: result.secret,
    reason: result.role ? outcome.reason : 'no_access',
  }
}

interface RoleAccumulator {
  role: AclRole | null
  source: AclRoleSource | null
}

function raise(acc: RoleAccumulator, role: AclRole | null, source: AclRoleSource): void {
  if (!role) return
  const next = maxRole(acc.role, role)
  if (next !== acc.role) {
    acc.role = next
    acc.source = source
  }
}

/** Create an ACL engine over a fact source. */
export function createAcl(facts: AclFactSource, options: CreateAclOptions = {}): AclEngine {
  const now = options.now ?? Date.now
  const capacity = options.cacheCapacity ?? 10_000
  const maxDepth = options.maxDepth ?? 16
  const cache = new Map<string, AclRoleResult>()
  const epochByWorkspace = new Map<string, string>()

  const remember = (key: string, value: AclRoleResult): void => {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, value)
    if (cache.size > capacity) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
  }

  async function currentEpoch(workspaceId: string): Promise<string> {
    const epoch = String(await facts.policyEpoch(workspaceId))
    const previous = epochByWorkspace.get(workspaceId)
    if (previous !== undefined && previous !== epoch) {
      const prefix = `${workspaceId}\0${previous}\0`
      for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key)
    }
    epochByWorkspace.set(workspaceId, epoch)
    return epoch
  }

  async function roleOf(principal: AclPrincipal, ref: EntityRef): Promise<AclRoleResult> {
    const base: AclRoleResult = {
      role: null, source: null, secret: false, tags: [], championAbsent: false, hasChildren: false, kind: ref.kind,
    }
    if (principal.status === 'placeholder') return { ...base, denied: 'placeholder' }
    if (principal.status === 'deactivated') return { ...base, denied: 'inactive' }
    const workspaceId = principal.workspaceId
    const epoch = await currentEpoch(workspaceId)
    const key = [workspaceId, epoch, principal.id, principal.kind ?? 'human', principal.linkToken ?? '', aclRefKey(ref)].join('\0')
    const cached = cache.get(key)
    if (cached) {
      remember(key, cached)
      return cached
    }
    const result = await computeRole(principal, ref, base)
    remember(key, result)
    return result
  }

  async function computeRole(principal: AclPrincipal, ref: EntityRef, base: AclRoleResult): Promise<AclRoleResult> {
    const workspaceId = principal.workspaceId
    const membership = await facts.membership(workspaceId, principal.id)
    if (!membership || (membership.status !== undefined && membership.status !== 'active')) {
      return { ...base, denied: 'not_member' }
    }
    const root = await facts.resource(workspaceId, ref)
    if (!root || root.deleted) return { ...base, denied: 'not_found' }
    if (root.workspaceId !== workspaceId) return { ...base, denied: 'cross_workspace' }

    const guest = principal.kind === 'guest'
    const groups = guest ? { departmentIds: [], channelIds: [] } : await facts.groups(workspaceId, principal.id)
    const spaceMemberCache = new Map<string, boolean>()
    const nowMs = now()

    // Space membership = an explicit (non-policy) grant on the space itself.
    const isSpaceMember = async (spaceId: string): Promise<boolean> => {
      if (guest) return false
      const hit = spaceMemberCache.get(spaceId)
      if (hit !== undefined) return hit
      spaceMemberCache.set(spaceId, false) // guards self-reference
      const spaceRef: EntityRef = { kind: 'space', id: spaceId }
      const entries = await facts.entries(workspaceId, spaceRef)
      let member = false
      for (const entry of entries) {
        if (entry.subjectType === 'principal' && entry.subjectId === principal.id) member = true
        else if (entry.subjectType === 'department' && groups.departmentIds.includes(entry.subjectId)) member = true
        else if (entry.subjectType === 'channel' && groups.channelIds.includes(entry.subjectId)) member = true
        if (member) break
      }
      spaceMemberCache.set(spaceId, member)
      return member
    }

    const nodeCache = new Map<string, AclResourceNode | null>([[aclRefKey(ref), root]])
    const loadNode = async (target: EntityRef): Promise<AclResourceNode | null> => {
      const key = aclRefKey(target)
      if (nodeCache.has(key)) return nodeCache.get(key) ?? null
      const node = await facts.resource(workspaceId, target)
      const usable = node && !node.deleted && node.workspaceId === workspaceId ? node : null
      nodeCache.set(key, usable)
      return usable
    }

    const roleOn = async (node: AclResourceNode, depth: number, visiting: Set<string>): Promise<RoleAccumulator> => {
      const acc: RoleAccumulator = { role: null, source: null }
      const policy = await facts.policy(workspaceId, node.ref)
      const secret = node.privacy === 'invited'
      const linkOk = LINK_SHAREABLE_KINDS.includes(node.ref.kind)
        && !!principal.linkToken && !linkExpired(policy, nowMs)

      // 1. Explicit entries.
      for (const entry of await facts.entries(workspaceId, node.ref)) {
        const role = effectiveRole(entry.role)
        switch (entry.subjectType) {
          case 'principal':
            if (entry.subjectId === principal.id) raise(acc, role, 'explicit')
            break
          case 'department':
            if (!guest && groups.departmentIds.includes(entry.subjectId)) raise(acc, role, 'explicit')
            break
          case 'channel':
            if (!guest && groups.channelIds.includes(entry.subjectId)) raise(acc, role, 'explicit')
            break
          case 'space':
            if (!guest && await isSpaceMember(entry.subjectId)) raise(acc, role, 'explicit')
            break
          case 'workspace':
            if (!guest && entry.subjectId === workspaceId) raise(acc, role, 'explicit')
            break
          case 'link':
            if (linkOk && entry.subjectId === principal.linkToken) raise(acc, role, 'link')
            break
        }
      }

      // 2. Contextual role tags.
      const tags = tagsFor(node, principal.id)
      if (tags.length) raise(acc, roleWithTags(null, tags), 'contextual')

      // 3. Inheritance (never into secret resources).
      if (!secret && depth < maxDepth) {
        for (const parentRef of node.parents ?? []) {
          const parentKey = aclRefKey(parentRef)
          if (visiting.has(parentKey)) continue
          const parent = await loadNode(parentRef)
          if (!parent) continue
          visiting.add(parentKey)
          const inherited = await roleOn(parent, depth + 1, visiting)
          visiting.delete(parentKey)
          raise(acc, inherited.role, 'inherited')
        }
      }

      // 4. Privacy presets / resource policy defaults.
      if (policy?.defaultRole && !secret) {
        if (policy.defaultSubject === 'workspace' && !guest) raise(acc, policy.defaultRole, 'policy')
        else if (policy.defaultSubject === 'space' && !guest && node.spaceId && await isSpaceMember(node.spaceId)) {
          raise(acc, policy.defaultRole, 'policy')
        } else if (policy.defaultSubject === 'link' && linkOk && policy.linkToken && policy.linkToken === principal.linkToken) {
          raise(acc, policy.defaultRole, 'link')
        }
      }
      return acc
    }

    const acc = await roleOn(root, 0, new Set([aclRefKey(ref)]))
    if (guest) acc.role = minRole(acc.role, GUEST_ROLE_CAP)
    else if (membership.role === 'owner') raise(acc, 'manager', 'workspace-admin')

    return {
      role: acc.role,
      source: acc.role ? acc.source : null,
      secret: root.privacy === 'invited',
      tags: tagsFor(root, principal.id),
      championAbsent: !root.championId,
      hasChildren: root.hasChildren === true,
      kind: root.ref.kind,
    }
  }

  const engine: AclEngine = {
    async can(principal, action, ref) {
      return (await engine.evaluate(principal, action, ref)).allowed
    },
    async evaluate(principal, action, ref) {
      return decide(action, await roleOf(principal, ref))
    },
    async evaluateMany(principal, action, refs) {
      const out: AclDecision[] = []
      for (const ref of refs) out.push(await engine.evaluate(principal, action, ref))
      return out
    },
    roleOf,
    clearCache() {
      cache.clear()
      epochByWorkspace.clear()
    },
    get cacheSize() {
      return cache.size
    },
  }
  return engine
}

/** How a listing (link list, tree, feed) must treat a ref, given its `view` decision. */
export type ListingVisibility = 'show' | 'title-only' | 'restricted' | 'hide'

/**
 * Listing rule (TECH-SPEC §7, UI-SPEC "secret goal: no placeholder row"):
 * full preview → show; minimal → title only; no access → a redacted
 * `{kind, restricted}` row — except secret resources, which are omitted.
 */
export function listingVisibility(decision: AclDecision): ListingVisibility {
  if (decision.preview === 'full') return 'show'
  if (decision.preview === 'minimal') return 'title-only'
  if (decision.secret) return 'hide'
  return 'restricted'
}
