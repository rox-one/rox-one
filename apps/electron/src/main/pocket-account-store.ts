/** OS-backed Pocket credentials. safeStorage uses Keychain (Mac) / DPAPI (Win). */
import { createHash, randomUUID } from 'node:crypto'
import { constants, mkdirSync, lstatSync, openSync, fstatSync, fsyncSync, readFileSync, readSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PocketAccountStore, PocketAccountRecord } from '@rox/shared/auth'
import type { RoxCloudOwner } from '@rox/shared/credentials'
import type { BrowserCredentialSafeStorage } from './browser-credential-vault-keys'
export function createPocketAccountStore(options: { directory: string; safeStorage: BrowserCredentialSafeStorage; platform?: NodeJS.Platform }): PocketAccountStore {
  const storage = options.safeStorage, platform = options.platform ?? process.platform
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const callerId = (caller: RoxCloudOwner) => hash([caller.issuer, caller.subject])
  const accountId = (caller: RoxCloudOwner, account: string) => hash([caller.issuer, caller.subject, account])
  const ready = () => {
    if (!['darwin', 'win32'].includes(platform) || !storage.isEncryptionAvailable()) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    if (lstatSync(options.directory).isSymbolicLink()) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
  const read = (id: string): any => {
    ready(); let fd: number | undefined
    try {
      fd = openSync(join(options.directory, `${id}.enc`), constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0))
      const info = fstatSync(fd)
      if (!info.isFile() || info.size > 256_000) throw new Error('invalid secure store')
      // Reads stay bounded to the captured regular-file descriptor. Opening a
      // FIFO must never block account state or logout on the main process.
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
      try { return JSON.parse(storage.decryptString(sealed.subarray(0, length))) }
      finally { sealed.fill(0) }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw new Error('ROX_SECURE_STORE_READ_FAILED')
    } finally { if (fd !== undefined) closeSync(fd) }
  }
  const write = (id: string, value: unknown) => {
    ready(); const pending = join(options.directory, `.pending-${randomUUID()}`)
    let sealed: Buffer | undefined
    try { sealed = storage.encryptString(JSON.stringify(value)); if (!sealed.length) throw Error(); writeFileSync(pending, sealed, { mode: 0o600, flag: 'wx' });
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
