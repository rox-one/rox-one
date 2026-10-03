/** OS-backed Pocket credentials. safeStorage uses Keychain (Mac) / DPAPI (Win). */
import { createHash, randomUUID } from 'node:crypto'
import { constants, mkdirSync, lstatSync, openSync, fstatSync, fsyncSync, readFileSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs'
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
      fd = openSync(join(options.directory, `${id}.enc`), constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = fstatSync(fd)
      if (!info.isFile() || info.size > 256_000) throw new Error('invalid secure store')
      return JSON.parse(storage.decryptString(readFileSync(fd)))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw new Error('ROX_SECURE_STORE_READ_FAILED')
    } finally { if (fd !== undefined) closeSync(fd) }
  }
  const write = (id: string, value: unknown) => {
    ready(); const pending = join(options.directory, `.pending-${randomUUID()}`)
    let sealed: Buffer | undefined
    try { sealed = storage.encryptString(JSON.stringify(value)); if (!sealed.length) throw Error(); writeFileSync(pending, sealed, { mode: 0o600, flag: 'wx' }); const descriptor = openSync(pending, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(descriptor) } finally { closeSync(descriptor) }; renameSync(pending, join(options.directory, `${id}.enc`)); if (platform !== 'win32') { const directory = openSync(options.directory, constants.O_RDONLY); try { fsyncSync(directory) } finally { closeSync(directory) } } }
    catch { throw new Error('ROX_SECURE_STORE_WRITE_FAILED') }
    finally { sealed?.fill(0); rmSync(pending, { force: true }) }
  }
  return {
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
