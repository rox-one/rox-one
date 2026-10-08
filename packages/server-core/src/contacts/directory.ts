/**
 * W1-04 (#1501) — Local directory read model.
 *
 * Members come only from the server directory snapshot or from `orgs.json`
 * memberships (MIG-08); the model never invents people. Server records win;
 * org members fill in only principals the server does not know.
 *
 * Guests cannot browse the directory: `listForViewer` returns only the guest
 * themself.
 */

import type { OrganizationWithMembers } from '@rox/shared/orgs'
import type { DirectoryDepartment, DirectoryPrincipal, DirectorySnapshot } from './types.ts'

export const MAX_MANAGER_CHAIN = 32

export interface DirectoryViewer {
  principalId: string
  kind?: DirectoryPrincipal['kind']
}

export interface DirectoryReadModel {
  readonly workspaceId: string
  principal(principalId: string): DirectoryPrincipal | null
  /** All known principals (server + orgs.json), stable order by display name. */
  members(): DirectoryPrincipal[]
  /** Directory as visible to `viewer` — guests see only themselves. */
  listForViewer(viewer: DirectoryViewer): DirectoryPrincipal[]
  department(departmentId: string): DirectoryDepartment | null
  departments(): DirectoryDepartment[]
  departmentMembers(departmentId: string): DirectoryPrincipal[]
  /** Manager chain upwards (nearest first), cycle-safe and bounded. */
  managerChain(principalId: string): DirectoryPrincipal[]
  directReports(principalId: string): DirectoryPrincipal[]
}

export interface BuildDirectoryInput {
  workspaceId: string
  server?: DirectorySnapshot | null
  /** Organisations from `orgs.json` (already loaded by the caller). */
  orgs?: readonly OrganizationWithMembers[]
}

function orgPrincipal(member: OrganizationWithMembers['members'][number]): DirectoryPrincipal | null {
  const userId = member.userId?.trim()
  if (!userId) return null
  const displayName = member.displayLabel?.trim() || member.username?.trim() || member.email?.trim() || userId
  return {
    principalId: userId,
    kind: 'human',
    displayName,
    ...(member.username ? { username: member.username } : {}),
    ...(member.email ? { email: member.email } : {}),
    managerId: null,
    departmentIds: [],
    source: 'orgs',
  }
}

export function buildLocalDirectory(input: BuildDirectoryInput): DirectoryReadModel {
  const byId = new Map<string, DirectoryPrincipal>()
  const departments = new Map<string, DirectoryDepartment>()
  const server = input.server && input.server.workspaceId === input.workspaceId ? input.server : null
  for (const principal of server?.principals ?? []) {
    if (principal.principalId) byId.set(principal.principalId, { ...principal, source: 'server' })
  }
  for (const department of server?.departments ?? []) departments.set(department.departmentId, department)
  for (const org of input.orgs ?? []) {
    for (const member of org.members ?? []) {
      const principal = orgPrincipal(member)
      if (principal && !byId.has(principal.principalId)) byId.set(principal.principalId, principal)
    }
  }

  const sorted = (): DirectoryPrincipal[] =>
    [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru') || a.principalId.localeCompare(b.principalId))

  const model: DirectoryReadModel = {
    workspaceId: input.workspaceId,
    principal: id => byId.get(id) ?? null,
    members: sorted,
    listForViewer(viewer) {
      const self = byId.get(viewer.principalId)
      const kind = viewer.kind ?? self?.kind
      if (kind === 'guest') return self ? [self] : []
      return sorted()
    },
    department: id => departments.get(id) ?? null,
    departments: () => [...departments.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    departmentMembers: id => sorted().filter(p => p.departmentIds.includes(id)),
    managerChain(principalId) {
      const chain: DirectoryPrincipal[] = []
      const seen = new Set<string>([principalId])
      let current = byId.get(principalId)?.managerId ?? null
      while (current && !seen.has(current) && chain.length < MAX_MANAGER_CHAIN) {
        seen.add(current)
        const manager = byId.get(current)
        if (!manager) break
        chain.push(manager)
        current = manager.managerId ?? null
      }
      return chain
    },
    directReports: id => sorted().filter(p => p.managerId === id),
  }
  return model
}
