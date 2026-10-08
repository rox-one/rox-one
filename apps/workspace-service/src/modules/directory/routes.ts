/**
 * W1-04 (#1501) — Directory HTTP routes (module route table).
 * STUB(#1500): mounted by the composition root once the W1-03 route table
 * lands in `http.ts` (UNDONE).
 */

import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { WorkspaceModuleRoute, WorkspaceRouteContext } from '../acl/routes.ts'
import type { DirectoryService } from './service.ts'

const BASE = '/v1/workspaces/:workspaceId/directory'

function noQuery(query: URLSearchParams): void {
  if ([...query.keys()].length) throw new IdentityDomainError('INVALID_PAYLOAD')
}

function pageQuery(query: URLSearchParams): { limit: number; cursor?: string } {
  const keys = [...query.keys()]
  if (keys.some(k => k !== 'limit' && k !== 'cursor') || new Set(keys).size !== keys.length) throw new IdentityDomainError('INVALID_PAYLOAD')
  const rawLimit = query.get('limit')
  const limit = rawLimit === null ? 100 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new IdentityDomainError('INVALID_PAYLOAD')
  const cursor = query.get('cursor') ?? undefined
  return cursor === undefined ? { limit } : { limit, cursor }
}

function param(context: WorkspaceRouteContext, name: string): string {
  const value = context.params[name]
  if (value === undefined) throw new IdentityDomainError('INVALID_PAYLOAD')
  return value
}

export function createDirectoryRoutes(directory: DirectoryService): WorkspaceModuleRoute[] {
  return [
    {
      method: 'GET', path: `${BASE}/members`,
      async handle(c) {
        const { limit, cursor } = pageQuery(c.query)
        return await directory.members(c.actor, c.workspaceId, limit, cursor)
      },
    },
    {
      method: 'GET', path: `${BASE}/principals/:principalId`,
      async handle(c) { noQuery(c.query); return { principal: await directory.principal(c.actor, c.workspaceId, param(c, 'principalId')) } },
    },
    {
      method: 'GET', path: `${BASE}/principals/:principalId/manager-chain`,
      async handle(c) { noQuery(c.query); return { principalIds: await directory.managerChain(c.actor, c.workspaceId, param(c, 'principalId')) } },
    },
    {
      method: 'GET', path: `${BASE}/principals/:principalId/reports`,
      async handle(c) { noQuery(c.query); return { principalIds: await directory.directReports(c.actor, c.workspaceId, param(c, 'principalId')) } },
    },
    {
      method: 'GET', path: `${BASE}/departments`,
      async handle(c) { noQuery(c.query); return { departments: await directory.departments(c.actor, c.workspaceId) } },
    },
    {
      method: 'GET', path: `${BASE}/departments/:departmentId/members`,
      async handle(c) { noQuery(c.query); return { principalIds: await directory.departmentMembers(c.actor, c.workspaceId, param(c, 'departmentId')) } },
    },
  ]
}
