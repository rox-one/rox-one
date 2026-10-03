import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getCredentialManager } from '../../packages/shared/src/credentials'
import { loadStoredConfig, saveConfig, type StoredConfig } from '../../packages/shared/src/config'
import { createAuthorityJournalPorts } from '../../apps/electron/src/main/project-authority-journal'
import { authenticateProjectAuthority, connectStoredProjectAuthority, disconnectStoredProjectAuthority, storedLicenseAuditIntent,
  type ProjectAuthorityStoragePorts } from '../../apps/electron/src/main/project-authority'
import { PROJECT_CREATE_INTENT_CREDENTIAL_NAME, PROJECT_CREATE_BINDING_CREDENTIAL_NAME } from '../../apps/electron/src/main/project-create-intent'
import { ProjectAuthorityConnection } from '../../apps/electron/src/transport/project-authority-connection'
import { resolveStoredProjectAuthority } from '../../apps/electron/src/main/project-authority'
import { storedProjectCreateIntent as projectIntent } from '../../apps/electron/src/main/project-authority'
import { createSharedProjectIntent } from '../../apps/electron/src/shared/project-authority'
import { PROJECT_AUTHORITY_CREDENTIAL_NAME } from '../../apps/electron/src/shared/project-authority'
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CHILD_INPUT')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_CHILD_INPUT'); return value }
const input = object(await new Response(Bun.stdin.stream()).json())
const profile = string(input.profile)
const localId = string(input.localId)
const mode = string(input.mode)
await mkdir(profile, { recursive: true, mode: 0o700 })
const manager = getCredentialManager()
const rawPorts = await createAuthorityJournalPorts(manager, loadStoredConfig, configuration => saveConfig(configuration, { durable: true }))
let uncertainWrites = 0
const ports: ProjectAuthorityStoragePorts = { ...rawPorts, authenticate: authenticateProjectAuthority,
  credentials: { ...rawPorts.credentials, set: async (id, credential) => {
    await rawPorts.credentials.set(id, credential)
    if (id.name !== PROJECT_CREATE_INTENT_CREDENTIAL_NAME || credential.tokenType !== 'ROX_DOMAIN_INTENT_V2') return
    const parsed: unknown = JSON.parse(credential.value); const value = object(parsed)
    if (value.state === 'uncertain') ++uncertainWrites
    const stage = value.state === 'queued' ? 'queued-persisted' : value.state === 'uncertain' && uncertainWrites === 2 ? 'lost-reply-persisted' : null
    if (stage && input.stopAt === stage) {
      console.log(JSON.stringify({ type: 'checkpoint', stage }))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    }
  } },
}
const slot = { type: 'service_oauth' as const, workspaceId: localId, name: PROJECT_CREATE_INTENT_CREDENTIAL_NAME }
try {
  let mutation: unknown = null
  if (mode === 'get-scope-race') {
    let current = true
    const before = await ports.credentials.get(slot)
    const gated: ProjectAuthorityStoragePorts = { ...ports, credentials: { ...ports.credentials,
      get: async id => {
        const value = await ports.credentials.get(id)
        if (id.name === PROJECT_CREATE_INTENT_CREDENTIAL_NAME) current = false
        return value
      },
    } }
    const result = await storedLicenseAuditIntent(localId, 'get', undefined, () => current, gated)
    const after = await ports.credentials.get(slot)
    console.log(JSON.stringify({ type: 'result', result, preserved: JSON.stringify(before) === JSON.stringify(after), scopeChanged: !current }))
    process.exit(0)
  }
  if (mode === 'seed-login') {
    const configuration: StoredConfig = { workspaces: [{ id: localId, slug: localId, name: 'Actual offline fixture',
      rootPath: join(profile, 'workspace'), createdAt: Date.now() }], activeWorkspaceId: localId, activeSessionId: null }
    ports.saveConfig(configuration)
    mutation = await connectStoredProjectAuthority(localId, input.loginInput, () => true, ports)
  } else if (mode === 'login' || mode === 'wrong-login') {
    mutation = await connectStoredProjectAuthority(localId, input.loginInput, () => true, ports)
  } else if (mode === 'disconnect') {
    mutation = await disconnectStoredProjectAuthority(localId, ports)
  } else if (mode === 'future-format' || mode === 'future-binding') {
    const id = mode === 'future-binding' ? { ...slot, name: PROJECT_CREATE_BINDING_CREDENTIAL_NAME } : slot
    const future = JSON.stringify({ version: 99, marker: 'UNKNOWN_FUTURE_BYTES', command: input.command })
    await ports.credentials.set(id, { tokenType: 'ROX_FUTURE_FORMAT', value: future })
    const before = await ports.credentials.get(id)
    const view = await storedLicenseAuditIntent(localId, 'get', undefined, () => true, ports)
    const queue = await storedLicenseAuditIntent(localId, 'queue', input.command, () => true, ports)
    const cancel = await storedLicenseAuditIntent(localId, 'cancel', undefined, () => true, ports)
    const after = await ports.credentials.get(id)
    console.log(JSON.stringify({ type: 'result', view, queue, cancel, preserved: JSON.stringify(before) === JSON.stringify(after) }))
    process.exit(0)
  }
  if (mode === 'identity-probes') {
    const target = await resolveStoredProjectAuthority(localId, ports)
    if (!target) throw new Error('MISSING_ACTUAL_AUTHORITY')
    const origin = target.url.replace(/^ws/, 'http')
    const get = async (path: string) => {
      const response = await fetch(origin + path, { headers: { Authorization: 'Bearer ' + target.token } })
      const parsed: unknown = await response.json()
      return { status: response.status, value: parsed }
    }
    const own = await get('v1/workspaces/' + target.workspaceId + '/identity')
    const forged = await get('v1/workspaces/' + target.workspaceId + '/identity?principalId=' + string(input.ownerId))
    const foreign = await get('v1/workspaces/' + string(input.foreignWorkspace) + '/identity')
    console.log(JSON.stringify({ type: 'result', own, forged, foreign })); process.exit(0)
  }
  let transportState: string | null = null
  if (mode === 'transport') {
    const connection = new ProjectAuthorityConnection(id => resolveStoredProjectAuthority(id, ports))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const settled = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('REAL_TRANSPORT_DID_NOT_SETTLE')), 12000)
        connection.subscribe(() => {
          if (['ready', 'denied', 'unavailable'].includes(connection.getState())) { transportState = connection.getState(); resolve() }
        })
      })
      await connection.setWorkspace(localId); await settled
    } finally { if (timer) clearTimeout(timer); connection.destroy() }
  }
  if (mode === 'mismatched-operation-codec') {
    const original = await ports.credentials.get(slot)
    if (!original) throw new Error('MISSING_ACTUAL_PENDING')
    const mismatched = { ...original, tokenType: 'ROX_PROJECT_CREATE_INTENT_V1' }
    await ports.credentials.set(slot,mismatched)
    const before = await ports.credentials.get(slot)
    const view = await storedLicenseAuditIntent(localId,'get',undefined,()=>true,ports)
    const cancel = await storedLicenseAuditIntent(localId,'cancel',undefined,()=>true,ports)
    const after = await ports.credentials.get(slot)
    console.log(JSON.stringify({type:'result',view,cancel,preserved:JSON.stringify(before)===JSON.stringify(after)}))
    await ports.credentials.set(slot,original)
    process.exit(0)
  }
  let result: unknown = null
  if (mode === 'project-conflict') {
    const target = await resolveStoredProjectAuthority(localId, ports)
    if (!target?.workspaceName) throw new Error('MISSING_ACTUAL_AUTHORITY')
    result = await projectIntent(localId, 'queue', createSharedProjectIntent(localId, target.workspaceName, 'PRIVATE_CONFLICT_FIXTURE', 'private'), () => true, ports)
  } else if (mode === 'queue') result = await storedLicenseAuditIntent(localId, 'queue', input.command, () => true, ports)
  else if (mode === 'retry') result = await storedLicenseAuditIntent(localId, 'retry', undefined, () => true, ports)
  else if (mode === 'cancel') result = await storedLicenseAuditIntent(localId, 'cancel', undefined, () => true, ports)
  else if (mode === 'foreign-local') result = await storedLicenseAuditIntent(string(input.foreignLocalId), 'queue', input.command, () => true, ports)
  const view = await storedLicenseAuditIntent(localId, 'get', undefined, () => true, ports)
  const raw = await ports.credentials.get(slot)
  const active = await ports.credentials.get({ ...slot, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })
  let scope: unknown = null
  if (view.state === 'queued' || view.state === 'uncertain') {
    const value = raw ? object(JSON.parse(raw.value)) : null
    const binding = value ? object(value.binding) : null
    scope = binding?.scope ?? null
  }
  let plaintextLeak = false
  if (Array.isArray(input.secrets)) {
    for (const entry of await readdir(profile, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const bytes = await readFile(join(profile, entry.name))
      for (const secret of [...input.secrets, active?.value]) if (typeof secret === 'string' && bytes.includes(Buffer.from(secret))) plaintextLeak = true
    }
  }
  console.log(JSON.stringify({ type: 'result', mutation, result, view, scope, plaintextLeak, transportState,
    tokenDigest: active ? createHash('sha256').update(active.value).digest('hex') : null,
    pendingPresent: raw !== null }))
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'PROVIDER_UNAVAILABLE'
  console.log(JSON.stringify({ type: 'result', failed: true, code })); process.exitCode = 1
}
