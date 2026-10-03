import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { CredentialId, StoredCredential } from '@rox/shared/credentials'
import type { AuthorityJournalPorts } from './project-authority-journal'
import { WsRpcClient } from '../transport/client'
import { peerTrustOptionsForRemote } from '../shared/remote-tls-client-options'
import { DOMAIN_PROJECT_RPC } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { RoxCommand, CreateSharedProject } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import {
  PROJECT_AUTHORITY_CREDENTIAL_NAME, PROJECT_AUTHORITY_RESPONSE_MAX_BYTES, PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS,
  ProjectAuthorityError, requireProjectAuthorityConfiguration, requireSharedProjectResult, safeProjectAuthorityCode,
  type ProjectAuthorityConfiguration, type ProjectAuthorityTarget,
} from '../shared/project-authority'
import { requireProjectCreateCommand, requireVerifiedProjectCreateScope,
  type VerifiedProjectCreateScope, type ProjectCreateIntentView, type ProjectCreateAttempt } from '../shared/project-create-intent'

export const PROJECT_CREATE_INTENT_CREDENTIAL_NAME = PROJECT_AUTHORITY_CREDENTIAL_NAME + '-pending-project-create'
export const PROJECT_CREATE_BINDING_CREDENTIAL_NAME = PROJECT_AUTHORITY_CREDENTIAL_NAME + '-verified-create-scope'
export const MAX_PROJECT_CREATE_RECORD_BYTES = 262144
const INTENT_TOKEN_TYPE = 'ROX_PROJECT_CREATE_INTENT_V1'
const BINDING_TOKEN_TYPE = 'ROX_PROJECT_CREATE_BINDING_V1'
const DOMAIN_INTENT_TOKEN_TYPE = 'ROX_DOMAIN_INTENT_V2'
import { DOMAIN_LICENSE_RPC } from '../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import type { AuditReleaseLicense } from '../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import { LICENSE_PAGE_LIMIT, requireLicenseCommand, requireLicenseAuditResult, requireLicenseAuditReadback,
  requireLicenseAuditEventReplay } from '../shared/license-evidence'
import type { LicenseAuditIntentView, LicenseAuditAttempt } from '../shared/license-audit-intent'
interface LicensePendingIntent {
  readonly version: 2
  readonly operation: 'audit.releaseLicense'
  readonly binding: Binding
  readonly command: RoxCommand<AuditReleaseLicense>
  readonly state: 'queued' | 'uncertain' | 'blocked'
  readonly code: string | null
}
interface Binding {
  readonly version: 1
  readonly tokenDigest: string
  readonly configuration: ProjectAuthorityConfiguration
  readonly scope: VerifiedProjectCreateScope
}
interface PendingIntent {
  readonly version: 1
  readonly binding: Binding
  readonly command: RoxCommand<CreateSharedProject>
  readonly state: 'queued' | 'uncertain' | 'blocked'
  readonly code: string | null
}
function credentialId(localWorkspaceId: string, name: string): CredentialId {
  if (!/^[0-9a-f-]{36}$/.test(localWorkspaceId)) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
  return { type: 'service_oauth', workspaceId: localWorkspaceId, name }
}
function digest(token: string): string { return createHash('sha256').update(token).digest('hex') }
function configuration(target: ProjectAuthorityTarget): ProjectAuthorityConfiguration {
  return requireProjectAuthorityConfiguration({ url: target.url, workspaceId: target.workspaceId,
    ...(target.workspaceName === undefined ? {} : { workspaceName: target.workspaceName }) })
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  const record = Object.fromEntries(Object.entries(value))
  if (Object.keys(record).sort().join(',') !== fields.sort().join(',')) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return record
}
function decode(credential: StoredCredential, tokenType: string): unknown {
  if (credential.tokenType !== tokenType || Buffer.byteLength(credential.value) > MAX_PROJECT_CREATE_RECORD_BYTES) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  try { return JSON.parse(credential.value) } catch { throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE') }
}
function requireBinding(value: unknown): Binding {
  const record = object(value, ['version', 'tokenDigest', 'configuration', 'scope'])
  if (record.version !== 1 || typeof record.tokenDigest !== 'string' || !/^[0-9a-f]{64}$/.test(record.tokenDigest)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  const metadata = requireProjectAuthorityConfiguration(record.configuration)
  const scope = requireVerifiedProjectCreateScope(record.scope)
  if (metadata.workspaceId !== scope.workspaceId) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return { version: 1, tokenDigest: record.tokenDigest, configuration: metadata, scope }
}
function requireIntent(value: unknown): PendingIntent | LicensePendingIntent {
  if (value && typeof value === 'object' && 'version' in value && value.version === 2) {
    const record = object(value, ['version', 'operation', 'binding', 'command', 'state', 'code'])
    if (record.operation !== 'audit.releaseLicense' || !['queued', 'uncertain', 'blocked'].includes(String(record.state))
      || (record.state === 'blocked' ? typeof record.code !== 'string' || safeProjectAuthorityCode({ code: record.code }) !== record.code : record.code !== null)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    const binding = requireBinding(record.binding)
    const command = requireLicenseCommand(record.command)
    if (command.workspaceId !== binding.scope.workspaceId) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    if (record.state !== 'queued' && record.state !== 'uncertain' && record.state !== 'blocked') throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    return { version: 2, operation: 'audit.releaseLicense', binding, command, state: record.state, code: typeof record.code === 'string' ? record.code : null }
  }
  const record = object(value, ['version', 'binding', 'command', 'state', 'code'])
  if (record.version !== 1 || (record.state !== 'queued' && record.state !== 'uncertain' && record.state !== 'blocked')) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  if (record.state === 'blocked' ? typeof record.code !== 'string' || safeProjectAuthorityCode({ code: record.code }) !== record.code : record.code !== null) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  const binding = requireBinding(record.binding)
  const command = requireProjectCreateCommand(record.command)
  if (command.workspaceId !== binding.scope.workspaceId || command.payload.workspaceName !== binding.configuration.workspaceName) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return { version: 1, binding, command, state: record.state, code: typeof record.code === 'string' ? record.code : null }
}
function sameBinding(a: Binding, b: Binding): boolean { return isDeepStrictEqual(a, b) }
function matchesTarget(binding: Binding, target: ProjectAuthorityTarget): boolean {
  return binding.tokenDigest === digest(target.token) && isDeepStrictEqual(binding.configuration, configuration(target))
    && binding.scope.expiresAt > Date.now()
}

/** Exactly one typed domain intent in the existing encrypted backend; never replaces unknown bytes.
 * Scope is a token-fingerprint-bound proof from the authenticated server, not an identity authority.
 */
export class ProjectCreateIntentStore {
  constructor(private readonly credentials: AuthorityJournalPorts['credentials']) {}
  private async binding(localId: string): Promise<Binding | null> {
    const raw = await this.credentials.get(credentialId(localId, PROJECT_CREATE_BINDING_CREDENTIAL_NAME))
    return raw === null ? null : requireBinding(decode(raw, BINDING_TOKEN_TYPE))
  }
  private async pending(localId: string): Promise<PendingIntent | LicensePendingIntent | null> {
    const raw = await this.credentials.get(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
    if (raw === null) return null
    const parsed = requireIntent(decode(raw, raw.tokenType === DOMAIN_INTENT_TOKEN_TYPE ? DOMAIN_INTENT_TOKEN_TYPE : INTENT_TOKEN_TYPE))
    if ((raw.tokenType === DOMAIN_INTENT_TOKEN_TYPE) !== ('operation' in parsed)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    return parsed
  }
  async hasPending(localId: string): Promise<boolean> {
    await this.binding(localId)
    return await this.pending(localId) !== null
  }
  async bind(localId: string, target: ProjectAuthorityTarget, scope: VerifiedProjectCreateScope): Promise<void> {
    await this.binding(localId); await this.pending(localId) // Preserve unrecognized formats; no opportunistic overwrite.
    if (scope.workspaceId !== target.workspaceId || scope.expiresAt <= Date.now()) throw new ProjectAuthorityError('AUTH_FAILED')
    const binding: Binding = { version: 1, tokenDigest: digest(target.token), configuration: configuration(target), scope }
    await this.credentials.set(credentialId(localId, PROJECT_CREATE_BINDING_CREDENTIAL_NAME), { tokenType: BINDING_TOKEN_TYPE, value: JSON.stringify(binding) })
  }
  async view(localId: string, target: ProjectAuthorityTarget): Promise<ProjectCreateIntentView> {
    const binding = await this.binding(localId)
    const pending = await this.pending(localId)
    if (!binding || !matchesTarget(binding, target)) return pending ? { state: 'blocked', eligible: false, code: 'AUTH_FAILED' } : { state: 'none', eligible: false }
    if (pending && !sameBinding(binding, pending.binding)) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
    if (pending && 'operation' in pending) return { state: 'blocked', eligible: false, code: 'IDEMPOTENCY_CONFLICT' }
    if (pending?.state === 'blocked') return { state: 'blocked', eligible: false, code: pending.code ?? 'AUTH_FAILED' }
    return pending ? { state: pending.state, eligible: true, command: pending.command } : { state: 'none', eligible: true }
  }
  async queue(localId: string, target: ProjectAuthorityTarget, input: unknown): Promise<ProjectCreateIntentView> {
    const local = requireProjectCreateCommand(input)
    if (local.workspaceId !== localId || local.payload.workspaceName !== target.workspaceName) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    const command = requireProjectCreateCommand({ ...local, workspaceId: target.workspaceId })
    const binding = await this.binding(localId)
    if (!binding || !matchesTarget(binding, target)) throw new ProjectAuthorityError('AUTH_FAILED')
    const pending = await this.pending(localId)
    if (pending) {
      if ('operation' in pending) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT' })
      if (!sameBinding(binding, pending.binding)) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      if (pending.state === 'blocked') throw new ProjectAuthorityError('AUTH_FAILED')
      if (!isDeepStrictEqual(command, pending.command)) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT' })
      return { state: pending.state, eligible: true, command: pending.command }
    }
    await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), {
      tokenType: INTENT_TOKEN_TYPE, value: JSON.stringify({ version: 1, binding, command, state: 'queued', code: null }),
    })
    return { state: 'queued', eligible: true, command }
  }
  async retry(localId: string, target: ProjectAuthorityTarget, isCurrent: () => boolean): Promise<ProjectCreateAttempt> {
    const view = await this.view(localId, target)
    if (view.state !== 'queued' && view.state !== 'uncertain') return view
    const pending = await this.pending(localId)
    if (!pending || 'operation' in pending) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    // Re-authenticate with the server before any outbound command; cached scope never authorizes a side effect.
    try {
      const live = await readVerifiedProjectCreateScope(target)
      if (!isDeepStrictEqual(live, pending.binding.scope) || !isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), {
        tokenType: INTENT_TOKEN_TYPE, value: JSON.stringify({ ...pending, state: 'uncertain', code: null }),
      })
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      const result = requireSharedProjectResult(await sendProjectCreate(target, pending.command), pending.command.commandId)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      if (result.data.entity.workspaceId !== target.workspaceId || result.data.name !== pending.command.payload.name
        || result.data.ownerPrincipalId !== live.principalId || result.data.visibility !== pending.command.payload.visibility) throw new ProjectAuthorityError('INVALID_PAYLOAD')
      // The existing WS server already revalidated outbound policy; check session/membership again across this I/O.
      const outbound = await readVerifiedProjectCreateScope(target)
      if (!isDeepStrictEqual(outbound, live) || !isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await this.credentials.delete(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      return { state: 'applied', result }
    } catch (error) {
      const code = safeProjectAuthorityCode(error)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      if (['AUTH_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'WORKSPACE_MISMATCH', 'INVALID_PAYLOAD', 'IDEMPOTENCY_CONFLICT', 'REVISION_CONFLICT', 'SCHEMA_VERSION_UNSUPPORTED'].includes(code)) {
        await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), {
          tokenType: INTENT_TOKEN_TYPE, value: JSON.stringify({ ...pending, state: 'blocked', code }),
        })
        return { state: 'blocked', eligible: false, code }
      }
      // Any lost/rejected response remains recoverable with the exact original command and key.
      await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), {
        tokenType: INTENT_TOKEN_TYPE, value: JSON.stringify({ ...pending, state: 'uncertain', code: null }),
      })
      return { state: 'uncertain', eligible: true, command: pending.command }
    }
  }
  async licenseView(localId: string, target: ProjectAuthorityTarget): Promise<LicenseAuditIntentView> {
    const binding = await this.binding(localId), pending = await this.pending(localId)
    if (!binding || !matchesTarget(binding, target)) return pending ? { state: 'blocked', eligible: false, code: 'AUTH_FAILED' } : { state: 'none', eligible: false }
    if (pending && !('operation' in pending)) return { state: 'blocked', eligible: false, code: 'IDEMPOTENCY_CONFLICT', pendingOperation: 'project.createShared' }
    if (pending && !sameBinding(binding, pending.binding)) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
    if (pending?.state === 'blocked') return { state: 'blocked', eligible: false, code: pending.code ?? 'AUTH_FAILED' }
    return pending ? { state: pending.state, eligible: true, command: pending.command } : { state: 'none', eligible: true }
  }
  async queueLicense(localId: string, target: ProjectAuthorityTarget, input: unknown): Promise<LicenseAuditIntentView> {
    const local = requireLicenseCommand(input)
    if (local.workspaceId !== localId) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    const command = requireLicenseCommand({ ...local, workspaceId: target.workspaceId })
    const binding = await this.binding(localId)
    if (!binding || !matchesTarget(binding, target)) throw new ProjectAuthorityError('AUTH_FAILED')
    const pending = await this.pending(localId)
    if (pending) {
      if (!('operation' in pending) || !sameBinding(binding, pending.binding) || !isDeepStrictEqual(command, pending.command)) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT' })
      if (pending.state === 'blocked') return { state: 'blocked', eligible: false, code: pending.code ?? 'AUTH_FAILED' }
      return { state: pending.state, eligible: true, command: pending.command }
    }
    await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), { tokenType: DOMAIN_INTENT_TOKEN_TYPE,
      value: JSON.stringify({ version: 2, operation: 'audit.releaseLicense', binding, command, state: 'queued', code: null }) })
    return { state: 'queued', eligible: true, command }
  }
  async retryLicense(localId: string, target: ProjectAuthorityTarget, isCurrent: () => boolean): Promise<LicenseAuditAttempt> {
    const view = await this.licenseView(localId, target)
    if (view.state !== 'queued' && view.state !== 'uncertain') return view
    const pending = await this.pending(localId)
    if (!pending || !('operation' in pending)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    const persist = async (state: 'uncertain' | 'blocked', code: string | null) => {
      await this.credentials.set(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME), { tokenType: DOMAIN_INTENT_TOKEN_TYPE,
        value: JSON.stringify({ ...pending, state, code }) })
    }
    try {
      const live = await readVerifiedProjectCreateScope(target)
      if (!isDeepStrictEqual(live, pending.binding.scope) || !isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await persist('uncertain', null)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      const received = await sendProjectCreate(target, pending.command, DOMAIN_LICENSE_RPC.AUDIT)
      const result = await requireLicenseAuditResult(received, pending.command, target.workspaceId)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      const event = await requireLicenseAuditEventReplay(result, live.principalId, cursor => sendProjectCreate(target,
        { entityId: result.entity.entityId, limit: LICENSE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, DOMAIN_LICENSE_RPC.EVENTS), isCurrent)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      const readback = await sendProjectCreate(target, { entityId: result.entity.entityId }, DOMAIN_LICENSE_RPC.GET)
      requireLicenseAuditReadback(readback, result)
      const outbound = await readVerifiedProjectCreateScope(target)
      if (!isDeepStrictEqual(outbound, live) || !isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await this.credentials.delete(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      return { state: 'applied', result, event }
    } catch (error) {
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      const code = safeProjectAuthorityCode(error)
      if (['AUTH_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'WORKSPACE_MISMATCH', 'INVALID_PAYLOAD', 'IDEMPOTENCY_CONFLICT', 'REVISION_CONFLICT', 'SCHEMA_VERSION_UNSUPPORTED'].includes(code)) {
        await persist('blocked', code); return { state: 'blocked', eligible: false, code }
      }
      await persist('uncertain', null); return { state: 'uncertain', eligible: true, command: pending.command }
    }
  }
  async cancel(localId: string, operation: 'project.createShared' | 'audit.releaseLicense' = 'project.createShared'): Promise<void> {
    const pending = await this.pending(localId)
    if (pending && ('operation' in pending ? 'audit.releaseLicense' : 'project.createShared') !== operation) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT' })
    await this.binding(localId); await this.pending(localId) // Reject unknown future/corrupt bytes rather than deleting them.
    await this.credentials.delete(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
  }
  async disconnect(localId: string): Promise<void> {
    await this.pending(localId); await this.binding(localId)
    await this.credentials.delete(credentialId(localId, PROJECT_CREATE_INTENT_CREDENTIAL_NAME))
    await this.credentials.delete(credentialId(localId, PROJECT_CREATE_BINDING_CREDENTIAL_NAME))
  }
}

class ScopeRequestFailure extends Error { constructor(readonly code: string) { super(code) } }
export async function readVerifiedProjectCreateScope(target: ProjectAuthorityTarget): Promise<VerifiedProjectCreateScope> {
  try {
    const response = await fetch(target.url.replace(/^ws/, 'http') + 'v1/workspaces/' + target.workspaceId + '/identity', {
      redirect: 'error', signal: AbortSignal.timeout(PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS), headers: { Authorization: 'Bearer ' + target.token },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ScopeRequestFailure(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : 'PROVIDER_UNAVAILABLE')
    }
    if (!response.body) throw new ScopeRequestFailure('PROVIDER_UNAVAILABLE')
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength
        if (length > PROJECT_AUTHORITY_RESPONSE_MAX_BYTES) { await reader.cancel(); throw new ScopeRequestFailure('PROVIDER_UNAVAILABLE') }; chunks.push(part.value) }
    } finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const scope = requireVerifiedProjectCreateScope(parsed)
    if (scope.workspaceId !== target.workspaceId || scope.expiresAt <= Date.now()) throw new ProjectAuthorityError('AUTH_FAILED')
    return scope
  } catch (error) {
    if (error instanceof ScopeRequestFailure || error instanceof ProjectAuthorityError) throw error
    throw new ScopeRequestFailure(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_TIMEOUT' : 'PROVIDER_UNAVAILABLE')
  }
}
async function sendProjectCreate(target: ProjectAuthorityTarget, command: unknown, channel: string = DOMAIN_PROJECT_RPC.CREATE_SHARED): Promise<unknown> {
  const remote = { url: target.url, remoteWorkspaceId: target.workspaceId, token: target.token, tlsTrust: { mode: 'public-ca' as const } }
  const client = new WsRpcClient(target.url, { token: target.token, workspaceId: target.workspaceId, mode: 'remote', autoReconnect: false,
    requestTimeout: PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS, connectTimeout: PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS,
    clientCapabilities: [], ...peerTrustOptionsForRemote(remote) })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new ScopeRequestFailure('REQUEST_TIMEOUT')), PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS)
      client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { if (timer) clearTimeout(timer); resolve() }
        else if (state.status === 'failed' || state.status === 'disconnected') reject(new ScopeRequestFailure(state.lastError?.kind === 'auth' ? 'UNAUTHENTICATED' : 'PROVIDER_UNAVAILABLE'))
      })
      client.connect()
    })
    return await client.invoke(channel, target.workspaceId, command)
  } finally { if (timer) clearTimeout(timer); client.destroy() }
}
