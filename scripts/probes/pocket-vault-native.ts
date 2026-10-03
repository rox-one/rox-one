/** Headless Electron proof of the actual store with Keychain/DPAPI, across restart. */
import { app, safeStorage } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPocketAccountStore } from '../../apps/electron/src/main/pocket-account-store'

const [phase, directory] = process.argv.slice(2)
if (typeof phase !== 'string' || !['write', 'read'].includes(phase) || !directory) throw new Error('invalid_probe_arguments')
mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setName('ROX SSO Native Vault Probe')
const profile = join(directory, 'electron-profile')
mkdirSync(profile, { recursive: true, mode: 0o700 })
app.setPath('userData', profile)
const caller = { issuer: 'rox:native-vault-probe', subject: 'isolated-fixture' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

app.whenReady().then(async () => {
  if (!['darwin', 'win32'].includes(process.platform) || !safeStorage.isEncryptionAvailable()) {
    throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
  const storePath = join(directory, 'sealed-store')
  const store = createPocketAccountStore({ directory: storePath, safeStorage })
  const proofPath = join(directory, 'expected-hashes.json')
  if (phase === 'write') {
    const secret = () => randomBytes(32).toString('hex')
    const record = { accountId: randomUUID(), accessToken: secret(), refreshToken: secret(), authGeneration: randomUUID(), expiresAt: Date.now() + 900_000 }
    const logout = { accountId: record.accountId, accessToken: record.accessToken, refreshToken: record.refreshToken, refreshId: randomUUID() }
    const binding = { caller, accountId: record.accountId, authGeneration: record.authGeneration }
    await store.write(caller, record)
    await store.writeLogout(caller, logout)
    await store.writeBinding!('native-probe-resource', binding)
    for (const file of readdirSync(storePath)) {
      const bytes = readFileSync(join(storePath, file))
      if (bytes.includes(record.accessToken) || bytes.includes(record.refreshToken)) throw new Error('plaintext_fixture_in_sealed_store')
    }
    writeFileSync(proofPath, JSON.stringify({ record: digest(record), logout: digest(logout), binding: digest(binding) }), { mode: 0o600 })
  } else {
    const expected = JSON.parse(readFileSync(proofPath, 'utf8'))
    if (digest(await store.read(caller)) !== expected.record || digest(await store.readLogout(caller)) !== expected.logout || digest(await store.readBinding!('native-probe-resource')) !== expected.binding) throw new Error('native_store_restart_readback_failed')
    await store.clear(caller)
    await store.clearLogout(caller)
    if (await store.read(caller) !== null || await store.readLogout(caller) !== null) throw new Error('native_store_clear_readback_failed')
  }
  console.log(JSON.stringify({ phase, platform: process.platform, electron: process.versions.electron, encryptionAvailable: true, backend: process.platform === 'darwin' ? 'Keychain' : 'DPAPI', passed: true }))
  app.exit(0)
}).catch(() => { console.error('native_pocket_vault_probe_failed'); app.exit(1) })
