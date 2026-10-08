/**
 * W1-04 (#1501) — ACL engine: `acl.can(principal, action, ref)`.
 *
 * DATA-MODEL §8.2 role sources, evaluated in order (the highest role wins):
 *   1. explicit `acl_entry` rows (subjects: principal | department | channel |
 *      space | workspace | link). On a secret resource the group subjects
 *      `space` / `workspace` are ignored ("Only invited people");
 *   2. contextual role tags (owner, champion, reviewer, contributor, assignee);
 *   3. parent inheritance (folder → items, project → milestones / tasks,
 *      goal → targets / checks / check-ins, task-list → tasks, …), never into
 *      a secret resource. Edges goal → child goal and goal → project carry NO
 *      inheritance (every goal / project has its own privacy; a goal's
 *      champion is not manager of its descendants) — see `inheritanceEdge`.
 *      A **channel** (chat) parent is capped: the child inherits
 *      min(chat-member role, child preset role — viewer by default); only the
 *      principal's own chat role counts (principal / department / channel
 *      grants on the chat), never the public-chat `minimal` workspace access.
 *      A **space** parent is special (§8.2.3 "when privacy =
 *      Everyone in the space…"): the child gets space-member access only
 *      when its own privacy is space-wide (`resource_policy.default_subject =
 *      'space'`, or no policy and the kind is space-visible by default — see
 *      `SPACE_VISIBLE_BY_DEFAULT_KINDS`), capped at the child's preset role
 *      (`default_role`, viewer when absent). Nothing else flows down from a
 *      space: neither the member's role on the space nor the space's company
 *      access (`default_access = company_*`); a child is company-visible only
 *      through its own company-wide preset;
 *   4. privacy presets / `resource_policy` defaults (space, workspace, link).
 *   5. workspace owners (`workspace_member.role = 'owner'`) get `manager` on
 *      NON-secret resources only; a secret resource (or one below a secret
 *      ancestor) stays hidden from them unless they hold their own grant.
 *      UNDONE: admin recovery of secret resources is a later, audited feature.
 * Then the §8.3 rule for the action is applied (`../entities/permissions.ts`).
 *
 * Secrecy is decoupled from role flow: a separate ancestry walk visits every
 * structural parent — role-carrying `parents` AND secrecy-only `ancestors`
 * (cut edges: goal → child goal / project, a goal-owned folder, a members-mode
 * task list's project / space, …), recursively, including a chat parent's own
 * space. The result is secret when the resource or ANY ancestor is secret,
 * and also when the ancestry is incomplete (`maxDepth` hit, or a parent that
 * cannot be loaded): fail closed. Under a secret / incomplete ancestry there
 * is no workspace-owner bypass and listings hide the ref instead of showing a
 * restricted row. Role inheritance still follows `inheritanceEdge()` only.
 *
 * Contextual tags on a space goal (owner / champion / reviewer) count only
 * while the principal is a member of that space: a champion removed from the
 * space keeps nothing beyond what the edges give.
 *
 * Space membership through the space chat counts only when joining that chat
 * was allowed: a chat-derived membership (`groups.channelIds`, or entries
 * marked `via: 'chat'`) is ignored for a space whose chat is public while the
 * space is not company-wide or is secret — a self-join there must never grant
 * the space. Likewise a chat in a non-company or secret space is never open
 * to the workspace: workspace-subject grants / presets on it are ignored.
 *
 * Space membership (`isSpaceMember`) = active membership of the space chat
 * (`AclResourceNode.chatId` ∈ the principal's channels, subject to the join
 * rule above) OR an explicit
 * principal / department / channel grant on the space with a lattice role ≥
 * viewer. `minimal`, `free_busy`, `follower` (and `guest`) grants do not make
 * anyone a space member.
 *
 * Hard denials come first and are never overridden by any grant:
 *   - no active workspace membership — revoked / left / removed (`not_member`);
 *   - placeholder or deactivated principal (`placeholder` / `inactive`);
 *   - unknown or deleted resource, or a resource of another workspace
 *     (`not_found` — a foreign ref is indistinguishable from a missing one).
 *
 * Guests (`principal.kind === 'guest'`) only receive roles from grants made to
 * them explicitly (principal entries, contextual tags, valid share links) and
 * the inheritance of those grants down the tree; group subjects (workspace,
 * space, department, channel) and policy defaults never apply to them, and
 * their role is capped at `editor`.
 *
 * Caching: role results are keyed by workspace `policy_epoch` (a bump drops
 * every cached role of that workspace) AND expire after `cacheTtlMs`
 * (default 45 s) as defence in depth for writers that forget the bump. The
 * facts whose writers must bump the epoch are listed on `AclFactSource`.
 * Within one evaluation batch the epoch is read once, every fact read is
 * memoised once (`memoizeFacts`, the only per-batch memo) and refs are
 * evaluated with bounded concurrency; the first failure stops the workers.
 *
 * The engine is pure TypeScript over an injected `AclFactSource`; the server
 * (`apps/workspace-service/src/modules/acl`) backs it with Postgres and the
 * local single-user host uses `./local-shim.ts`.
 */

import { applyPermissionRule, roleWithTags, type ContextualTag } from '../entities/permissions.ts'
import type { EntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { AclAction } from './actions.ts'
import { effectiveRole, isAclRole, maxRole, minRole, roleAtLeast, type AclRole, type AclStoredRole } from './roles.ts'

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
  /** Parents for role inheritance (e.g. task → project, goal → space); edge rules in `inheritanceEdge`. */
  parents?: readonly EntityRef[]
  /**
   * Secrecy-only structural ancestors: parents whose edge carries no role
   * (goal → child goal / project, goal-owned folder, a members-mode task
   * list's project / space). Checked for privacy, never inherited from.
   */
  ancestors?: readonly EntityRef[]
  /** `invited` = secret: "Only invited people" — no inheritance, no policy defaults. */
  privacy?: 'inherit' | 'invited'
  /** Owning space, for `space` subjects / presets. */
  spaceId?: string | null
  /** Space nodes only: the space chat; its active members are space members (§5.7). */
  chatId?: string | null
  /** Space nodes only: the space chat is public (self-joinable). */
  chatPublic?: boolean
  /** Space nodes only: company-wide space (`is_company_space` or `default_access <> 'members'`). */
  companyWide?: boolean
  /**
   * Synthetic entries derived from the row itself (table-level visibility
   * that predates `acl_entry`, e.g. legacy `project.visibility = 'members'`
   * → workspace viewer). Merged with `entries()`; ignored on secret nodes for
   * the group subjects, like stored entries.
   */
  implicitEntries?: readonly AclEntryFact[]
  /** Row-derived policy (e.g. `doc.public_token`), used only when `policy()` has no row. */
  defaultPolicy?: AclPolicyFact | null
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
  /** Synthesised from chat membership (`chat_member`), not a stored grant. */
  via?: 'chat'
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

/**
 * Facts the engine needs; the server backs this with SQL, tests with memory.
 *
 * EPOCH-BUMPING FACTS — every writer of one of these must bump
 * `workspace.policy_epoch` in the same transaction (the 45 s cache TTL is only
 * defence in depth):
 *   - `acl_entry` rows (insert / update / delete) and `resource_policy` rows
 *     (default_subject, default_role, policy.privacy / link_token /
 *     link_expires_at);
 *   - `workspace_member` (insert, role, status, deleted_at) and
 *     `principal.status` / `principal.kind` / `principal.deleted_at`;
 *   - `department_member`, `department.deleted_at`;
 *   - `chat_member` (role, state) — channel grants and space membership —
 *     and `chat.visibility`, `chat.deleted_at`;
 *   - contextual tags: owner / creator, `champion_id`, `reviewer_id`,
 *     `project_member`, `work_item_member`, `goal.creator_id`;
 *   - tree shape: parent_goal_id, project_id, milestone_id, parent_id,
 *     folder_id, wiki_space_id, space_id, owner_type / owner_id,
 *     `task_in_list`, `space.chat_id`;
 *   - visibility columns: `project.visibility`, `space.default_access`,
 *     `space.is_company_space`, `goal.scope`, `task_list.share_mode`,
 *     `doc.public_token`;
 *   - soft deletes (`deleted_at`) of any resource row.
 */
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
  /** Resource is secret (itself, an ancestor, or incomplete ancestry); unviewable secret refs are omitted from listings. */
  secret: boolean
  /** The ancestry walk could not be completed (depth limit / unloadable parent); counted as secret. */
  ancestryIncomplete?: boolean
  reason?: AclDenyReason
}

/** Role evaluation result for one principal × ref (cached per policy epoch). */
export interface AclRoleResult {
  role: AclRole | null
  source: AclRoleSource | null
  secret: boolean
  ancestryIncomplete?: boolean
  tags: readonly ContextualTag[]
  championAbsent: boolean
  hasChildren: boolean
  kind: EntityKind
  denied?: Extract<AclDenyReason, 'not_member' | 'placeholder' | 'inactive' | 'not_found'>
}

export interface Acl {
  /** `acl.can(principal, action, ref)` — the contracts-v1 entry point. */
  can(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<boolean>
  evaluate(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<AclDecision>
  evaluateMany(principal: AclPrincipal, action: AclAction, refs: readonly EntityRef[]): Promise<AclDecision[]>
  roleOf(principal: AclPrincipal, ref: EntityRef): Promise<AclRoleResult>
  /**
   * Active principal (not placeholder / deactivated) with an active membership
   * of `principal.workspaceId`. Never cached (used for `user:{id}` topics).
   */
  isActiveMember(principal: AclPrincipal): Promise<boolean>
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
  /** Role-cache entry lifetime in ms (default 45 000; defence in depth next to the epoch). */
  cacheTtlMs?: number
  /** Max refs evaluated concurrently in one batch (default 8). */
  concurrency?: number
}

export const DEFAULT_ACL_CACHE_TTL_MS = 45_000
export const DEFAULT_ACL_CONCURRENCY = 8

/**
 * Kinds whose spec default privacy is "Everyone in the space…" (DATA-MODEL
 * §8.2.3: goals, projects, KPIs, folders, the board). With no
 * `resource_policy` row they inherit space-member access, capped at viewer.
 */
export const SPACE_VISIBLE_BY_DEFAULT_KINDS: readonly EntityKind[] = ['goal', 'project', 'kpi', 'folder', 'task-list']

/** Cap for space → child inheritance; `null` when the child is not space-wide. */
export function spaceInheritanceCap(kind: EntityKind, policy: AclPolicyFact | null): AclRole | null {
  if (policy) return policy.defaultSubject === 'space' ? (policy.defaultRole ?? 'viewer') : null
  return SPACE_VISIBLE_BY_DEFAULT_KINDS.includes(kind) ? 'viewer' : null
}

/** Goal children that inherit from their goal (DATA-MODEL §8.2.3: targets, checks, check-ins). */
export const GOAL_INHERITING_KINDS: readonly EntityKind[] = ['goal-target', 'goal-check', 'check-in']

/**
 * How access flows over a parent → child edge:
 * - `space`: capped, only into space-wide children (`spaceInheritanceCap`);
 * - `chat`: capped at min(chat-member role, child preset role ?? viewer);
 * - `none`: no inheritance (goal → child goal, goal → project);
 * - `full`: the parent role flows down unchanged.
 */
export type InheritanceEdge = 'full' | 'space' | 'chat' | 'none'

export function inheritanceEdge(parentKind: EntityKind, childKind: EntityKind): InheritanceEdge {
  if (parentKind === 'space') return 'space'
  if (parentKind === 'channel') return 'chat'
  if (parentKind === 'goal') return GOAL_INHERITING_KINDS.includes(childKind) ? 'full' : 'none'
  return 'full'
}

/** Cap for chat → child inheritance: the child's preset role, viewer by default. */
export function chatInheritanceCap(policy: AclPolicyFact | null): AclRole {
  return policy?.defaultRole ?? 'viewer'
}

/** Grants that confer space membership: a lattice role ≥ viewer (not minimal / follower / free_busy / guest). */
function grantsSpaceMembership(role: AclStoredRole): boolean {
  return isAclRole(role) && roleAtLeast(role, 'viewer')
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
function incompleteFlag(result: AclRoleResult): { ancestryIncomplete?: true } {
  return result.ancestryIncomplete ? { ancestryIncomplete: true } : {}
}

export function decide(action: AclAction, result: AclRoleResult): AclDecision {
  if (result.denied) {
    return { allowed: false, action, role: null, source: null, preview: PREVIEW_FOR_DENIED, secret: result.secret, ...incompleteFlag(result), reason: result.denied }
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
    return { allowed: true, action, role: result.role, source: result.source, preview, secret: result.secret, ...incompleteFlag(result) }
  }
  return {
    allowed: false,
    action,
    role: result.role,
    source: result.source,
    preview,
    secret: result.secret,
    ...incompleteFlag(result),
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

/**
 * Run `fn` over `items` with at most `limit` in flight; results keep input
 * order. The first rejection sets a shared `failed` flag so the other workers
 * stop taking new items (no more fact reads after the batch has failed).
 */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        out[index] = await fn(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** Per-batch memo over a fact source: each distinct read happens once per batch. */
function memoizeFacts(facts: AclFactSource): AclFactSource {
  const memo = new Map<string, Promise<unknown>>()
  const once = <T>(key: string, load: () => MaybePromise<T>): Promise<T> => {
    let hit = memo.get(key) as Promise<T> | undefined
    if (!hit) {
      hit = Promise.resolve().then(load)
      memo.set(key, hit)
    }
    return hit
  }
  const refKey = (ref: EntityRef) => `${ref.kind}:${ref.id}`
  return {
    policyEpoch: ws => once(`e\0${ws}`, () => facts.policyEpoch(ws)),
    membership: (ws, p) => once(`m\0${ws}\0${p}`, () => facts.membership(ws, p)),
    resource: (ws, ref) => once(`r\0${ws}\0${refKey(ref)}`, () => facts.resource(ws, ref)),
    entries: (ws, ref) => once(`a\0${ws}\0${refKey(ref)}`, () => facts.entries(ws, ref)),
    policy: (ws, ref) => once(`p\0${ws}\0${refKey(ref)}`, () => facts.policy(ws, ref)),
    groups: (ws, p) => once(`g\0${ws}\0${p}`, () => facts.groups(ws, p)),
  }
}

interface CachedRole {
  result: AclRoleResult
  at: number
}

/** Create an ACL engine over a fact source. */
export function createAcl(facts: AclFactSource, options: CreateAclOptions = {}): AclEngine {
  const now = options.now ?? Date.now
  const capacity = options.cacheCapacity ?? 10_000
  const maxDepth = options.maxDepth ?? 16
  const ttlMs = options.cacheTtlMs ?? DEFAULT_ACL_CACHE_TTL_MS
  const concurrency = options.concurrency ?? DEFAULT_ACL_CONCURRENCY
  const cache = new Map<string, CachedRole>()
  const epochByWorkspace = new Map<string, string>()

  const remember = (key: string, value: CachedRole): void => {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, value)
    if (cache.size > capacity) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
  }

  async function currentEpoch(source: AclFactSource, workspaceId: string): Promise<string> {
    const epoch = String(await source.policyEpoch(workspaceId))
    const previous = epochByWorkspace.get(workspaceId)
    if (previous !== undefined && previous !== epoch) {
      const prefix = `${workspaceId}\0${previous}\0`
      for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key)
    }
    epochByWorkspace.set(workspaceId, epoch)
    return epoch
  }

  const baseFor = (ref: EntityRef): AclRoleResult => ({
    role: null, source: null, secret: false, tags: [], championAbsent: false, hasChildren: false, kind: ref.kind,
  })

  /** One evaluation batch: epoch read once, facts memoised, refs evaluated concurrently. */
  async function rolesOf(principal: AclPrincipal, refs: readonly EntityRef[]): Promise<AclRoleResult[]> {
    if (principal.status === 'placeholder') return refs.map(ref => ({ ...baseFor(ref), denied: 'placeholder' }))
    if (principal.status === 'deactivated') return refs.map(ref => ({ ...baseFor(ref), denied: 'inactive' }))
    const source = memoizeFacts(facts)
    const workspaceId = principal.workspaceId
    const epoch = await currentEpoch(source, workspaceId)
    return mapBounded(refs, concurrency, async ref => {
      const key = [workspaceId, epoch, principal.id, principal.kind ?? 'human', principal.linkToken ?? '', aclRefKey(ref)].join('\0')
      const cached = cache.get(key)
      const at = now()
      if (cached && at - cached.at <= ttlMs) {
        remember(key, cached)
        return cached.result
      }
      const result = await computeRole(source, principal, ref, baseFor(ref))
      remember(key, { result, at })
      return result
    })
  }

  async function computeRole(source: AclFactSource, principal: AclPrincipal, ref: EntityRef, base: AclRoleResult): Promise<AclRoleResult> {
    const workspaceId = principal.workspaceId
    const membership = await source.membership(workspaceId, principal.id)
    if (!membership || (membership.status !== undefined && membership.status !== 'active')) {
      return { ...base, denied: 'not_member' }
    }
    const root = await source.resource(workspaceId, ref)
    // A foreign-workspace ref is reported exactly like a missing one (no existence oracle).
    if (!root || root.deleted || root.workspaceId !== workspaceId) return { ...base, denied: 'not_found' }

    const guest = principal.kind === 'guest'
    const groups = guest ? { departmentIds: [], channelIds: [] } : await source.groups(workspaceId, principal.id)
    const nowMs = now()

    // Rows come from the per-batch memo (`memoizeFacts`); this only filters.
    const loadNode = async (target: EntityRef): Promise<AclResourceNode | null> => {
      const node = await source.resource(workspaceId, target)
      return node && !node.deleted && node.workspaceId === workspaceId ? node : null
    }
    const entriesOf = async (node: AclResourceNode): Promise<readonly AclEntryFact[]> => {
      const stored = await source.entries(workspaceId, node.ref)
      return node.implicitEntries?.length ? [...node.implicitEntries, ...stored] : stored
    }
    const policyOf = async (node: AclResourceNode): Promise<AclPolicyFact | null> =>
      (await source.policy(workspaceId, node.ref)) ?? node.defaultPolicy ?? null

    // Space membership: active space-chat member, or an explicit principal /
    // department / channel grant on the space with a lattice role ≥ viewer.
    const spaceMemberCache = new Map<string, Promise<boolean>>()
    const isSpaceMember = (spaceId: string): Promise<boolean> => {
      if (guest) return Promise.resolve(false)
      let hit = spaceMemberCache.get(spaceId)
      if (!hit) {
        hit = (async () => {
          const space = await loadNode({ kind: 'space', id: spaceId })
          if (!space) return false
          // Chat-derived membership counts only if joining the space chat was allowed:
          // a public chat may be self-joined only for a company-wide, non-secret space.
          const chatCounts = !space.chatPublic || (space.companyWide === true && space.privacy !== 'invited')
          if (chatCounts && space.chatId && groups.channelIds.includes(space.chatId)) return true
          for (const entry of await entriesOf(space)) {
            if (!grantsSpaceMembership(entry.role)) continue
            if (entry.via === 'chat' && !chatCounts) continue
            if (entry.subjectType === 'principal' && entry.subjectId === principal.id) return true
            if (entry.subjectType === 'department' && groups.departmentIds.includes(entry.subjectId)) return true
            if (entry.subjectType === 'channel' && groups.channelIds.includes(entry.subjectId)) return true
          }
          return false
        })()
        spaceMemberCache.set(spaceId, hit)
      }
      return hit
    }

    // The principal's own role on a chat: principal / department / channel
    // grants only (chat_member-derived entries). Never the public-chat
    // `minimal` workspace access, presets, links or inheritance.
    const chatMemberRole = async (chat: AclResourceNode): Promise<AclRole | null> => {
      let role: AclRole | null = null
      for (const entry of await entriesOf(chat)) {
        const granted = effectiveRole(entry.role)
        if (entry.subjectType === 'principal' && entry.subjectId === principal.id) role = maxRole(role, granted)
        else if (!guest && entry.subjectType === 'department' && groups.departmentIds.includes(entry.subjectId)) role = maxRole(role, granted)
        else if (!guest && entry.subjectType === 'channel' && groups.channelIds.includes(entry.subjectId)) role = maxRole(role, granted)
      }
      return role
    }

    // Contextual tags; on a space goal they count only while the principal is a space member.
    const effectiveTags = async (node: AclResourceNode): Promise<ContextualTag[]> => {
      const tags = tagsFor(node, principal.id)
      if (!tags.length || node.ref.kind !== 'goal' || !node.spaceId) return tags
      const inSpace = (node.parents ?? []).some(p => p.kind === 'space' && p.id === node.spaceId)
      if (!inSpace) return tags
      return (await isSpaceMember(node.spaceId)) ? tags : []
    }

    // Secrecy walk, independent of role flow: every parent and secrecy-only
    // ancestor, recursively. Incomplete ancestry (depth limit or an
    // unloadable parent) fails closed.
    const ancestry = async (start: AclResourceNode): Promise<{ secret: boolean; incomplete: boolean }> => {
      const seen = new Set<string>([aclRefKey(start.ref)])
      let frontier: AclResourceNode[] = [start]
      let incomplete = false
      for (let depth = 0; frontier.length; depth++) {
        const refs: EntityRef[] = []
        for (const node of frontier) {
          for (const next of [...(node.parents ?? []), ...(node.ancestors ?? [])]) {
            const key = aclRefKey(next)
            if (seen.has(key)) continue
            seen.add(key)
            refs.push(next)
          }
        }
        if (!refs.length) break
        if (depth >= maxDepth) return { secret: false, incomplete: true }
        const loaded = await Promise.all(refs.map(loadNode))
        frontier = []
        for (const node of loaded) {
          if (!node) { incomplete = true; continue }
          if (node.privacy === 'invited') return { secret: true, incomplete }
          frontier.push(node)
        }
      }
      return { secret: false, incomplete }
    }

    // A chat may be open to the workspace (public: see / join) only when it has
    // no space, or its space is company-wide and not secret (owner decision).
    const chatOpenToWorkspace = async (chat: AclResourceNode): Promise<boolean> => {
      for (const parentRef of chat.parents ?? []) {
        if (parentRef.kind !== 'space') continue
        const space = await loadNode(parentRef)
        if (!space || space.privacy === 'invited' || space.companyWide !== true) return false
      }
      return true
    }

    const roleOn = async (node: AclResourceNode, depth: number, visiting: Set<string>): Promise<RoleAccumulator> => {
      const acc: RoleAccumulator = { role: null, source: null }
      const policy = await policyOf(node)
      const secret = node.privacy === 'invited'
      const workspaceOpen = node.ref.kind !== 'channel' || await chatOpenToWorkspace(node)
      const linkOk = LINK_SHAREABLE_KINDS.includes(node.ref.kind)
        && !!principal.linkToken && !linkExpired(policy, nowMs)

      // 1. Explicit (stored + row-derived) entries; group subjects space / workspace are void on secret resources.
      for (const entry of await entriesOf(node)) {
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
            if (!guest && !secret && await isSpaceMember(entry.subjectId)) raise(acc, role, 'explicit')
            break
          case 'workspace':
            if (!guest && !secret && workspaceOpen && entry.subjectId === workspaceId) raise(acc, role, 'explicit')
            break
          case 'link':
            if (linkOk && entry.subjectId === principal.linkToken) raise(acc, role, 'link')
            break
        }
      }

      // 2. Contextual role tags.
      const tags = await effectiveTags(node)
      if (tags.length) raise(acc, roleWithTags(null, tags), 'contextual')

      // 3. Inheritance (never into secret resources), per edge kind.
      if (!secret && depth < maxDepth) {
        for (const parentRef of node.parents ?? []) {
          const parentKey = aclRefKey(parentRef)
          if (visiting.has(parentKey)) continue
          const edge = inheritanceEdge(parentRef.kind, node.ref.kind)
          if (edge === 'none') continue
          const parent = await loadNode(parentRef)
          if (!parent) continue
          if (edge === 'space') {
            // §8.2.3: space-member access only into space-wide children, capped at their preset role.
            const cap = parent.privacy === 'invited' ? null : spaceInheritanceCap(node.ref.kind, policy)
            if (cap && await isSpaceMember(parentRef.id)) raise(acc, cap, 'inherited')
            continue
          }
          if (edge === 'chat') {
            const chatRole = await chatMemberRole(parent)
            if (chatRole) raise(acc, minRole(chatRole, chatInheritanceCap(policy)), 'inherited')
            continue
          }
          const branch = new Set(visiting)
          branch.add(parentKey)
          const inherited = await roleOn(parent, depth + 1, branch)
          raise(acc, inherited.role, 'inherited')
        }
      }

      // 4. Privacy presets / resource policy defaults.
      if (policy?.defaultRole && !secret) {
        if (policy.defaultSubject === 'workspace' && !guest && workspaceOpen) raise(acc, policy.defaultRole, 'policy')
        else if (policy.defaultSubject === 'space' && !guest && node.spaceId && await isSpaceMember(node.spaceId)) {
          raise(acc, policy.defaultRole, 'policy')
        } else if (policy.defaultSubject === 'link' && linkOk && policy.linkToken && policy.linkToken === principal.linkToken) {
          raise(acc, policy.defaultRole, 'link')
        }
      }
      return acc
    }

    const acc = await roleOn(root, 0, new Set([aclRefKey(ref)]))
    const lineage = root.privacy === 'invited' ? { secret: true, incomplete: false } : await ancestry(root)
    // Incomplete ancestry counts as secret (owner bypass and listing).
    const secret = lineage.secret || lineage.incomplete
    if (guest) acc.role = minRole(acc.role, GUEST_ROLE_CAP)
    // 5. Workspace owners: manager on non-secret resources only (no admin bypass of "Only invited people").
    else if (membership.role === 'owner' && !secret) raise(acc, 'manager', 'workspace-admin')

    return {
      role: acc.role,
      source: acc.role ? acc.source : null,
      secret,
      ...(lineage.incomplete ? { ancestryIncomplete: true } : {}),
      tags: await effectiveTags(root),
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
      const [result] = await rolesOf(principal, [ref])
      return decide(action, result!)
    },
    async evaluateMany(principal, action, refs) {
      return (await rolesOf(principal, refs)).map(result => decide(action, result))
    },
    async roleOf(principal, ref) {
      const [result] = await rolesOf(principal, [ref])
      return result!
    },
    async isActiveMember(principal) {
      if (principal.status === 'placeholder' || principal.status === 'deactivated') return false
      const membership = await facts.membership(principal.workspaceId, principal.id)
      return !!membership && (membership.status === undefined || membership.status === 'active')
    },
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
