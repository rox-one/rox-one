import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getCredentialManager } from '../../packages/shared/src/credentials'
import { loadStoredConfig, saveConfig, type StoredConfig } from '../../packages/shared/src/config'
import { createAuthorityJournalPorts, type AuthorityJournalCheckpoint } from '../../apps/electron/src/main/project-authority-journal'
import { authenticateProjectAuthority, connectStoredProjectAuthority, disconnectStoredProjectAuthority,
  getStoredProjectAuthorityConfiguration, resolveStoredProjectAuthority, storeProjectAuthorityCredential, type ProjectAuthorityStoragePorts } from '../../apps/electron/src/main/project-authority'
import { PROJECT_AUTHORITY_CREDENTIAL_NAME, requireProjectAuthorityConfiguration } from '../../apps/electron/src/shared/project-authority'
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TEST_INPUT')
  return value as Record<string, unknown>
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_TEST_INPUT'); return value }
const input = record(await new Response(Bun.stdin.stream()).json())
const directory = text(input.directory)
const localWorkspaceId = text(input.localWorkspaceId)
const mode = text(input.mode)
await mkdir(directory, { recursive: true, mode: 0o700 })
const configPath = join(directory, 'config.json')
const encryptedDirectory = directory
// The production singleton uses this process's isolated ROX_CONFIG_DIR and actual default v3 backend.
const manager = getCredentialManager()
const credentialId = { type: 'service_oauth' as const, workspaceId: localWorkspaceId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME }
const journalId = { ...credentialId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME + '-mutation-journal' }
const ports = await createAuthorityJournalPorts(manager, loadStoredConfig,
  config => saveConfig(config, { durable: true }))
let current = true
let targetCredentialFingerprint: string | null = null
let issuedToken: string | null = null
async function checkpoint(point: AuthorityJournalCheckpoint): Promise<void> {
  if (input.invalidateAt === point) current = false
  if (input.stopAt === point) {
    console.log(JSON.stringify({ type: 'checkpoint', point, targetCredentialFingerprint }))
    await new Promise<void>(() => { setInterval(() => {}, 1000) })
  }
}
const productionPorts: ProjectAuthorityStoragePorts = { ...ports, checkpoint, authenticate: async value => {
  const authenticated = await authenticateProjectAuthority(value)
  issuedToken = authenticated.credential.token
  targetCredentialFingerprint = createHash('sha256').update(issuedToken).digest('hex')
  return authenticated
} }
function requireMutation(result: Awaited<ReturnType<typeof connectStoredProjectAuthority>>): void {
  if (!result.ok) throw Object.assign(new Error(result.error.code), { code: result.error.code })
}
try {
  if (mode === 'seed') {
    const configuration = requireProjectAuthorityConfiguration(input.configuration)
    const credential = record(input.credential)
    if (typeof credential.expiresAt !== 'number') throw new Error('INVALID_TEST_INPUT')
    const config: StoredConfig = { workspaces: [{ id: localWorkspaceId, slug: localWorkspaceId, name: 'Local crash fixture',
      rootPath: join(directory, 'workspace'), createdAt: Date.now() }], activeWorkspaceId: localWorkspaceId, activeSessionId: null }
    ports.saveConfig(config)
    await storeProjectAuthorityCredential(localWorkspaceId, configuration,
      { token: text(credential.value), expiresAt: credential.expiresAt }, productionPorts)
  } else if (mode === 'replace' || mode === 'supersede' || mode === 'authenticate') {
    const result = await connectStoredProjectAuthority(localWorkspaceId, input.loginInput, () => current, productionPorts)
    if (mode !== 'supersede') requireMutation(result)
    else {
      if (result.ok) throw new Error('Expected superseded actual authentication')
      requireMutation(await disconnectStoredProjectAuthority(localWorkspaceId, productionPorts))
    }
  } else if (mode === 'disconnect') {
    requireMutation(await disconnectStoredProjectAuthority(localWorkspaceId, productionPorts, () => current))
  } else if (mode === 'recover') {
    await getStoredProjectAuthorityConfiguration(localWorkspaceId, productionPorts)
    await resolveStoredProjectAuthority(localWorkspaceId, productionPorts)
  } else if (mode === 'recover-target') {
    await resolveStoredProjectAuthority(localWorkspaceId, productionPorts)
    await getStoredProjectAuthorityConfiguration(localWorkspaceId, productionPorts)
  } else if (mode === 'blocked-rollback') {
    const old = await ports.credentials.get(credentialId)
    if (!old) throw new Error('Missing actual seeded credential')
    let fault = false
    const failing: ProjectAuthorityStoragePorts = { ...productionPorts,
      checkpoint: async point => { if (point === 'credential_written') { fault = true; throw new Error('INJECTED_POST_WRITE_FAILURE') } },
      credentials: { ...ports.credentials, set: async (id, value) => {
        if (fault && id.name === PROJECT_AUTHORITY_CREDENTIAL_NAME && value.value === old.value) throw new Error('INJECTED_ROLLBACK_STORAGE_FAILURE')
        await ports.credentials.set(id, value)
      } },
    }
    const mutation = await connectStoredProjectAuthority(localWorkspaceId, input.loginInput, () => true, failing)
    if (mutation.ok) throw new Error('Failed rollback unexpectedly succeeded')
    let blockedConfiguration = false; let blockedTarget = false
    let configurationCode: string | null = null; let targetCode: string | null = null
    try { await getStoredProjectAuthorityConfiguration(localWorkspaceId, failing) } catch (error) { blockedConfiguration = true; configurationCode = error instanceof Error ? error.message : null }
    try { await resolveStoredProjectAuthority(localWorkspaceId, failing) } catch (error) { blockedTarget = true; targetCode = error instanceof Error ? error.message : null }
    const pending = await ports.credentials.get(journalId)
    const repaired = await disconnectStoredProjectAuthority(localWorkspaceId, productionPorts)
    const configuration = await getStoredProjectAuthorityConfiguration(localWorkspaceId, productionPorts)
    const target = await resolveStoredProjectAuthority(localWorkspaceId, productionPorts)
    console.log(JSON.stringify({ type: 'result', ok: true, mutation, blockedConfiguration, blockedTarget, configurationCode, targetCode, journalRetained: pending !== null,
      repaired, configuration, target, credentialAbsent: await ports.credentials.get(credentialId) === null,
      journalAbsent: await ports.credentials.get(journalId) === null }))
    process.exit(0)
  } else if (mode !== 'inspect') {
    throw new Error('INVALID_TEST_INPUT')
  }
  const config = ports.loadConfig()
  const workspace = config?.workspaces.find(item => item.id === localWorkspaceId)
  const active = await ports.credentials.get(credentialId)
  const pendingJournal = await ports.credentials.get(journalId)
  let authorizedStatus: number | null = null
  let privateMarkerVisible = false
  if (workspace?.projectAuthority && active && input.probes) {
    const probes = record(input.probes)
    const probeValue = probes[workspace.projectAuthority.workspaceId]
    const probe = record(probeValue)
    const origin = workspace.projectAuthority.url.replace(/^ws/, 'http')
    const response = await fetch(origin + 'v1/workspaces/' + workspace.projectAuthority.workspaceId + '/projects/' + text(probe.entityId),
      { headers: { Authorization: 'Bearer ' + active.value } })
    authorizedStatus = response.status
    privateMarkerVisible = (await response.text()).includes(text(probe.marker))
  }
  let leaks = false
  if (Array.isArray(input.secretsToCheck)) {
    const files = [configPath, ...(await readdir(encryptedDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => join(encryptedDirectory, entry.name))]
    for (const path of files) {
      const bytes = await readFile(path)
      for (const secret of [...input.secretsToCheck, issuedToken]) if (typeof secret === 'string' && bytes.includes(Buffer.from(secret))) leaks = true
    }
  }
  console.log(JSON.stringify({ type: 'result', ok: true, configuration: workspace?.projectAuthority ?? null,
    credentialFingerprint: active ? createHash('sha256').update(active.value).digest('hex') : null,
    journalPresent: pendingJournal !== null, authorizedStatus, privateMarkerVisible, leaks,
    targetCredentialFingerprint, notificationsEnabled: config?.notificationsEnabled ?? null, workspaceName: workspace?.name ?? null }))
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'PROVIDER_UNAVAILABLE'
  console.log(JSON.stringify({ type: 'result', ok: false, code }))
  process.exitCode = 1
}
