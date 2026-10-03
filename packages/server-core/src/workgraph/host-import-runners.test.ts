import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@rox/core/platform'
import {
  credentialIdToAccount, LocalFileSecretProvider,
  type CredentialBackend, type CredentialId, type StoredCredential,
} from '@rox/shared/credentials'
import type { ConnectionRecord, CreateConnectionInput } from './index'
import type { HostImportRunners } from './host-import-runners'
import { commitGitHelperImport, previewGitHelperImport } from './git-helper-import'
import {
  commitDockerHelperImport, previewDockerHelperImport,
  commitAwsProfileImport, previewAwsProfileImport,
  commitKeychainImport, previewKeychainImport,
  commitSshAgentImport, previewSshAgentImport,
} from './local-imports'

const SECRET = 'fixture-only-credential-value'
const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
class MemoryBackend implements CredentialBackend {
  readonly name = 'memory'
  readonly priority = 1
  readonly store = new Map<string, StoredCredential>()
  async isAvailable() { return true }
  async get(id: CredentialId) { return this.store.get(credentialIdToAccount(id)) ?? null }
  async set(id: CredentialId, value: StoredCredential) { this.store.set(credentialIdToAccount(id), value) }
  async delete(id: CredentialId) { return this.store.delete(credentialIdToAccount(id)) }
  async list(): Promise<CredentialId[]> { return [] }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-host-import-')); roots.push(root)
  const backend = new MemoryBackend()
  const registry = new CredentialRefRegistry()
  const provider = new LocalFileSecretProvider(backend, registry)
  const records: ConnectionRecord[] = []
  const kernel = {
    async createConnection(input: CreateConnectionInput): Promise<ConnectionRecord> {
      const record = { ...input, id: `connection-${records.length}`, scopes: input.scopes ?? [], createdAt: 1, updatedAt: 1 }
      records.push(record); return record
    },
    async bindConsumer(): Promise<never> { throw new Error('unexpected binding without broker') },
  }
  const config = (name: string, value: string) => { const p = join(root, name); writeFileSync(p, value); return p }
  return { backend, provider, registry, kernel, records, config }
}
const owner = { workspaceId: 'workspace_test', requestedBy: 'owner' }
const gitConfig = '[credential "https://github.com"]\n helper = store\n username = fixture\n[credential "https://other.example"]\n helper = store\n'
const dockerConfig = JSON.stringify({ credHelpers: { 'registry.example': 'fixture', 'other.example': 'other' } })
const awsConfig = '[profile selected]\n credential_process = fixture-command --selected\n[profile other]\n credential_process = fixture-command --other\n'
const keychainDump = 'class: genp\n "svce"<blob>="fixture-service"\n "acct"<blob>="fixture-account"\nclass: genp\n "svce"<blob>="other-service"\n "acct"<blob>="other-account"\n'

describe('explicit local Connection host imports', () => {
  it('Git preview does not read helpers, and selected commit invokes the production parser port exactly once', async () => {
    const f = fixture(); const configPath = f.config('gitconfig', gitConfig); const inputs: string[] = []
    const runners: HostImportRunners = { git: async ({ stdin }) => { inputs.push(stdin); return `username=fixture\npassword=${SECRET}\n` } }
    const preview = await previewGitHelperImport({ configPath, provider: f.provider, runners })
    expect(preview).toHaveLength(2); expect(inputs).toEqual([]); expect(JSON.stringify(preview)).not.toContain(SECRET)
    const selected = preview.find(x => x.label.includes('github.com'))!
    const record = await commitGitHelperImport({ ...f, ...owner, configPath, candidateId: selected.candidateId, runners })
    expect(inputs).toHaveLength(1); expect(inputs[0]).toContain('host=github.com'); expect(inputs[0]).not.toContain('other.example')
    expect(record.integrationId).toBe('github'); expect(record.storageMode).toBe('copy')
    expect(f.backend.store.size).toBe(1); expect(JSON.stringify([...f.backend.store.values()])).toContain(SECRET)
    expect(JSON.stringify(record)).not.toContain(SECRET)
  })
  it('Docker preview does not query helpers, and commit queries only the selected registry', async () => {
    const f = fixture(); const configPath = f.config('docker.json', dockerConfig); const calls: unknown[] = []
    const runners: HostImportRunners = { docker: async input => { calls.push(input); return JSON.stringify({ Username: 'fixture', Secret: SECRET }) } }
    const preview = await previewDockerHelperImport({ configPath, provider: f.provider, runners })
    expect(calls).toEqual([]); expect(preview).toHaveLength(2)
    const record = await commitDockerHelperImport({ ...f, ...owner, configPath, candidateId: preview[0]!.candidateId, runners })
    expect(calls).toEqual([{ helper: 'fixture', stdin: 'registry.example' }]); expect(record.integrationId).toBe('docker')
    expect(f.backend.store.size).toBe(1); expect(JSON.stringify(record)).not.toContain(SECRET)
  })
  it('AWS preview does not execute credential_process; selected commit uses only its configured command', async () => {
    const f = fixture(); const configPath = f.config('awsconfig', awsConfig); const calls: unknown[] = []
    const runners: HostImportRunners = { aws: async input => { calls.push(input); return JSON.stringify({ Version: 1, AccessKeyId: 'fixture-key', SecretAccessKey: SECRET, SessionToken: 'fixture-session' }) } }
    const preview = await previewAwsProfileImport({ credentialsPath: '', configPath, provider: f.provider, runners })
    expect(calls).toEqual([]); expect(preview).toHaveLength(2)
    const record = await commitAwsProfileImport({ ...f, ...owner, credentialsPath: '', configPath, candidateId: 'aws:selected', runners })
    expect(calls).toEqual([{ command: 'fixture-command --selected' }]); expect(record.integrationId).toBe('aws')
    expect(f.backend.store.size).toBe(1); expect(JSON.stringify(record)).not.toContain(SECRET)
  })
  it('Keychain preview lists metadata without reading passwords; commit reads the selected service/account', async () => {
    const f = fixture(); let lists = 0; const gets: unknown[] = []
    const runners: HostImportRunners = { keychainList: async () => { lists++; return keychainDump }, keychainGet: async input => { gets.push(input); return SECRET } }
    const preview = await previewKeychainImport({ provider: f.provider, runners })
    expect(lists).toBe(1); expect(gets).toEqual([]); expect(preview).toHaveLength(2)
    const record = await commitKeychainImport({ ...f, ...owner, candidateId: preview[0]!.candidateId, runners })
    expect(lists).toBe(2); expect(gets).toEqual([{ service: 'fixture-service', account: 'fixture-account' }])
    expect(f.backend.store.size).toBe(1); expect(record.integrationId).toBe('keychain'); expect(JSON.stringify(record)).not.toContain(SECRET)
  })
  it('SSH-agent preview/commit parses only public identities and creates a reference without copying a private key', async () => {
    const f = fixture(); let lists = 0
    const runners: HostImportRunners = { sshAgentList: async () => { lists++; return '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-private\n-----END OPENSSH PRIVATE KEY-----\nssh-ed25519 Zml4dHVyZQ== fixture-key\n' } }
    const preview = await previewSshAgentImport({ provider: f.provider, runners })
    expect(preview).toHaveLength(1); expect(JSON.stringify(preview)).not.toContain('fixture-private')
    const record = await commitSshAgentImport({ ...f, ...owner, candidateId: preview[0]!.candidateId, runners })
    expect(lists).toBe(2); expect(record.integrationId).toBe('ssh'); expect(record.storageMode).toBe('reference')
    expect(f.backend.store.size).toBe(0)
  })
  it('an explicit higher-level Git override takes precedence over the default host runner', async () => {
    const f = fixture(); const configPath = f.config('gitconfig', gitConfig); let lowCalls = 0
    const runners: HostImportRunners = { git: async () => { lowCalls++; throw new Error('unexpected host runner') } }
    const preview = await previewGitHelperImport({ configPath, provider: f.provider, runners })
    await commitGitHelperImport({ ...f, ...owner, configPath, candidateId: preview[0]!.candidateId, runners, fill: () => ({ username: 'fixture', password: SECRET }) })
    expect(lowCalls).toBe(0); expect(f.backend.store.size).toBe(1)
  })
  for (const kind of ['git', 'docker', 'aws', 'keychain'] as const) {
    it(`${kind}: unknown candidates acquire no secret, write no copy and create no connection`, async () => {
      const f = fixture(); let reads = 0
      const fail = async () => { reads++; throw new Error(`must never expose ${SECRET}`) }
      const runners: HostImportRunners = { git: fail, docker: fail, aws: fail, keychainList: async () => keychainDump, keychainGet: fail }
      const common = { ...f, ...owner, candidateId: 'unknown', runners }
      let call: Promise<ConnectionRecord>
      if (kind === 'git') call = commitGitHelperImport({ ...common, configPath: f.config('git', gitConfig) })
      else if (kind === 'docker') call = commitDockerHelperImport({ ...common, configPath: f.config('docker', dockerConfig) })
      else if (kind === 'aws') call = commitAwsProfileImport({ ...common, credentialsPath: '', configPath: f.config('aws', awsConfig) })
      else call = commitKeychainImport(common)
      await expect(call).rejects.toThrow('unknown_candidate'); expect(reads).toBe(0); expect(f.backend.store.size).toBe(0); expect(f.records).toEqual([])
    })
    it(`${kind}: helper failures refuse copy/connection creation without exposing output`, async () => {
      const f = fixture()
      const fail = async () => { throw new Error(`fixture error ${SECRET}`) }
      const runners: HostImportRunners = { git: fail, docker: fail, aws: fail, keychainList: async () => keychainDump, keychainGet: fail }
      const common = { ...f, ...owner, runners }
      let call: Promise<ConnectionRecord>
      if (kind === 'git') { const configPath = f.config('git', gitConfig); const preview = await previewGitHelperImport({ ...common, configPath }); call = commitGitHelperImport({ ...common, configPath, candidateId: preview[0]!.candidateId }) }
      else if (kind === 'docker') call = commitDockerHelperImport({ ...common, configPath: f.config('docker', dockerConfig), candidateId: 'docker:registry.example:fixture' })
      else if (kind === 'aws') call = commitAwsProfileImport({ ...common, credentialsPath: '', configPath: f.config('aws', awsConfig), candidateId: 'aws:selected' })
      else call = commitKeychainImport({ ...common, candidateId: 'keychain:fixture-service:fixture-account' })
      await expect(call).rejects.toThrow('secret_unavailable'); expect(f.backend.store.size).toBe(0); expect(f.records).toEqual([])
    })
  }
})
