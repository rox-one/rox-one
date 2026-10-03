import { randomUUID } from 'node:crypto'
import { CredentialManager, SecureStorageBackend, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import { credentialPayloadFingerprint, decodeCredentialEnvelope, decodeCredentialEnvelopeOrLegacy } from '../../../../packages/shared/src/credentials/envelope.ts'
import { loadStoredConfig, saveConfig, type StoredConfig } from '@craft-agent/shared/config'
import { PROJECT_AUTHORITY_CREDENTIAL_NAME, ProjectAuthorityError, requireProjectAuthorityConfiguration,
  type ProjectAuthorityConfiguration } from '../shared/project-authority'

const JOURNAL_NAME = PROJECT_AUTHORITY_CREDENTIAL_NAME + '-mutation-journal'
const JOURNAL_CODEC = 'rox-authority-mutation-v1.'
const JOURNAL_TOKEN_TYPE = 'ROX_AUTHORITY_MUTATION_V1'
const MAX_JOURNAL_BYTES = 131072
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
export type AuthorityJournalCheckpoint = 'prepared' | 'credential_written' | 'configuration_written' | 'journal_removed'
  | 'rollback_credential_written' | 'rollback_configuration_written'
  | 'disconnect_credential_deleted' | 'disconnect_configuration_deleted'
interface StrictCredentials {
  get(id: CredentialId): Promise<StoredCredential | null>
  set(id: CredentialId, credential: StoredCredential): Promise<void>
  delete(id: CredentialId): Promise<boolean>
}
export interface AuthorityJournalPorts {
  readonly credentials: StrictCredentials
  readonly loadConfig: () => StoredConfig | null
  readonly saveConfig: (configuration: StoredConfig) => void
  readonly checkpoint?: (checkpoint: AuthorityJournalCheckpoint) => Promise<void>
}
interface MutationJournal {
  readonly version: 1
  readonly operationId: string
  readonly localWorkspaceId: string
  readonly action: 'replace' | 'disconnect'
  readonly decision: 'prepared' | 'rollback'
  readonly beforeConfiguration: ProjectAuthorityConfiguration | null
  readonly beforeCredential: StoredCredential | null
  readonly targetConfiguration: ProjectAuthorityConfiguration | null
  readonly targetFingerprint: string | null
}
function unavailable(): never { throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE') }
function scope(workspaceId: string): void { if (!UUID.test(workspaceId)) throw new ProjectAuthorityError('WORKSPACE_MISMATCH') }
function id(workspaceId: string, journal = false): CredentialId {
  return { type: 'service_oauth', workspaceId, name: journal ? JOURNAL_NAME : PROJECT_AUTHORITY_CREDENTIAL_NAME }
}
function decodeStored(raw: unknown): StoredCredential {
  const envelope = raw && typeof raw === 'object' && 'value' in raw && typeof raw.value === 'string'
    ? decodeCredentialEnvelope(raw.value) : null
  const decoded = envelope ?? decodeCredentialEnvelopeOrLegacy(raw, 'oauth2_token_set')
  if (!decoded) return unavailable()
  return decoded.payload
}
function authorityCredential(raw: unknown): StoredCredential {
  const credential = decodeStored(raw)
  if (credential.tokenType !== 'Bearer' || typeof credential.expiresAt !== 'number' || !Number.isFinite(credential.expiresAt)
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential.value)) return unavailable()
  return credential
}
function fingerprint(credential: StoredCredential | null): string | null {
  return credential === null ? null : credentialPayloadFingerprint('oauth2_token_set', credential)
}
function configuration(value: unknown): ProjectAuthorityConfiguration | null {
  return value === null ? null : requireProjectAuthorityConfiguration(value)
}
function equalConfiguration(a: ProjectAuthorityConfiguration | null, b: ProjectAuthorityConfiguration | null): boolean {
  return a === null || b === null ? a === b : a.url === b.url && a.workspaceId === b.workspaceId && a.workspaceName === b.workspaceName
}
function parseJournal(credential: StoredCredential, workspaceId: string): MutationJournal {
  if (credential.tokenType !== JOURNAL_TOKEN_TYPE || !credential.value.startsWith(JOURNAL_CODEC)
    || Buffer.byteLength(credential.value) > MAX_JOURNAL_BYTES) return unavailable()
  let raw: unknown
  try { raw = JSON.parse(Buffer.from(credential.value.slice(JOURNAL_CODEC.length), 'base64url').toString('utf8')) }
  catch { return unavailable() }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).sort().join(',') !== 'action,beforeConfiguration,beforeCredential,decision,localWorkspaceId,operationId,targetConfiguration,targetFingerprint,version'
    || !('version' in raw) || raw.version !== 1 || !('operationId' in raw) || typeof raw.operationId !== 'string' || !UUID.test(raw.operationId)
    || !('localWorkspaceId' in raw) || raw.localWorkspaceId !== workspaceId
    || !('action' in raw) || (raw.action !== 'replace' && raw.action !== 'disconnect')
    || !('decision' in raw) || (raw.decision !== 'prepared' && raw.decision !== 'rollback')
    || !('beforeConfiguration' in raw) || !('beforeCredential' in raw)
    || !('targetConfiguration' in raw) || !('targetFingerprint' in raw)
    || (raw.targetFingerprint !== null && (typeof raw.targetFingerprint !== 'string' || !HASH.test(raw.targetFingerprint)))) return unavailable()
  const targetConfiguration = configuration(raw.targetConfiguration)
  const targetFingerprint = raw.targetFingerprint
  if (raw.action === 'disconnect' ? targetConfiguration !== null || targetFingerprint !== null
    : targetConfiguration === null || targetFingerprint === null) return unavailable()
  return { version: 1, operationId: raw.operationId, localWorkspaceId: workspaceId, action: raw.action, decision: raw.decision,
    beforeConfiguration: configuration(raw.beforeConfiguration), beforeCredential: raw.beforeCredential === null ? null : authorityCredential(raw.beforeCredential),
    targetConfiguration, targetFingerprint }
}

/** Uses the same controlled encrypted backend; never treats a failed/decryption read as absence. */
export async function createAuthorityJournalPorts(manager: CredentialManager,
  loadConfig: () => StoredConfig | null = loadStoredConfig, persistConfig: (configuration: StoredConfig) => void = saveConfig): Promise<AuthorityJournalPorts> {
  const backend = await manager.getMigrationBackend()
  if (!(backend instanceof SecureStorageBackend)) return unavailable()
  return { loadConfig, saveConfig: persistConfig, credentials: {
    get: async credentialId => {
      const raw = await backend.get(credentialId)
      if (backend.getRepairState().status !== 'ok') return unavailable()
      return raw === null ? null : decodeStored(raw)
    },
    set: (credentialId, credential) => backend.set(credentialId, credential),
    delete: credentialId => backend.delete(credentialId),
  } }
}

let authorityCommits: Promise<void> = Promise.resolve()

/** A temporary rollback record in the existing encrypted store; not an identity authority or token cache. */
export class ProjectAuthorityJournal {
  constructor(private readonly ports: AuthorityJournalPorts) {}
  private serialize<T>(mutation: () => Promise<T>): Promise<T> {
    const pending = authorityCommits.then(mutation)
    authorityCommits = pending.then(() => {}, () => {})
    return pending
  }
  private async checkpoint(point: AuthorityJournalCheckpoint): Promise<void> { await this.ports.checkpoint?.(point) }
  private readConfiguration(workspaceId: string): ProjectAuthorityConfiguration | null {
    const stored = this.ports.loadConfig()
    const workspace = stored?.workspaces.find(item => item.id === workspaceId)
    if (!workspace) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    return workspace.projectAuthority === undefined ? null : requireProjectAuthorityConfiguration(workspace.projectAuthority)
  }
  private writeConfiguration(workspaceId: string, value: ProjectAuthorityConfiguration | null,
    before: ProjectAuthorityConfiguration | null, target: ProjectAuthorityConfiguration | null): void {
    const stored = this.ports.loadConfig()
    if (!stored || !stored.workspaces.some(item => item.id === workspaceId)) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    const current = this.readConfiguration(workspaceId)
    if (!equalConfiguration(current, before) && !equalConfiguration(current, target)) return unavailable()
    stored.workspaces = stored.workspaces.map(workspace => {
      if (workspace.id !== workspaceId) return workspace
      const copy = { ...workspace }
      if (value === null) delete copy.projectAuthority
      else copy.projectAuthority = value
      return copy
    })
    this.ports.saveConfig(stored)
  }
  private async readCredential(workspaceId: string): Promise<StoredCredential | null> {
    const credential = await this.ports.credentials.get(id(workspaceId))
    return credential === null ? null : authorityCredential(credential)
  }
  private async writeJournal(journal: MutationJournal): Promise<void> {
    const value = JOURNAL_CODEC + Buffer.from(JSON.stringify(journal), 'utf8').toString('base64url')
    if (Buffer.byteLength(value) > MAX_JOURNAL_BYTES) return unavailable()
    await this.ports.credentials.set(id(journal.localWorkspaceId, true), { value, tokenType: JOURNAL_TOKEN_TYPE })
  }
  private async cleanup(workspaceId: string): Promise<void> {
    await this.ports.credentials.delete(id(workspaceId, true))
    if (await this.ports.credentials.get(id(workspaceId, true)) !== null) return unavailable()
    await this.checkpoint('journal_removed')
  }
  private async rollback(journal: MutationJournal): Promise<void> {
    const workspaceId = journal.localWorkspaceId
    await this.writeJournal({ ...journal, decision: 'rollback' })
    if (journal.beforeCredential) await this.ports.credentials.set(id(workspaceId), journal.beforeCredential)
    else await this.ports.credentials.delete(id(workspaceId))
    await this.checkpoint('rollback_credential_written')
    this.writeConfiguration(workspaceId, journal.beforeConfiguration, journal.beforeConfiguration, journal.targetConfiguration)
    await this.checkpoint('rollback_configuration_written')
    await this.cleanup(workspaceId)
  }
  private async recoverUnlocked(workspaceId: string): Promise<void> {
    scope(workspaceId)
    const stored = await this.ports.credentials.get(id(workspaceId, true))
    if (stored === null) return
    const journal = parseJournal(stored, workspaceId)
    const current = this.readConfiguration(workspaceId)
    const currentFingerprint = fingerprint(await this.readCredential(workspaceId))
    const previousFingerprint = fingerprint(journal.beforeCredential)
    if ((!equalConfiguration(current, journal.beforeConfiguration) && !equalConfiguration(current, journal.targetConfiguration))
      || (currentFingerprint !== previousFingerprint && currentFingerprint !== journal.targetFingerprint)) return unavailable()
    if (journal.action === 'disconnect') {
      await this.ports.credentials.delete(id(workspaceId))
      await this.checkpoint('disconnect_credential_deleted')
      this.writeConfiguration(workspaceId, null, journal.beforeConfiguration, null)
      await this.checkpoint('disconnect_configuration_deleted')
      if (await this.readCredential(workspaceId) !== null || this.readConfiguration(workspaceId) !== null) return unavailable()
      await this.cleanup(workspaceId)
    } else if (journal.decision === 'prepared' && equalConfiguration(current, journal.targetConfiguration)
      && currentFingerprint === journal.targetFingerprint) {
      await this.cleanup(workspaceId)
    } else {
      await this.rollback(journal)
    }
  }
  recover(workspaceId: string): Promise<void> { return this.serialize(() => this.recoverUnlocked(workspaceId)) }
  replace(workspaceId: string, target: ProjectAuthorityConfiguration, credential: StoredCredential,
    isCurrent: () => boolean): Promise<void> {
    return this.serialize(async () => {
      await this.recoverUnlocked(workspaceId)
      const checkedCredential = authorityCredential(credential)
      if (typeof checkedCredential.expiresAt !== 'number' || checkedCredential.expiresAt <= Date.now()) throw new ProjectAuthorityError('AUTH_FAILED')
      const beforeCredential = await this.readCredential(workspaceId)
      const beforeConfiguration = this.readConfiguration(workspaceId)
      const journal: MutationJournal = { version: 1, operationId: randomUUID(), localWorkspaceId: workspaceId, action: 'replace', decision: 'prepared',
        beforeConfiguration, beforeCredential, targetConfiguration: requireProjectAuthorityConfiguration(target), targetFingerprint: fingerprint(checkedCredential) }
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await this.writeJournal(journal)
      await this.checkpoint('prepared')
      try {
        if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
        await this.ports.credentials.set(id(workspaceId), checkedCredential)
        await this.checkpoint('credential_written')
        if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
        this.writeConfiguration(workspaceId, journal.targetConfiguration, beforeConfiguration, journal.targetConfiguration)
        await this.checkpoint('configuration_written')
        if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
        await this.cleanup(workspaceId)
      } catch (error) {
        await this.rollback(journal)
        throw error
      }
    })
  }
  disconnect(workspaceId: string, isCurrent: () => boolean): Promise<void> {
    return this.serialize(async () => {
      await this.recoverUnlocked(workspaceId)
      const beforeCredential = await this.readCredential(workspaceId)
      const beforeConfiguration = this.readConfiguration(workspaceId)
      if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      await this.writeJournal({ version: 1, operationId: randomUUID(), localWorkspaceId: workspaceId, action: 'disconnect', decision: 'prepared',
        beforeConfiguration, beforeCredential, targetConfiguration: null, targetFingerprint: null })
      await this.checkpoint('prepared')
      // Prepared disconnect is a durable intent; recovery must never reactivate the old actor.
      await this.recoverUnlocked(workspaceId)
    })
  }
}
