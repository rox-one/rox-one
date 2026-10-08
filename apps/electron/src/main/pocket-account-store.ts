/** OS-backed Pocket credentials. safeStorage uses Keychain (Mac) / DPAPI (Win). */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, mkdirSync, lstatSync, openSync, fstatSync, fsyncSync, readFileSync, readSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PocketAccountStore, PocketAccountRecord } from '@rox/shared/auth'
import type { RoxCloudOwner } from '@rox/shared/credentials'
import type { BrowserCredentialSafeStorage } from './browser-credential-vault-keys'

// Windows fallback used when Electron safeStorage is unavailable (no OS key
// material): DPAPI CurrentUser scope, driven through a short-lived PowerShell
// child. The marker lets us tell DPAPI-sealed files apart from safeStorage ones.
const DPAPI_PREFIX = Buffer.from('ROXDPAPI1:')
const DPAPI_TIMEOUT_MS = 15_000
const DPAPI_MAX_OUTPUT = 4 * 1024 * 1024
const DPAPI_PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$stdin = [System.IO.MemoryStream]::new()',
  '[Console]::OpenStandardInput().CopyTo($stdin)',
  '$plain = $stdin.ToArray()',
  '$sealed = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([System.Convert]::ToBase64String($sealed))',
].join('\n')
const DPAPI_UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$stdin = [System.IO.MemoryStream]::new()',
  '[Console]::OpenStandardInput().CopyTo($stdin)',
  '$sealed = $stdin.ToArray()',
  '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([System.Convert]::ToBase64String($plain))',
].join('\n')

function runDpapi(script: string, input: Buffer): Buffer {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input,
    encoding: 'utf8',
    timeout: DPAPI_TIMEOUT_MS,
    maxBuffer: DPAPI_MAX_OUTPUT,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error('dpapi operation failed')
  const output = (result.stdout ?? '').trim()
  if (!output) throw new Error('dpapi operation failed')
  const decoded = Buffer.from(output, 'base64')
  if (!decoded.length) throw new Error('dpapi operation failed')
  return decoded
}

export function createPocketAccountStore(options: { directory: string; safeStorage: BrowserCredentialSafeStorage; platform?: NodeJS.Platform }): PocketAccountStore {
  const storage = options.safeStorage, platform = options.platform ?? process.platform
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const callerId = (caller: RoxCloudOwner) => hash([caller.issuer, caller.subject])
  const accountId = (caller: RoxCloudOwner, account: string) => hash([caller.issuer, caller.subject, account])
  const ready = () => {
    if (!['darwin', 'win32'].includes(platform)) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
    // win32 without safeStorage falls back to DPAPI over PowerShell; other
    // platforms have no fallback and must fail closed.
    if (!storage.isEncryptionAvailable() && platform !== 'win32') throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    if (lstatSync(options.directory).isSymbolicLink()) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
  const seal = (plaintext: string): Buffer => {
    if (storage.isEncryptionAvailable()) return storage.encryptString(plaintext)
    if (platform === 'win32') return Buffer.concat([DPAPI_PREFIX, runDpapi(DPAPI_PROTECT_SCRIPT, Buffer.from(plaintext, 'utf8'))])
    throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
  const open = (sealed: Buffer): string => {
    if (sealed.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) return runDpapi(DPAPI_UNPROTECT_SCRIPT, sealed.subarray(DPAPI_PREFIX.length)).toString('utf8')
    return storage.decryptString(sealed)
  }
  const read = (id: string): any => {
    ready(); let fd: number | undefined
    let stage: 'open' | 'inspect' | 'read' | 'decrypt' | 'parse' = 'open'
    try {
      fd = openSync(join(options.directory, `${id}.enc`), constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0))
      stage = 'inspect'
      const info = fstatSync(fd)
      if (!info.isFile() || info.size > 256_000) throw new Error('invalid secure store')
      // Reads stay bounded to the captured regular-file descriptor. Opening a
      // FIFO must never block account state or logout on the main process.
      stage = 'read'
      const sealed = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < sealed.length) {
        const count = readSync(fd, sealed, length, sealed.length - length, null)
        if (count === 0) break
        length += count
      }
      const after = fstatSync(fd)
      if (length !== info.size || after.dev !== info.dev || after.ino !== info.ino
        || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('changed secure store')
      try {
        stage = 'decrypt'
        const plaintext = open(sealed.subarray(0, length))
        stage = 'parse'
        return JSON.parse(plaintext)
      }
      finally { sealed.fill(0) }
    } catch (error) {
      if (stage === 'open' && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      // Bounded metadata identifies the failure without leaking the OS exception or ciphertext.
      throw Object.assign(new Error('ROX_SECURE_STORE_READ_FAILED'), { code: `secure_store_${stage}_failed` })
    } finally { if (fd !== undefined) closeSync(fd) }
  }
  const write = (id: string, value: unknown) => {
    ready(); const pending = join(options.directory, `.pending-${randomUUID()}`)
    let sealed: Buffer | undefined
    try { sealed = seal(JSON.stringify(value)); if (!sealed.length) throw Error(); writeFileSync(pending, sealed, { mode: 0o600, flag: 'wx' });
      // Windows FlushFileBuffers requires a handle with GENERIC_WRITE access.
      // O_WRONLY preserves the existing file and no-follow check without truncation.
      const descriptor = openSync(pending, constants.O_WRONLY | constants.O_NOFOLLOW); try { fsyncSync(descriptor) } finally { closeSync(descriptor) }; renameSync(pending, join(options.directory, `${id}.enc`)); if (platform !== 'win32') { const directory = openSync(options.directory, constants.O_RDONLY); try { fsyncSync(directory) } finally { closeSync(directory) } } }
    catch { throw new Error('ROX_SECURE_STORE_WRITE_FAILED') }
    finally { sealed?.fill(0); rmSync(pending, { force: true }) }
  }
  return {
    async readLogout(caller) { return read(hash(['logout', caller.issuer, caller.subject])) },
    async writeLogout(caller, record) { write(hash(['logout', caller.issuer, caller.subject]), { accountId: record.accountId, accessToken: record.accessToken, refreshToken: record.refreshToken, refreshId: record.refreshId }) },
    async clearLogout(caller) { ready(); rmSync(join(options.directory, `${hash(['logout', caller.issuer, caller.subject])}.enc`), { force: true }) },
    async readBinding(resource) { return read(hash(['resource', resource])) },
    async writeBinding(resource, binding) { write(hash(['resource', resource]), binding) },
    async read(caller) {
      const pointer = read(callerId(caller))
      if (!pointer) return null
      if (typeof pointer.accountId !== 'string') throw new Error('ROX_SECURE_STORE_READ_FAILED')
      const record = read(accountId(caller, pointer.accountId)) as PocketAccountRecord | null
      if (!record || record.accountId !== pointer.accountId || !record.accessToken || !record.refreshToken || !record.authGeneration) throw new Error('ROX_SECURE_STORE_READ_FAILED')
      return record
    },
    async write(caller, record) { write(accountId(caller, record.accountId), record); write(callerId(caller), { accountId: record.accountId }) },
    async clear(caller) { ready(); const pointer = read(callerId(caller)); rmSync(join(options.directory, `${callerId(caller)}.enc`), { force: true }); if (typeof pointer?.accountId === 'string') rmSync(join(options.directory, `${accountId(caller, pointer.accountId)}.enc`), { force: true }) },
  }
}
