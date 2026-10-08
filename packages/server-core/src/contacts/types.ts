/**
 * W1-04 (#1501) — Directory read model and offline contact cards.
 *
 * Shapes mirror DATA-MODEL §5.9 / DDL `502-directory.sql` (principal.kind,
 * user_profile.manager_id / title / person_type, department,
 * department_member, contact_card) so the local cache and the server
 * directory (`apps/workspace-service/src/modules/directory`) agree.
 */

export type DirectoryPrincipalKind = 'human' | 'bot' | 'guest' | 'service'

export interface DirectoryPrincipal {
  principalId: string
  kind: DirectoryPrincipalKind
  displayName: string
  username?: string
  email?: string
  title?: string | null
  managerId?: string | null
  departmentIds: readonly string[]
  /** Where the record came from — never invented locally (MIG-08). */
  source: 'server' | 'orgs'
}

export interface DirectoryDepartment {
  departmentId: string
  name: string
  parentId?: string | null
}

/** Server directory snapshot (workspace-service `modules/directory`). */
export interface DirectorySnapshot {
  workspaceId: string
  principals: readonly DirectoryPrincipal[]
  departments: readonly DirectoryDepartment[]
  fetchedAt?: string
}

export interface ContactTouchRef {
  kind: string
  id: string
}

/** Local contact card (DDL `contact_card`, ids are UUIDs). */
export interface ContactCard {
  contactCardId: string
  workspaceId: string
  ownerScope: 'workspace' | 'personal'
  ownerId: string | null
  kind: 'person' | 'company'
  principalId: string | null
  companyCardId: string | null
  displayName: string
  emails: string[]
  phones: string[]
  title: string | null
  notes: string | null
  fields: Record<string, unknown>
  touches: ContactTouchRef[]
  revision: number
  createdAt: string
  updatedAt: string
}
