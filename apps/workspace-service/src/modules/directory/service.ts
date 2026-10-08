/**
 * W1-04 (#1501) — Directory service: who may read which part of the
 * directory (TECH-SPEC §3.6, DATA-MODEL §5.9).
 *
 * - The viewer must be an *active* member with an *active* principal
 *   (`invited` / `left` / `removed` members and placeholder / deactivated
 *   principals → FORBIDDEN).
 * - Guests (`principal.kind = 'guest'`) cannot browse the directory: they may
 *   read only their own entry; every listing is FORBIDDEN.
 * - Only active members are listed; a principal outside the workspace is
 *   NOT_FOUND (never invented, never cross-workspace).
 * - Emails are never returned (not selected by the read model).
 */

import {
  IdentityDomainError,
  type AuthenticatedActor,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import type { DirectoryDepartmentEntry, DirectoryEntry, DirectoryPage, DirectoryReadPort } from './repository.ts'

export class DirectoryService {
  constructor(private readonly port: DirectoryReadPort) {}

  private async viewer(actor: AuthenticatedActor | null | undefined, rawWorkspaceId: string): Promise<{ workspaceId: string; entry: DirectoryEntry }> {
    const workspaceId = requireUuid(rawWorkspaceId)
    const verified = requireActor(actor, workspaceId)
    const entry = await this.port.principal(workspaceId, verified.principalId)
    if (!entry || entry.memberStatus !== 'active' || entry.status !== 'active') throw new IdentityDomainError('FORBIDDEN')
    return { workspaceId, entry }
  }

  private async browser(actor: AuthenticatedActor | null | undefined, rawWorkspaceId: string): Promise<string> {
    const { workspaceId, entry } = await this.viewer(actor, rawWorkspaceId)
    if (entry.kind === 'guest') throw new IdentityDomainError('FORBIDDEN')
    return workspaceId
  }

  async members(actor: AuthenticatedActor | null | undefined, workspaceId: string, limit = 100, cursor?: string): Promise<DirectoryPage> {
    const ws = await this.browser(actor, workspaceId)
    if (cursor !== undefined && cursor !== '') requireUuid(cursor)
    return await this.port.members(ws, limit, cursor ?? '')
  }

  async principal(actor: AuthenticatedActor | null | undefined, workspaceId: string, principalId: string): Promise<DirectoryEntry> {
    const target = requireUuid(principalId)
    const { workspaceId: ws, entry } = await this.viewer(actor, workspaceId)
    if (target === entry.principalId) return entry
    if (entry.kind === 'guest') throw new IdentityDomainError('FORBIDDEN')
    const found = await this.port.principal(ws, target)
    if (!found || found.memberStatus !== 'active') throw new IdentityDomainError('NOT_FOUND')
    return found
  }

  async departments(actor: AuthenticatedActor | null | undefined, workspaceId: string): Promise<DirectoryDepartmentEntry[]> {
    return await this.port.departments(await this.browser(actor, workspaceId))
  }

  async departmentMembers(actor: AuthenticatedActor | null | undefined, workspaceId: string, departmentId: string): Promise<string[]> {
    const ws = await this.browser(actor, workspaceId)
    const id = requireUuid(departmentId)
    if (!(await this.port.departments(ws)).some(d => d.departmentId === id)) throw new IdentityDomainError('NOT_FOUND')
    return await this.port.departmentMembers(ws, id)
  }

  async managerChain(actor: AuthenticatedActor | null | undefined, workspaceId: string, principalId: string): Promise<string[]> {
    await this.principal(actor, workspaceId, principalId)
    const { entry } = await this.viewer(actor, workspaceId)
    // Guests may read their own entry but not walk the org chart.
    if (entry.kind === 'guest') throw new IdentityDomainError('FORBIDDEN')
    return await this.port.managerChain(requireUuid(workspaceId), requireUuid(principalId))
  }

  async directReports(actor: AuthenticatedActor | null | undefined, workspaceId: string, principalId: string): Promise<string[]> {
    await this.principal(actor, workspaceId, principalId)
    const { entry } = await this.viewer(actor, workspaceId)
    if (entry.kind === 'guest') throw new IdentityDomainError('FORBIDDEN')
    return await this.port.directReports(requireUuid(workspaceId), requireUuid(principalId))
  }
}
