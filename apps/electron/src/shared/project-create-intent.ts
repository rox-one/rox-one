import type { RoxCommand, CreateSharedProject, SharedProjectResult } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { PROJECT_AUTHORITY_NAME_MAX_LENGTH, ProjectAuthorityError } from './project-authority'

export const PROJECT_CREATE_INTENT_IPC = '__project-create-intent'
export const PROJECT_CREATE_ID_MAX_LENGTH = 256
export const PROJECT_CREATE_ISSUER_MAX_LENGTH = 2048
export interface VerifiedProjectCreateScope {
  readonly issuer: string
  readonly principalId: string
  readonly sessionId: string
  readonly deviceId: string
  readonly workspaceId: string
  readonly expiresAt: number
}
export type ProjectCreateIntentView =
  | { readonly state: 'none'; readonly eligible: boolean }
  | { readonly state: 'blocked'; readonly eligible: false; readonly code: string }
  | { readonly state: 'queued' | 'uncertain'; readonly eligible: true; readonly command: RoxCommand<CreateSharedProject> }
export type ProjectCreateAttempt = ProjectCreateIntentView | { readonly state: 'applied'; readonly result: SharedProjectResult }
export type ProjectCreateIntentAction = 'get' | 'queue' | 'retry' | 'cancel'

function object(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  const record = Object.fromEntries(Object.entries(value))
  if (Object.keys(record).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(record, key))) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return record
}
export function requireVerifiedProjectCreateScope(value: unknown): VerifiedProjectCreateScope {
  const record = object(value, ['issuer', 'principalId', 'sessionId', 'deviceId', 'workspaceId', 'expiresAt'])
  const uuid = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
    return value
  }
  if (typeof record.issuer !== 'string' || !record.issuer.trim() || record.issuer.length > PROJECT_CREATE_ISSUER_MAX_LENGTH
    || typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return Object.freeze({ issuer: record.issuer, principalId: uuid(record.principalId), sessionId: uuid(record.sessionId),
    deviceId: uuid(record.deviceId), workspaceId: uuid(record.workspaceId), expiresAt: record.expiresAt })
}
export function requireProjectCreateCommand(value: unknown): RoxCommand<CreateSharedProject> {
  const record = object(value, ['commandId', 'schemaVersion', 'workspaceId', 'idempotencyKey', 'expectedRevision', 'payload'],
    ['commandId', 'schemaVersion', 'workspaceId', 'idempotencyKey', 'payload'])
  const payload = object(record.payload, ['name', 'workspaceName', 'visibility'])
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new ProjectAuthorityError('INVALID_PAYLOAD')
    return value
  }
  if (record.schemaVersion !== 2 || (record.expectedRevision !== undefined && record.expectedRevision !== '0')
    || (payload.visibility !== 'private' && payload.visibility !== 'members')
    || typeof record.workspaceId !== 'string' || !/^[0-9a-f-]{36}$/.test(record.workspaceId)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return Object.freeze({ commandId: text(record.commandId, PROJECT_CREATE_ID_MAX_LENGTH), schemaVersion: 2,
    workspaceId: record.workspaceId, idempotencyKey: text(record.idempotencyKey, PROJECT_CREATE_ID_MAX_LENGTH),
    ...(record.expectedRevision === undefined ? {} : { expectedRevision: '0' }),
    payload: Object.freeze({ name: text(payload.name, PROJECT_AUTHORITY_NAME_MAX_LENGTH), workspaceName: text(payload.workspaceName, PROJECT_AUTHORITY_NAME_MAX_LENGTH), visibility: payload.visibility }) })
}
