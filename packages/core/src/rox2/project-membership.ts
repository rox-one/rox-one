/**
 * Session↔project membership without copying session history (ROX-AUD-003 / #335).
 * `primaryProjectId` is a compatibility pointer, not the sole membership source.
 * Unlink removes the edge only — it never deletes the entity.
 */

import { isAllowedRox2Relation, parseRox2EntityId } from './platform-contract.ts'

export const PROJECT_MEMBERSHIP_SCHEMA_VERSION = 1

export type ProjectLinkRole = 'primary' | 'member' | 'reference'

export type Rox2ProjectMembership = {
  entityId: string
  projectId: string
  linkRole: ProjectLinkRole
}

export type ProjectVisibility = {
  id: string
  archived?: boolean
  readable: boolean
}

export type ProjectMembershipStore = {
  schemaVersion: number
  memberships: Rox2ProjectMembership[]
  /** Compatible singular pointer. Lists and portfolio query memberships, not this map. */
  primaryProjectId: Record<string, string>
}

export type ProjectMembershipParseResult =
  | { ok: true; store: ProjectMembershipStore }
  | { ok: false; code: 'unsupported-version' | 'invalid'; preserved: unknown }

export function emptyProjectMembershipStore(): ProjectMembershipStore {
  return { schemaVersion: PROJECT_MEMBERSHIP_SCHEMA_VERSION, memberships: [], primaryProjectId: {} }
}

export function parseProjectMembershipStore(raw: unknown): ProjectMembershipParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'invalid', preserved: raw }
  }
  const record = raw as Record<string, unknown>
  const version = record.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'invalid', preserved: raw }
  }
  if (version > PROJECT_MEMBERSHIP_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported-version', preserved: raw }
  }
  if (!Array.isArray(record.memberships)) return { ok: false, code: 'invalid', preserved: raw }
  const memberships: Rox2ProjectMembership[] = []
  for (const item of record.memberships) {
    if (!item || typeof item !== 'object') return { ok: false, code: 'invalid', preserved: raw }
    const row = item as Record<string, unknown>
    if (typeof row.entityId !== 'string' || !row.entityId) return { ok: false, code: 'invalid', preserved: raw }
    if (typeof row.projectId !== 'string' || !row.projectId) return { ok: false, code: 'invalid', preserved: raw }
    if (row.linkRole !== 'primary' && row.linkRole !== 'member' && row.linkRole !== 'reference') {
      return { ok: false, code: 'invalid', preserved: raw }
    }
    try {
      parseRox2EntityId(row.entityId)
    } catch {
      return { ok: false, code: 'invalid', preserved: raw }
    }
    memberships.push({ entityId: row.entityId, projectId: row.projectId, linkRole: row.linkRole })
  }
  const primaryProjectId: Record<string, string> = {}
  if (record.primaryProjectId && typeof record.primaryProjectId === 'object' && !Array.isArray(record.primaryProjectId)) {
    for (const [entityId, projectId] of Object.entries(record.primaryProjectId as Record<string, unknown>)) {
      if (typeof projectId === 'string' && projectId) primaryProjectId[entityId] = projectId
    }
  }
  return { ok: true, store: { schemaVersion: version, memberships, primaryProjectId } }
}

function cloneStore(store: ProjectMembershipStore): ProjectMembershipStore {
  return {
    schemaVersion: store.schemaVersion,
    memberships: store.memberships.map((row) => ({ ...row })),
    primaryProjectId: { ...store.primaryProjectId },
  }
}

function assertMemberOf(entityId: string): void {
  const { kind } = parseRox2EntityId(entityId)
  if (!isAllowedRox2Relation('member-of', kind, 'project')) {
    throw new Error(`member-of is not allowed from ${kind} to project`)
  }
}

export function linkEntityToProject(
  store: ProjectMembershipStore,
  entityId: string,
  projectId: string,
  linkRole: ProjectLinkRole = 'member',
): ProjectMembershipStore {
  if (!projectId) throw new Error('project id is empty')
  assertMemberOf(entityId)
  const next = cloneStore(store)
  const existing = next.memberships.find((row) => row.entityId === entityId && row.projectId === projectId)
  if (existing) {
    existing.linkRole = linkRole
  } else {
    next.memberships.push({ entityId, projectId, linkRole })
  }
  if (linkRole === 'primary' || !next.primaryProjectId[entityId]) {
    next.primaryProjectId[entityId] = projectId
  }
  if (linkRole === 'primary') {
    for (const row of next.memberships) {
      if (row.entityId === entityId && row.projectId !== projectId && row.linkRole === 'primary') {
        row.linkRole = 'member'
      }
    }
  }
  return next
}

/** Removes the membership edge. Session/note/task history is left intact. */
export function unlinkEntityFromProject(
  store: ProjectMembershipStore,
  entityId: string,
  projectId: string,
): ProjectMembershipStore {
  const next = cloneStore(store)
  next.memberships = next.memberships.filter(
    (row) => !(row.entityId === entityId && row.projectId === projectId),
  )
  if (next.primaryProjectId[entityId] === projectId) {
    const fallback = next.memberships.find((row) => row.entityId === entityId)
    if (fallback) next.primaryProjectId[entityId] = fallback.projectId
    else delete next.primaryProjectId[entityId]
  }
  return next
}

function isVisible(project: ProjectVisibility | undefined): project is ProjectVisibility {
  return Boolean(project?.readable && !project.archived)
}

export function entityIdsForProject(
  store: ProjectMembershipStore,
  projectId: string,
  projects: readonly ProjectVisibility[],
): string[] {
  const vis = projects.find((project) => project.id === projectId)
  if (!isVisible(vis)) return []
  const ids = new Set<string>()
  for (const row of store.memberships) {
    if (row.projectId === projectId) ids.add(row.entityId)
  }
  return [...ids]
}

/** Portfolio count never double-counts a session that sits in several projects. */
export function portfolioEntityIds(
  store: ProjectMembershipStore,
  projects: readonly ProjectVisibility[],
): string[] {
  const readable = new Set(projects.filter(isVisible).map((project) => project.id))
  const ids = new Set<string>()
  for (const row of store.memberships) {
    if (readable.has(row.projectId)) ids.add(row.entityId)
  }
  return [...ids]
}

/** Related projects on a shared session: closed/unreadable projects stay hidden. */
export function visibleProjectsForEntity(
  store: ProjectMembershipStore,
  entityId: string,
  projects: readonly ProjectVisibility[],
): string[] {
  const readable = new Map(projects.filter(isVisible).map((project) => [project.id, project]))
  const ids: string[] = []
  for (const row of store.memberships) {
    if (row.entityId !== entityId) continue
    if (readable.has(row.projectId)) ids.push(row.projectId)
  }
  return ids
}

export function compatiblePrimaryProjectId(store: ProjectMembershipStore, entityId: string): string | undefined {
  return store.primaryProjectId[entityId]
}
