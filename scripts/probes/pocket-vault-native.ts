/** Headless Electron proof of the actual store with Keychain/DPAPI, across restart. */
import { app, safeStorage } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeFsyncFixture, safeVaultErrorCode, type VaultStage, type FsyncDiagnostic } from './pocket-vault-diagnostics'
import { createPocketAccountStore } from '../../apps/electron/src/main/pocket-account-store'

const [phase, directory] = process.argv.slice(2)
if (typeof phase !== 'string' || !['write', 'read'].includes(phase) || !directory) throw new Error('invalid_probe_arguments')
mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setName('ROX SSO Native Vault Probe')
const profile = join(directory, 'electron-profile')
mkdirSync(profile, { recursive: true, mode: 0o700 })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const profileIsolated = app.getPath('userData') === profile && app.getPath('sessionData') === profile
const caller = { issuer: 'rox:native-vault-probe', subject: 'isolated-fixture' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const encryptedFiles = (path: string) => Object.fromEntries(readdirSync(path).sort().map(file => [file, createHash('sha256').update(readFileSync(join(path, file))).digest('hex')]))

let stage: VaultStage = 'initialize'
let encryptionAvailable = false
let fsync: FsyncDiagnostic[] = []
const receipt = (passed: boolean, error?: unknown) => ({ phase, platform: process.platform, electron: process.versions.electron, encryptionAvailable, profileIsolated, backend: process.platform === 'darwin' ? 'Keychain' : 'DPAPI', stage, passed, code: passed ? null : safeVaultErrorCode(error), fsync })
app.whenReady().then(async () => {
  if (!profileIsolated) throw new Error('native_profile_not_isolated')
  stage = 'encryption_available'
  encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (!['darwin', 'win32'].includes(process.platform) || !encryptionAvailable) {
    throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
  stage = 'fsync_fixture'
  fsync = nativeFsyncFixture(directory)
  if (!fsync.find(result => result.access === 'writable')?.flushed) throw new Error('native_fsync_writable_failed')
  const storePath = join(directory, 'sealed-store')
  const store = createPocketAccountStore({ directory: storePath, safeStorage })
  const proofPath = join(directory, 'expected-hashes.json')
  if (phase === 'write') {
    const secret = () => randomBytes(32).toString('hex')
    const record = { accountId: randomUUID(), accessToken: secret(), refreshToken: secret(), authGeneration: randomUUID(), expiresAt: Date.now() + 900_000 }
    const logout = { accountId: record.accountId, accessToken: record.accessToken, refreshToken: record.refreshToken, refreshId: randomUUID() }
    const binding = { caller, accountId: record.accountId, authGeneration: record.authGeneration }
    stage = 'account_write'
    await store.write(caller, record)
    stage = 'logout_write'
    await store.writeLogout(caller, logout)
    stage = 'binding_write'
    await store.writeBinding!('native-probe-resource', binding)
    stage = 'plaintext_scan'
    for (const file of readdirSync(storePath)) {
      const bytes = readFileSync(join(storePath, file))
      if (bytes.includes(record.accessToken) || bytes.includes(record.refreshToken)) throw new Error('plaintext_fixture_in_sealed_store')
    }
    stage = 'hash_write'
    writeFileSync(proofPath, JSON.stringify({ record: digest(record), logout: digest(logout), binding: digest(binding), ciphertext: digest(encryptedFiles(storePath)) }), { mode: 0o600 })
  } else {
    stage = 'expected_read'
    const expected = JSON.parse(readFileSync(proofPath, 'utf8'))
    stage = 'ciphertext_readback'
    if (digest(encryptedFiles(storePath)) !== expected.ciphertext) throw new Error('ciphertext_fixture_readback_failed')
    stage = 'account_read'
    if (digest(await store.read(caller)) !== expected.record) throw new Error('native_store_restart_readback_failed')
    stage = 'logout_read'
    if (digest(await store.readLogout(caller)) !== expected.logout) throw new Error('native_store_restart_readback_failed')
    stage = 'binding_read'
    if (digest(await store.readBinding!('native-probe-resource')) !== expected.binding) throw new Error('native_store_restart_readback_failed')
    stage = 'account_clear'
    await store.clear(caller)
    stage = 'logout_clear'
    await store.clearLogout(caller)
    stage = 'clear_readback'
    if (await store.read(caller) !== null || await store.readLogout(caller) !== null) throw new Error('native_store_clear_readback_failed')
  }
  stage = 'complete'
  console.log(JSON.stringify(receipt(true)))
  // Windows ready may precede the native main message loop. An immediate exit
  // can bypass Chromium's Local State commit containing the DPAPI-wrapped key.
  // Graceful quit lets Electron finish startup and flush its native preferences.
  app.quit()
}).catch(error => { console.log(JSON.stringify(receipt(false, error))); app.exit(1) })
