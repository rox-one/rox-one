/** OS-protected custody for imported-password vault keys. No plaintext fallback. */
import { chmodSync, closeSync, constants, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface BrowserCredentialSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

export function createBrowserCredentialVaultKeyStore(options: {
  directory: string
  safeStorage: BrowserCredentialSafeStorage
  platform?: NodeJS.Platform
}) {
  const platform = options.platform ?? process.platform
  const storage = options.safeStorage
  const validReference = (reference: string) => /^[a-zA-Z0-9_-]{16,160}$/.test(reference)
  function available(): boolean {
    try {
      if (!storage.isEncryptionAvailable()) return false
      if (platform === 'linux') {
        // Electron's basic_text backend is obfuscation with a hardcoded key.
        const backend = storage.getSelectedStorageBackend?.()
        return Boolean(backend && backend !== 'basic_text' && backend !== 'unknown')
      }
      return platform === 'darwin' || platform === 'win32'
    } catch { return false }
  }
  function fileFor(reference: string): string | null {
    return validReference(reference) ? join(options.directory, `${reference}.enc`) : null
  }

  function storeKey(reference: string, key: Buffer): boolean {
    const file = fileFor(reference)
    if (!file || key.length !== 32 || !available()) return false
    let sealed: Buffer | null = null
    const pending = join(options.directory, `.pending-${randomUUID()}`)
    try {
      if (existsSync(file)) return false
      sealed = storage.encryptString(key.toString('hex'))
      if (sealed.length === 0) return false
      mkdirSync(options.directory, { recursive: true, mode: 0o700 })
      if (lstatSync(options.directory).isSymbolicLink()) return false
      chmodSync(options.directory, 0o700)
      writeFileSync(pending, sealed, { mode: 0o600, flag: 'wx' })
      chmodSync(pending, 0o600)
      // Atomic, exclusive publication: another process cannot replace a key
      // between an existence check and rename. Both files share this directory.
      linkSync(pending, file)
      return true
    } catch { return false }
    finally {
      sealed?.fill(0)
      try { rmSync(pending, { force: true }) } catch { /* A failed write is not a grant. */ }
    }
  }

  function readKey(reference: string): Buffer | null {
    const file = fileFor(reference)
    if (!file || !available()) return null
    let sealed: Buffer | null = null
    let descriptor: number | null = null
    try {
      if (lstatSync(options.directory).isSymbolicLink()) return null
      // Validate and read the same opened object. A path can be replaced after
      // lstat; O_NOFOLLOW rejects a substituted final-component symlink.
      descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = fstatSync(descriptor)
      const current = lstatSync(file)
      if (!info.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino || info.size > 16_384) return null
      // Bound allocation and detect growth after fstat without reopening a path.
      sealed = Buffer.alloc(16_385)
      const length = readSync(descriptor, sealed, 0, sealed.length, 0)
      if (length > 16_384) return null
      sealed = sealed.subarray(0, length)
      const value = storage.decryptString(sealed)
      return /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null
    } catch { return null }
    finally {
      sealed?.fill(0)
      if (descriptor !== null) closeSync(descriptor)
    }
  }

  /** Does not unlock/decrypt OS storage, and fails closed on ambiguous errors. */
  function deleteKey(reference: string): boolean {
    const file = fileFor(reference)
    if (!file) return false
    try {
      if (lstatSync(options.directory).isSymbolicLink()) return false
      const info = lstatSync(file)
      if (!info.isFile() || info.isSymbolicLink()) return false
      rmSync(file)
      return true
    } catch (error) {
      return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    }
  }

  return { available, storeKey, readKey, deleteKey }
}
