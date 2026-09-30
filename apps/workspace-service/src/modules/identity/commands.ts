import { createHash } from 'node:crypto'
import {
  IdentityDomainError,
  SHARED_PROJECT_TEXT_MAX_LENGTH,
  type AuthenticatedActor,
  type CreateSharedProject,
  type IdentityRepositoryPort,
  type RoxCommand,
  type SharedProjectAuthority,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new IdentityDomainError('INVALID_PAYLOAD')
  return value
}

function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new IdentityDomainError('INVALID_PAYLOAD')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(result, key))) throw new IdentityDomainError('INVALID_PAYLOAD')
  return result
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new IdentityDomainError('INVALID_PAYLOAD')
  return value
}

export function requireActor(actor: AuthenticatedActor | null | undefined, workspaceId?: string): AuthenticatedActor {
  if (!actor || !Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now()
    || !actor.sessionId || !actor.deviceId || !UUID.test(actor.principalId)
    || !Array.isArray(actor.authenticatedWorkspaceIds)) throw new IdentityDomainError('UNAUTHENTICATED')
  if (workspaceId !== undefined && !actor.authenticatedWorkspaceIds.includes(workspaceId)) {
    throw new IdentityDomainError('FORBIDDEN')
  }
  return actor
}

export function parseCreateSharedProject(body: unknown): RoxCommand<CreateSharedProject> {
  const command = record(body, ['commandId', 'schemaVersion', 'workspaceId', 'idempotencyKey', 'expectedRevision', 'payload'],
    ['commandId', 'schemaVersion', 'workspaceId', 'idempotencyKey', 'payload'])
  if (command.schemaVersion !== 2) throw new IdentityDomainError('SCHEMA_VERSION_UNSUPPORTED')
  const payload = record(command.payload, ['name', 'workspaceName', 'visibility'], ['name', 'workspaceName', 'visibility'])
  if (payload.visibility !== 'private' && payload.visibility !== 'members') throw new IdentityDomainError('INVALID_PAYLOAD')
  if (command.expectedRevision !== undefined && command.expectedRevision !== '0') throw new IdentityDomainError('REVISION_CONFLICT')
  return {
    commandId: text(command.commandId, 256), schemaVersion: 2,
    workspaceId: requireUuid(command.workspaceId), idempotencyKey: text(command.idempotencyKey, 256),
    ...(command.expectedRevision === undefined ? {} : { expectedRevision: '0' }),
    payload: { name: text(payload.name, SHARED_PROJECT_TEXT_MAX_LENGTH), workspaceName: text(payload.workspaceName, SHARED_PROJECT_TEXT_MAX_LENGTH), visibility: payload.visibility },
  }
}

/** Explicit field order is the immutable semantic hash; commandId is trace metadata, not content. */
export function createProjectRequestHash(command: RoxCommand<CreateSharedProject>): string {
  return createHash('sha256').update(JSON.stringify({
    action: 'project.createShared', schemaVersion: command.schemaVersion, workspaceId: command.workspaceId,
    expectedRevision: command.expectedRevision ?? null,
    payload: { name: command.payload.name, workspaceName: command.payload.workspaceName, visibility: command.payload.visibility },
  })).digest('hex')
}

function scope(actor: AuthenticatedActor | null | undefined, workspaceId: string): AuthenticatedActor {
  requireActor(actor)
  return requireActor(actor, requireUuid(workspaceId))
}

function page(body: unknown): { limit: number; cursor?: string } {
  const input = record(body, ['limit', 'cursor'], [])
  const limit = input.limit ?? 50
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new IdentityDomainError('INVALID_PAYLOAD')
  return { limit, ...(input.cursor === undefined ? {} : { cursor: requireUuid(input.cursor) }) }
}

/** Both native RPC and HTTP call this gateway; execution allow-all is deliberately not an ACL input. */
export class IdentityCommands implements SharedProjectAuthority {
  constructor(private readonly repository: IdentityRepositoryPort) {}

  async createSharedProject(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown) {
    const authenticated = scope(actor, routeWorkspaceId)
    const command = parseCreateSharedProject(body)
    if (command.workspaceId !== routeWorkspaceId) throw new IdentityDomainError('WORKSPACE_MISMATCH')
    return this.repository.createSharedProject(authenticated, command, createProjectRequestHash(command))
  }

  async getProject(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown) {
    const authenticated = scope(actor, routeWorkspaceId)
    const input = record(body, ['entityId'], ['entityId'])
    if (typeof input.entityId !== 'string' || !input.entityId.startsWith('project:')) throw new IdentityDomainError('INVALID_PAYLOAD')
    return this.repository.getProject(authenticated, routeWorkspaceId, requireUuid(input.entityId.slice('project:'.length)))
  }

  async listProjects(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown) {
    const authenticated = scope(actor, routeWorkspaceId)
    const input = page(body)
    return this.repository.listProjects(authenticated, routeWorkspaceId, input.limit, input.cursor)
  }

  async replayEvents(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown) {
    const authenticated = scope(actor, routeWorkspaceId)
    const input = page(body)
    return this.repository.replayEvents(authenticated, routeWorkspaceId, input.limit, input.cursor)
  }
}
