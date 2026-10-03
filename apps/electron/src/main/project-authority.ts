import type { LicenseAuditAttempt } from '../shared/license-audit-intent'
import { ProjectCreateIntentStore, readVerifiedProjectCreateScope } from './project-create-intent'
import type { ProjectCreateAttempt, ProjectCreateIntentView, ProjectCreateIntentAction, VerifiedProjectCreateScope } from '../shared/project-create-intent'
import { getCredentialManager, type CredentialManager } from '@rox/shared/credentials'
import { loadStoredConfig, saveConfig, type StoredConfig } from '@rox/shared/config'
import { createAuthorityJournalPorts, ProjectAuthorityJournal, type AuthorityJournalPorts } from './project-authority-journal'
import {
  PROJECT_AUTHORITY_CREDENTIAL_NAME,
  PROJECT_AUTHORITY_LOGIN_MAX_LENGTH, PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH,
  PROJECT_AUTHORITY_RESPONSE_MAX_BYTES, PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS,
  ProjectAuthorityError, safeProjectAuthorityCode,
  requireProjectAuthorityConfiguration,
  type ProjectAuthorityConfiguration,
  type ProjectAuthorityLoginInput,
  type ProjectAuthorityMutationResult,
  type ProjectAuthorityTarget,
} from '../shared/project-authority'

/** Uses the existing encrypted service credential slot; no second credential or connection store. */
export async function resolveProjectAuthorityTarget(
  localWorkspaceId: string,
  configuration: ProjectAuthorityConfiguration | undefined,
  credentials: Pick<CredentialManager, 'get'> = getCredentialManager(),
): Promise<ProjectAuthorityTarget | null> {
  if (!configuration) return null
  const metadata = requireProjectAuthorityConfiguration(configuration)
  const credential = await credentials.get({ type: 'service_oauth', workspaceId: localWorkspaceId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })
  if (!credential || !credential.value || credential.tokenType !== 'Bearer'
    || typeof credential.expiresAt !== 'number' || credential.expiresAt <= Date.now()) throw new ProjectAuthorityError('AUTH_FAILED')
  return { ...metadata, token: credential.value }
}

class AuthorityLoginFailure extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AuthorityLoginFailure('PROVIDER_UNAVAILABLE', 503)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > PROJECT_AUTHORITY_RESPONSE_MAX_BYTES) { await reader.cancel(); throw new AuthorityLoginFailure('PROVIDER_UNAVAILABLE', 503) }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value
  } catch (error) {
    if (error instanceof AuthorityLoginFailure) throw error
    throw new AuthorityLoginFailure('PROVIDER_UNAVAILABLE', 503)
  } finally { reader.releaseLock() }
}

function requireLogin(value: unknown): ProjectAuthorityLoginInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'login,password,serviceUrl,workspaceId,workspaceName'
    || !('serviceUrl' in value) || typeof value.serviceUrl !== 'string'
    || !('workspaceId' in value) || typeof value.workspaceId !== 'string'
    || !('workspaceName' in value) || typeof value.workspaceName !== 'string'
    || !('login' in value) || typeof value.login !== 'string' || !value.login.trim() || value.login.length > PROJECT_AUTHORITY_LOGIN_MAX_LENGTH
    || !('password' in value) || typeof value.password !== 'string' || !value.password || value.password.length > PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH) {
    throw new AuthorityLoginFailure('INVALID_PAYLOAD', 400)
  }
  return { serviceUrl: value.serviceUrl, workspaceId: value.workspaceId, workspaceName: value.workspaceName,
    login: value.login, password: value.password }
}

function responseFailure(status: number): AuthorityLoginFailure {
  return new AuthorityLoginFailure(status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN'
    : status === 404 ? 'NOT_FOUND' : status === 400 ? 'INVALID_PAYLOAD' : 'PROVIDER_UNAVAILABLE',
  [400, 401, 403, 404].includes(status) ? status : 503)
}

async function requestAuthority(url: URL, options: RequestInit): Promise<Response> {
  try { return await fetch(url, options) }
  catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AuthorityLoginFailure('REQUEST_TIMEOUT', 504)
    }
    throw new AuthorityLoginFailure('PROVIDER_UNAVAILABLE', 503)
  }
}

/** Existing explicit issuer HTTP endpoint + real membership query; no renderer JWT or auth fallback. */
export async function authenticateProjectAuthority(input: unknown) {
  const login = requireLogin(input)
  let origin: URL
  try { origin = new URL(login.serviceUrl) } catch { throw new AuthorityLoginFailure('INVALID_PAYLOAD', 400) }
  if (!['http:', 'https:'].includes(origin.protocol)) throw new AuthorityLoginFailure('INVALID_PAYLOAD', 400)
  const metadata = requireProjectAuthorityConfiguration({ url: login.serviceUrl.replace(/^http/, 'ws'),
    workspaceId: login.workspaceId, workspaceName: login.workspaceName })
  const response = await requestAuthority(new URL('/v1/auth/local/token', origin), { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: login.login, password: login.password }) })
  if (!response.ok) { await response.body?.cancel(); throw responseFailure(response.status) }
  const issued = await boundedJson(response)
  if (!issued || typeof issued !== 'object' || Array.isArray(issued) || !('token' in issued) || typeof issued.token !== 'string'
    || !('expiresAt' in issued) || typeof issued.expiresAt !== 'number' || issued.expiresAt <= Date.now()) {
    throw new AuthorityLoginFailure('PROVIDER_UNAVAILABLE', 503)
  }
  const membership = await requestAuthority(new URL('/v1/workspaces/' + metadata.workspaceId + '/projects?limit=1', origin), {
    redirect: 'error', signal: AbortSignal.timeout(PROJECT_AUTHORITY_REQUEST_TIMEOUT_MS), headers: { Authorization: 'Bearer ' + issued.token },
  })
  if (!membership.ok) { await membership.body?.cancel(); throw responseFailure(membership.status) }
  // Consume only a bounded, authorized response. Titles are neither logged nor returned to Connections.
  await boundedJson(membership)
  const createScope = await readVerifiedProjectCreateScope({ ...metadata, token: issued.token })
  return { configuration: metadata, credential: { token: issued.token, expiresAt: issued.expiresAt }, createScope }
}

/** Strict ports use the existing encrypted backend and durable canonical configuration writer. */
export interface ProjectAuthorityStoragePorts extends AuthorityJournalPorts {
  readonly authenticate: typeof authenticateProjectAuthority
}
async function storagePorts(): Promise<ProjectAuthorityStoragePorts> {
  try {
    const ports = await createAuthorityJournalPorts(getCredentialManager(), loadStoredConfig,
      configuration => saveConfig(configuration, { durable: true }))
    return { ...ports, authenticate: authenticateProjectAuthority }
  } catch (error) { throw safeAuthorityFailure(error) }
}
function safeAuthorityFailure(error: unknown): ProjectAuthorityError {
  return error instanceof ProjectAuthorityError ? error : new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
}
interface WorkspaceOperation { generation: number; commit: Promise<void>; blocked: boolean; createQuiesced: boolean }
const operations = new Map<string, WorkspaceOperation>()
function operationFor(workspaceId: string): WorkspaceOperation {
  let operation = operations.get(workspaceId)
  if (!operation) { operation = { generation: 0, commit: Promise.resolve(), blocked: false, createQuiesced: false }; operations.set(workspaceId, operation) }
  return operation
}
function beginOperation(workspaceId: string) {
  const operation = operationFor(workspaceId)
  return { operation, generation: ++operation.generation }
}
function requireCurrent(operation: WorkspaceOperation, generation: number, isCurrent: () => boolean): void {
  if (operation.generation !== generation || !isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
}
function requireStoredWorkspace(localWorkspaceId: string, ports: ProjectAuthorityStoragePorts): StoredConfig {
  const stored = ports.loadConfig()
  if (!stored || !stored.workspaces.some(workspace => workspace.id === localWorkspaceId)) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
  return stored
}
function serializeCommit<T>(operation: WorkspaceOperation, mutation: () => Promise<T>): Promise<T> {
  const pending = operation.commit.then(mutation)
  operation.commit = pending.then(() => {}, () => {})
  return pending
}
function mutationFailure(error: unknown): ProjectAuthorityMutationResult {
  if (error instanceof AuthorityLoginFailure) return { ok: false, error: { code: error.code, status: error.status } }
  if (error instanceof ProjectAuthorityError) return { ok: false, error: { code: error.code,
    status: error.code === 'WORKSPACE_MISMATCH' ? 403 : error.code === 'INVALID_PAYLOAD' ? 400 : error.code === 'CAPABILITY_UNAVAILABLE' ? 503 : 401 } }
  return { ok: false, error: { code: 'PROVIDER_UNAVAILABLE', status: 503 } }
}
async function recoverStoredAuthority(localWorkspaceId: string, operation: WorkspaceOperation,
  ports: ProjectAuthorityStoragePorts): Promise<void> {
  try {
    await new ProjectAuthorityJournal(ports).recover(localWorkspaceId)
    requireStoredWorkspace(localWorkspaceId, ports)
    operation.blocked = false
  } catch (error) { operation.blocked = true; throw safeAuthorityFailure(error) }
}
async function commitCredential(localWorkspaceId: string, configuration: ProjectAuthorityConfiguration,
  credential: { readonly token: string; readonly expiresAt: number }, operation: WorkspaceOperation,
  generation: number, isCurrent: () => boolean, ports: ProjectAuthorityStoragePorts, createScope?: VerifiedProjectCreateScope): Promise<void> {
  const metadata = requireProjectAuthorityConfiguration(configuration)
  await serializeCommit(operation, async () => {
    requireCurrent(operation, generation, isCurrent)
    await recoverStoredAuthority(localWorkspaceId, operation, ports)
    requireCurrent(operation, generation, isCurrent)
    try {
      // Refuse unrecognized create records before changing the canonical credential/configuration pair.
      await new ProjectCreateIntentStore(ports.credentials).hasPending(localWorkspaceId)
      requireCurrent(operation, generation, isCurrent)
      await new ProjectAuthorityJournal(ports).replace(localWorkspaceId, metadata,
        { value: credential.token, expiresAt: credential.expiresAt, tokenType: 'Bearer' },
        () => operation.generation === generation && isCurrent())
      requireCurrent(operation, generation, isCurrent)
      if (createScope) {
        await new ProjectCreateIntentStore(ports.credentials).bind(localWorkspaceId, { ...metadata, token: credential.token }, createScope)
        requireCurrent(operation, generation, isCurrent)
      }
      operation.createQuiesced = false
      operation.blocked = false
    } catch (error) { operation.blocked = true; throw error }
  })
}

export async function connectStoredProjectAuthority(localWorkspaceId: string, input: unknown,
  isCurrent: () => boolean, injectedPorts?: ProjectAuthorityStoragePorts): Promise<ProjectAuthorityMutationResult> {
  const { operation, generation } = beginOperation(localWorkspaceId)
  operation.createQuiesced = true
  try {
    const ports = injectedPorts ?? await storagePorts()
    requireLogin(input)
    await serializeCommit(operation, async () => {
      requireCurrent(operation, generation, isCurrent)
      await recoverStoredAuthority(localWorkspaceId, operation, ports)
      requireCurrent(operation, generation, isCurrent)
    })
    // A rejected replacement preserves a valid durable connection.
    const authenticated = await ports.authenticate(input)
    requireCurrent(operation, generation, isCurrent)
    await commitCredential(localWorkspaceId, authenticated.configuration, authenticated.credential,
      operation, generation, isCurrent, ports, authenticated.createScope)
    return { ok: true }
  } catch (error) { return mutationFailure(error) }
}

function readStoredProjectAuthorityConfiguration(localWorkspaceId: string,
  ports: ProjectAuthorityStoragePorts): ProjectAuthorityConfiguration | null {
  const workspace = requireStoredWorkspace(localWorkspaceId, ports).workspaces.find(workspace => workspace.id === localWorkspaceId)
  if (!workspace) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
  const metadata: unknown = 'projectAuthority' in workspace ? workspace.projectAuthority : undefined
  return metadata === undefined ? null : requireProjectAuthorityConfiguration(metadata)
}

export async function getStoredProjectAuthorityConfiguration(localWorkspaceId: string,
  injectedPorts?: ProjectAuthorityStoragePorts): Promise<ProjectAuthorityConfiguration | null> {
  const operation = operationFor(localWorkspaceId)
  const generation = operation.generation
  const ports = injectedPorts ?? await storagePorts()
  return serializeCommit(operation, async () => {
    requireCurrent(operation, generation, () => true)
    await recoverStoredAuthority(localWorkspaceId, operation, ports)
    requireCurrent(operation, generation, () => true)
    if (operation.blocked) throw new ProjectAuthorityError('AUTH_FAILED')
    return readStoredProjectAuthorityConfiguration(localWorkspaceId, ports)
  }).catch(error => { operation.blocked = true; throw safeAuthorityFailure(error) })
}

export async function disconnectStoredProjectAuthority(localWorkspaceId: string,
  injectedPorts?: ProjectAuthorityStoragePorts, isCurrent: () => boolean = () => true): Promise<ProjectAuthorityMutationResult> {
  // Invalidate an authentication already in flight before waiting for a durable commit.
  const { operation, generation } = beginOperation(localWorkspaceId)
  try {
    const ports = injectedPorts ?? await storagePorts()
    await serializeCommit(operation, async () => {
      requireCurrent(operation, generation, isCurrent)
      await recoverStoredAuthority(localWorkspaceId, operation, ports)
      requireCurrent(operation, generation, isCurrent)
      try {
        operation.createQuiesced = true
        await new ProjectCreateIntentStore(ports.credentials).disconnect(localWorkspaceId)
        requireCurrent(operation, generation, isCurrent)
        // Once the disconnect intent is durable, recovery finishes deletion even after supersession.
        await new ProjectAuthorityJournal(ports).disconnect(localWorkspaceId,
          () => operation.generation === generation && isCurrent())
        operation.blocked = false
      } catch (error) { operation.blocked = true; throw error }
    })
    return { ok: true }
  } catch (error) { return mutationFailure(error) }
}

export async function resolveStoredProjectAuthority(localWorkspaceId: string,
  injectedPorts?: ProjectAuthorityStoragePorts): Promise<ProjectAuthorityTarget | null> {
  const operation = operationFor(localWorkspaceId)
  const generation = operation.generation
  const ports = injectedPorts ?? await storagePorts()
  return serializeCommit(operation, async () => {
    requireCurrent(operation, generation, () => true)
    await recoverStoredAuthority(localWorkspaceId, operation, ports)
    requireCurrent(operation, generation, () => true)
    if (operation.blocked) throw new ProjectAuthorityError('AUTH_FAILED')
    const metadata = readStoredProjectAuthorityConfiguration(localWorkspaceId, ports)
    const result = await resolveProjectAuthorityTarget(localWorkspaceId, metadata ?? undefined, ports.credentials)
    requireCurrent(operation, generation, () => true)
    if (operation.blocked) throw new ProjectAuthorityError('AUTH_FAILED')
    return result
  }).catch(error => { operation.blocked = true; throw safeAuthorityFailure(error) })
}

/** Explicit composition/provisioning API, intentionally absent from renderer IPC. */
export async function storeProjectAuthorityCredential(localWorkspaceId: string,
  configuration: ProjectAuthorityConfiguration, credential: { readonly token: string; readonly expiresAt: number },
  injectedPorts?: ProjectAuthorityStoragePorts): Promise<void> {
  const { operation, generation } = beginOperation(localWorkspaceId)
  const ports = injectedPorts ?? await storagePorts()
  await commitCredential(localWorkspaceId, configuration, credential, operation, generation, () => true, ports)
}


/** Window-bound canonical project/license intent port. Explicit delivery through the existing authority. */

async function storedAuthorityIntent(localWorkspaceId: string, action: ProjectCreateIntentAction,
  input: unknown = undefined, isCurrent: () => boolean = () => true,
  injectedPorts?: ProjectAuthorityStoragePorts, operationKind: 'project.createShared' | 'audit.releaseLicense' = 'project.createShared'): Promise<ProjectCreateAttempt | LicenseAuditAttempt> {
  const operation = operationFor(localWorkspaceId)
  const generation = operation.generation
  try {
    const ports = injectedPorts ?? await storagePorts()
    return await serializeCommit(operation, async () => {
      requireCurrent(operation, generation, isCurrent)
      await recoverStoredAuthority(localWorkspaceId, operation, ports)
      requireCurrent(operation, generation, isCurrent)
      const store = new ProjectCreateIntentStore(ports.credentials)
      if (action === 'cancel') {
        await store.cancel(localWorkspaceId, operationKind)
        requireCurrent(operation, generation, isCurrent)
        return { state: 'none', eligible: false }
      }
      if (operation.blocked || operation.createQuiesced) {
        if (action === 'get') {
          const pending = await store.hasPending(localWorkspaceId)
          requireCurrent(operation, generation, isCurrent)
          if (!pending) return { state: 'none', eligible: false }
        }
        throw new ProjectAuthorityError('AUTH_FAILED')
      }
      const metadata = readStoredProjectAuthorityConfiguration(localWorkspaceId, ports)
      const target = await resolveProjectAuthorityTarget(localWorkspaceId, metadata ?? undefined, ports.credentials)
      requireCurrent(operation, generation, isCurrent)
      if (!target) {
        const pending = await store.hasPending(localWorkspaceId)
        requireCurrent(operation, generation, isCurrent)
        return pending ? { state: 'blocked', eligible: false, code: 'AUTH_FAILED' } : { state: 'none', eligible: false }
      }
      if (action === 'get') {
        const view = operationKind === 'audit.releaseLicense' ? await store.licenseView(localWorkspaceId, target) : await store.view(localWorkspaceId, target)
        requireCurrent(operation, generation, isCurrent)
        return view
      }
      if (action === 'queue') {
        const result = operationKind === 'audit.releaseLicense' ? await store.queueLicense(localWorkspaceId, target, input) : await store.queue(localWorkspaceId, target, input)
        requireCurrent(operation, generation, isCurrent)
        return result
      }
      if (action !== 'retry') throw new ProjectAuthorityError('INVALID_PAYLOAD')
      return operationKind === 'audit.releaseLicense'
        ? await store.retryLicense(localWorkspaceId, target, () => operation.generation === generation && isCurrent())
        : await store.retry(localWorkspaceId, target, () => operation.generation === generation && isCurrent())
    })
  } catch (error) {
    return { state: 'blocked', eligible: false, code: safeProjectAuthorityCode(error) }
  }
}
export async function storedProjectCreateIntent(localWorkspaceId: string, action: ProjectCreateIntentAction,
  input: unknown = undefined, isCurrent: () => boolean = () => true, injectedPorts?: ProjectAuthorityStoragePorts): Promise<ProjectCreateAttempt> {
  const result = await storedAuthorityIntent(localWorkspaceId, action, input, isCurrent, injectedPorts)
  if ((result.state === 'queued' || result.state === 'uncertain') && !('name' in result.command.payload)
    || result.state === 'applied' && !('name' in result.result.data)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return result as ProjectCreateAttempt
}
export async function storedLicenseAuditIntent(localWorkspaceId: string, action: ProjectCreateIntentAction,
  input: unknown = undefined, isCurrent: () => boolean = () => true, injectedPorts?: ProjectAuthorityStoragePorts): Promise<LicenseAuditAttempt> {
  const result = await storedAuthorityIntent(localWorkspaceId, action, input, isCurrent, injectedPorts, 'audit.releaseLicense')
  if ((result.state === 'queued' || result.state === 'uncertain') && !('decisionManifest' in result.command.payload)
    || result.state === 'applied' && !('decisionManifest' in result.result.data)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return result as LicenseAuditAttempt
}
export async function getStoredProjectCreateIntent(localWorkspaceId: string,
  injectedPorts?: ProjectAuthorityStoragePorts): Promise<ProjectCreateIntentView> {
  const result = await storedProjectCreateIntent(localWorkspaceId, 'get', undefined, () => true, injectedPorts)
  if (result.state === 'applied') throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
  return result
}
