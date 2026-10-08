/**
 * W1-04 (#1501) — Postgres-backed `AclFactSource` for `modules/acl`.
 *
 * Reads the W1-05 (#1502) tables; never writes (the ACL writer commands —
 * share / change privacy — belong to the owning wave-2 modules and must bump
 * `workspace.policy_epoch` in the same transaction). Unknown kinds and
 * non-UUID ids resolve to `null` (→ `not_found`, fail closed).
 *
 * EPOCH-BUMPING FACTS: the authoritative list is on `AclFactSource`
 * (`packages/core/src/acl/evaluate.ts`). Concretely, for the tables read
 * here, writers of: acl_entry, resource_policy, workspace_member, principal
 * (status / kind / deleted_at), department(_member), chat(_member),
 * calendar_member, project_member, work_item_member, task_in_list, and the owner / champion /
 * reviewer / parent / space / folder / visibility / share_mode / scope /
 * default_access / public_token / deleted_at columns of the resource tables
 * in `queries.ts` must bump `workspace.policy_epoch`. Cached roles also expire
 * after 45 s (`DEFAULT_ACL_CACHE_TTL_MS`).
 *
 * Every read is scoped to the evaluating workspace. Row-derived facts (the
 * synthetic workspace entry for table-level visibility, a doc's
 * `public_token` link policy) travel on the node (`implicitEntries` /
 * `defaultPolicy`), so the repository never re-loads a row; the engine's
 * per-batch `memoizeFacts` is the only memo.
 */

import type { SQL, TransactionSQL } from 'bun'
import {
  aclResourceTypeForKind,
  isAclStoredRole,
  type AclEntryFact,
  type AclFactSource,
  type AclMembership,
  type AclPolicyFact,
  type AclPrincipalGroups,
  type AclPrincipalKind,
  type AclPrincipalStatus,
  type AclResourceNode,
  type AclRole,
  type AclStoredRole,
  type AclSubjectType,
} from '../../../../../packages/core/src/acl/index.ts'
import { isEntityKind } from '../../../../../packages/core/src/entities/kinds.ts'
import type { EntityRef } from '../../../../../packages/core/src/entities/refs.ts'
import {
  RESOURCE_LOADERS,
  aclStoredResourceTypes,
  sqlChannels,
  sqlChatMembers,
  sqlDepartments,
  sqlCalendarMembers,
  sqlEntries,
  sqlMembership,
  sqlPolicy,
  sqlPolicyEpoch,
  sqlPrincipal,
  sqlSpaceMembers,
} from './queries.ts'

type Database = SQL | TransactionSQL

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUBJECT_TYPES: ReadonlySet<string> = new Set(['principal', 'department', 'channel', 'space', 'workspace', 'link'])
const POLICY_SUBJECTS: ReadonlySet<string> = new Set(['space', 'workspace', 'link'])
const POLICY_ROLES: ReadonlySet<string> = new Set(['viewer', 'commenter', 'editor'])
/** Roles a loader may emit as the implicit workspace entry (`minimal` = public chat: see and join only). */
const IMPLICIT_ROLES: ReadonlySet<string> = new Set(['minimal', 'viewer', 'commenter', 'editor'])
const CHAT_ROLE: Readonly<Record<string, AclRole>> = { owner: 'manager', admin: 'editor', member: 'commenter' }
/** calendar_member.role → stored ACL role (517-collab.sql). */
const CALENDAR_ROLE: Readonly<Record<string, AclStoredRole>> = { owner: 'manager', editor: 'editor', viewer: 'viewer', free_busy: 'free_busy' }
const CALENDAR_SUBJECTS: ReadonlySet<string> = new Set(['principal', 'space', 'channel', 'workspace'])
/** Space chat role → space role (Operately space members default to edit access). */
const SPACE_ROLE: Readonly<Record<string, AclRole>> = { owner: 'manager', admin: 'manager', member: 'editor' }

/** Normalised loader row (see `queries.ts`). */
export interface ResourceRow {
  id: string
  workspace_id: string
  deleted: boolean
  parent_refs: string[] | null
  space_id: string | null
  owner_id: string | null
  champion_id: string | null
  reviewer_id: string | null
  contributor_ids: string[] | null
  assignee_ids: string[] | null
  has_children: boolean
  secret: boolean
  implicit_workspace_role: string | null
  link_token: string | null
  chat_id?: string | null
  ancestor_refs?: string[] | null
  chat_public?: boolean | null
  company_wide?: boolean | null
}


function parseRefList(values: readonly string[] | null): EntityRef[] {
  const out: EntityRef[] = []
  for (const value of values ?? []) {
    const at = value.indexOf(':')
    if (at <= 0) continue
    const kind = value.slice(0, at)
    const id = value.slice(at + 1)
    if (isEntityKind(kind) && id) out.push({ kind, id })
  }
  return out
}

/** Map a loader row to an ACL node (pure; exported for tests). */
export function resourceFromRow(ref: EntityRef, row: ResourceRow): AclResourceNode {
  const implicit = row.implicit_workspace_role
  // Defence in depth next to the SQL: a secret row never carries a workspace grant.
  const implicitEntries: AclEntryFact[] = !row.secret && implicit && IMPLICIT_ROLES.has(implicit)
    ? [{ subjectType: 'workspace', subjectId: row.workspace_id, role: implicit as AclRole }]
    : []
  return {
    ref: { kind: ref.kind, id: ref.id },
    workspaceId: row.workspace_id,
    parents: parseRefList(row.parent_refs),
    ancestors: parseRefList(row.ancestor_refs ?? null),
    privacy: row.secret ? 'invited' : 'inherit',
    spaceId: row.space_id,
    ownerId: row.owner_id,
    championId: row.champion_id,
    reviewerId: row.reviewer_id,
    contributorIds: row.contributor_ids ?? [],
    assigneeIds: row.assignee_ids ?? [],
    hasChildren: row.has_children === true,
    deleted: row.deleted === true,
    chatId: row.chat_id ?? null,
    ...(row.chat_public == null ? {} : { chatPublic: row.chat_public === true }),
    ...(row.company_wide == null ? {} : { companyWide: row.company_wide === true }),
    implicitEntries,
    // A doc's public_token is a view link unless a resource_policy row says otherwise.
    defaultPolicy: row.link_token ? { defaultSubject: 'link', defaultRole: 'viewer', linkToken: row.link_token, linkExpiresAt: null } : null,
  }
}

export class PostgresAclRepository implements AclFactSource {
  private readonly prefix: string

  constructor(private readonly database: Database, schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid ACL database schema')
    this.prefix = `"${schema}".`
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return await this.database.unsafe<T[]>(sql, params)
  }

  async policyEpoch(workspaceId: string): Promise<string> {
    if (!UUID.test(workspaceId)) return '0'
    const [row] = await this.query<{ policy_epoch: string }>(sqlPolicyEpoch(this.prefix), [workspaceId])
    return row?.policy_epoch ?? '0'
  }

  async membership(workspaceId: string, principalId: string): Promise<AclMembership | null> {
    if (!UUID.test(workspaceId) || !UUID.test(principalId)) return null
    const [row] = await this.query<{ role: 'owner' | 'member'; status: AclMembership['status'] | null }>(sqlMembership(this.prefix), [workspaceId, principalId])
    if (!row) return null
    return row.status ? { role: row.role, status: row.status } : { role: row.role }
  }

  /** `principal.kind` / `principal.status` for building an `AclPrincipal`. */
  async principal(principalId: string): Promise<{ kind: AclPrincipalKind; status: AclPrincipalStatus } | null> {
    if (!UUID.test(principalId)) return null
    const [row] = await this.query<{ kind: AclPrincipalKind; status: AclPrincipalStatus | null }>(sqlPrincipal(this.prefix), [principalId])
    return row ? { kind: row.kind, status: row.status ?? 'active' } : null
  }

  /** Workspace-scoped row load; unknown kinds / non-UUID ids → null (fail closed). */
  async resource(workspaceId: string, ref: EntityRef): Promise<AclResourceNode | null> {
    const loader = RESOURCE_LOADERS[ref.kind]
    if (!loader || !UUID.test(ref.id) || !UUID.test(workspaceId)) return null
    const [row] = await this.query<ResourceRow>(loader(this.prefix), [ref.id, workspaceId])
    return row ? resourceFromRow(ref, row) : null
  }

  async entries(workspaceId: string, ref: EntityRef): Promise<readonly AclEntryFact[]> {
    if (!UUID.test(workspaceId)) return []
    const out: AclEntryFact[] = []
    const type = aclResourceTypeForKind(ref.kind)
    if (type) {
      const rows = await this.query<{ subject_type: string; subject_id: string; role: string }>(sqlEntries(this.prefix), [workspaceId, aclStoredResourceTypes(type).join(','), ref.id])
      for (const row of rows) {
        if (SUBJECT_TYPES.has(row.subject_type) && isAclStoredRole(row.role)) {
          out.push({ subjectType: row.subject_type as AclSubjectType, subjectId: row.subject_id, role: row.role })
        }
      }
    }
    // calendar_member is the canonical calendar share store (acl_entry is also
    // honoured): principal / space / channel / workspace subjects, owner →
    // manager. Channel subjects pass the engine's join rule like any grant.
    if (ref.kind === 'calendar' && UUID.test(ref.id)) {
      const shares = await this.query<{ subject_type: string; subject_id: string; role: string }>(sqlCalendarMembers(this.prefix), [workspaceId, ref.id])
      for (const share of shares) {
        const role = CALENDAR_ROLE[share.role]
        if (role && CALENDAR_SUBJECTS.has(share.subject_type)) {
          out.push({ subjectType: share.subject_type as AclSubjectType, subjectId: share.subject_id, role })
        }
      }
    }
    // Table-level visibility rides on the node (`implicitEntries`); chat / space
    // membership (and calendar_member above) are the only things synthesised here. A chat's ownership comes
    // only from the active chat_member role (never chat.created_by).
    if (ref.kind === 'channel' && UUID.test(ref.id)) {
      const members = await this.query<{ principal_id: string; role: string }>(sqlChatMembers(this.prefix), [ref.id, workspaceId])
      for (const member of members) {
        const role = CHAT_ROLE[member.role]
        if (role) out.push({ subjectType: 'principal', subjectId: member.principal_id, role, via: 'chat' })
      }
    }
    if (ref.kind === 'space' && UUID.test(ref.id)) {
      const members = await this.query<{ principal_id: string; role: string }>(sqlSpaceMembers(this.prefix), [ref.id, workspaceId])
      for (const member of members) {
        const role = SPACE_ROLE[member.role]
        if (role) out.push({ subjectType: 'principal', subjectId: member.principal_id, role, via: 'chat' })
      }
    }
    return out
  }

  async policy(workspaceId: string, ref: EntityRef): Promise<AclPolicyFact | null> {
    if (!UUID.test(workspaceId)) return null
    const type = aclResourceTypeForKind(ref.kind)
    let fact: AclPolicyFact | null = null
    // A doc's public_token is the node's `defaultPolicy`, used when no row exists.
    if (type) {
      const [row] = await this.query<{ default_subject: string | null; default_role: string | null; policy: Record<string, unknown> | null }>(
        sqlPolicy(this.prefix), [workspaceId, aclStoredResourceTypes(type).join(','), ref.id])
      if (row) {
        const policy = row.policy ?? {}
        fact = {
          defaultSubject: row.default_subject && POLICY_SUBJECTS.has(row.default_subject) ? row.default_subject as AclPolicyFact['defaultSubject'] : null,
          defaultRole: row.default_role && POLICY_ROLES.has(row.default_role) ? row.default_role as AclPolicyFact['defaultRole'] : null,
          linkToken: typeof policy.link_token === 'string' ? policy.link_token : null,
          linkExpiresAt: typeof policy.link_expires_at === 'string' ? policy.link_expires_at : null,
        }
      }
    }
    return fact
  }

  async groups(workspaceId: string, principalId: string): Promise<AclPrincipalGroups> {
    if (!UUID.test(workspaceId) || !UUID.test(principalId)) return { departmentIds: [], channelIds: [] }
    const [departments, channels] = await Promise.all([
      this.query<{ id: string }>(sqlDepartments(this.prefix), [workspaceId, principalId]),
      this.query<{ id: string }>(sqlChannels(this.prefix), [workspaceId, principalId]),
    ])
    return { departmentIds: departments.map(r => r.id), channelIds: channels.map(r => r.id) }
  }
}
