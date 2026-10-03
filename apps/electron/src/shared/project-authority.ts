import type { CreateSharedProject, RoxCommand, SharedProject, SharedProjectResult } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { SHARED_PROJECT_TEXT_MAX_LENGTH } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'

/** Persisted on the existing local workspace record. Credentials stay encrypted in main. */
export interface ProjectAuthorityConfiguration {
  readonly url: string
  readonly workspaceId: string
  /** Exact service workspace name required by the existing canonical create command. */
  readonly workspaceName?: string
}

/** Main-to-preload only; never exposed through the renderer API or workspace DTO. */
export interface ProjectAuthorityTarget extends ProjectAuthorityConfiguration {
  readonly token: string
}

export type ProjectAuthorityState = 'unconfigured' | 'connecting' | 'ready' | 'denied' | 'unavailable'

export interface SharedProjectProjection {
  readonly kind: 'shared'
  readonly localWorkspaceId: string
  readonly project: SharedProject
}

export const PROJECT_AUTHORITY_NAME_MAX_LENGTH = SHARED_PROJECT_TEXT_MAX_LENGTH
export const PROJECT_AUTHORITY_LOGIN_MAX_LENGTH = 320
export const PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH = 4096
export const PROJECT_AUTHORITY_RESPONSE_MAX_BYTES = 32768
export const PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS = 10000
export const SHARED_PROJECT_PAGE_LIMIT = 100

export const PROJECT_AUTHORITY_IPC = '__project-authority:resolve'
export const PROJECT_AUTHORITY_CREDENTIAL_NAME = 'rox-workspace-authority'
export const PROJECT_AUTHORITY_CONNECT_IPC = '__project-authority:connect'
export const PROJECT_AUTHORITY_DISCONNECT_IPC = '__project-authority:disconnect'
export const PROJECT_AUTHORITY_CONFIGURATION_IPC = '__project-authority:configuration'

export interface ProjectAuthorityLoginInput {
  readonly serviceUrl: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly login: string
  readonly password: string
}
export type ProjectAuthorityMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly status: number } }

export class ProjectAuthorityError extends Error {
  constructor(readonly code: 'AUTH_FAILED' | 'CAPABILITY_UNAVAILABLE' | 'WORKSPACE_MISMATCH' | 'INVALID_PAYLOAD') {
    super(code)
    this.name = 'ProjectAuthorityError'
  }
}

export function requireProjectAuthorityConfiguration(value: unknown): ProjectAuthorityConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  if (!('url' in value) || typeof value.url !== 'string' || !('workspaceId' in value) || typeof value.workspaceId !== 'string'
    || Object.keys(value).some(key => !['url', 'workspaceId', 'workspaceName'].includes(key))
    || ('workspaceName' in value && (typeof value.workspaceName !== 'string' || !value.workspaceName.trim() || value.workspaceName.length > PROJECT_AUTHORITY_NAME_MAX_LENGTH))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.workspaceId)) {
    throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  let url: URL
  try { url = new URL(value.url) } catch { throw new ProjectAuthorityError('INVALID_PAYLOAD') }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (!['ws:', 'wss:'].includes(url.protocol) || (url.protocol === 'ws:' && !loopback)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  return Object.freeze({ url: url.toString(), workspaceId: value.workspaceId,
    ...('workspaceName' in value && typeof value.workspaceName === 'string' ? { workspaceName: value.workspaceName } : {}) })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return value
}

/** A path-free DTO is never coerced into the native folder project's LoadedProject shape. */
export function requireSharedProject(value: unknown): SharedProject {
  const input = record(value)
  const entity = record(input.entity)
  const entityId = text(entity.entityId)
  const workspaceId = text(entity.workspaceId)
  if (!/^project:[0-9a-f-]{36}$/.test(entityId) || !/^[0-9a-f-]{36}$/.test(workspaceId)
    || input.schemaVersion !== 1 || (input.visibility !== 'private' && input.visibility !== 'members')) {
    throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  return Object.freeze({
    entity: Object.freeze({ workspaceId, entityId, revisionId: text(entity.revisionId) }),
    ownerPrincipalId: text(input.ownerPrincipalId), name: text(input.name), visibility: input.visibility,
    schemaVersion: 1, revision: text(input.revision), policyEpoch: text(input.policyEpoch),
    createdAt: text(input.createdAt), updatedAt: text(input.updatedAt),
  })
}

export function requireSharedProjectPage(value: unknown): { items: readonly SharedProject[]; nextCursor?: string } {
  const page = record(value)
  if (!Array.isArray(page.items)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return { items: page.items.map((item: unknown) => requireSharedProject(item)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: text(page.nextCursor) }) }
}

export function createSharedProjectIntent(localWorkspaceId: string, workspaceName: string, name: string,
  visibility: 'private' | 'members'): RoxCommand<CreateSharedProject> {
  if (!name.trim() || !workspaceName.trim() || name.length > PROJECT_AUTHORITY_NAME_MAX_LENGTH
    || workspaceName.length > PROJECT_AUTHORITY_NAME_MAX_LENGTH) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return Object.freeze({ commandId: crypto.randomUUID(), schemaVersion: 2, workspaceId: localWorkspaceId,
    idempotencyKey: crypto.randomUUID(), expectedRevision: '0',
    payload: Object.freeze({ name: name.trim(), workspaceName, visibility }) })
}

export function requireSharedProjectResult(value: unknown, commandId: string): SharedProjectResult {
  const input = record(value)
  const receipt = record(input.receipt)
  const data = requireSharedProject(input.data)
  const entity = record(input.entity)
  if (input.commandId !== commandId || input.status !== 'applied' || input.ok !== true
    || input.executionMode !== 'live' || input.lifecycle !== 'succeeded' || input.verification !== 'receipt_verified'
    || input.entityId !== data.entity.entityId || entity.entityId !== data.entity.entityId || entity.workspaceId !== data.entity.workspaceId
    || receipt.requestId !== commandId || receipt.remoteId !== data.entity.entityId) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return { ok: true, executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified', status: 'applied',
    commandId, requestHash: text(input.requestHash), observedRevision: text(input.observedRevision), entity: data.entity,
    entityId: data.entity.entityId, receiptId: text(input.receiptId), verifiedAt: text(input.verifiedAt), data,
    receipt: { provider: text(receipt.provider), remoteId: data.entity.entityId, requestId: commandId,
      observedRevision: text(receipt.observedRevision), verifiedAt: text(receipt.verifiedAt) } }
}

export function safeProjectAuthorityCode(error: unknown): string {
  const value = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof value === 'string' && ['AUTH_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'WORKSPACE_MISMATCH', 'INVALID_PAYLOAD',
    'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SCHEMA_VERSION_UNSUPPORTED', 'CURSOR_INVALID', 'NOT_FOUND', 'PROVIDER_UNAVAILABLE',
    'CAPABILITY_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(value) ? value : 'PROVIDER_UNAVAILABLE'
}

/** Public, localized descriptions; raw server messages never become product copy. */
export function projectAuthorityErrorMessageKey(code: string): string {
  if (code === 'AUTH_FAILED' || code === 'UNAUTHENTICATED') return 'projectAuthority.errorCredentials'
  if (code === 'FORBIDDEN') return 'projectAuthority.errorMembership'
  if (code === 'WORKSPACE_MISMATCH') return 'projectAuthority.errorScope'
  if (code === 'INVALID_PAYLOAD' || code === 'SCHEMA_VERSION_UNSUPPORTED' || code === 'CURSOR_INVALID') return 'projectAuthority.errorMalformed'
  if (code === 'REQUEST_TIMEOUT') return 'projectAuthority.errorTimeout'
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'CAPABILITY_UNAVAILABLE') return 'projectAuthority.errorUnavailable'
  return 'projectAuthority.errorOther'
}
