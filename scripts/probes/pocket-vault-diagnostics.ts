import { constants, openSync, closeSync, fsyncSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const VAULT_STAGES = ['initialize', 'bundle', 'encryption_available', 'fsync_fixture', 'account_write', 'logout_write', 'binding_write', 'plaintext_scan', 'hash_write', 'expected_read', 'ciphertext_readback', 'account_read', 'logout_read', 'binding_read', 'account_clear', 'logout_clear', 'clear_readback', 'complete'] as const
export type VaultStage = typeof VAULT_STAGES[number]
const knownCodes = new Set(['EACCES', 'EPERM', 'EBADF', 'EINVAL', 'EIO', 'ENOSYS', 'ENOENT', 'EEXIST', 'ENOSPC', 'EROFS', 'ROX_OS_SECURE_STORAGE_UNAVAILABLE', 'ROX_SECURE_STORE_READ_FAILED', 'ROX_SECURE_STORE_WRITE_FAILED', 'plaintext_fixture_in_sealed_store', 'native_store_restart_readback_failed', 'native_store_clear_readback_failed', 'native_fsync_writable_failed', 'native_probe_bundle_failed', 'native_probe_receipt_missing', 'native_process_failed', 'unknown'])
for (const stage of ['open', 'inspect', 'read', 'decrypt', 'parse']) knownCodes.add(`secure_store_${stage}_failed`)
knownCodes.add('ciphertext_fixture_readback_failed')
export function safeVaultErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }
    if (typeof value.code === 'string' && knownCodes.has(value.code)) return value.code
    if (typeof value.message === 'string' && knownCodes.has(value.message)) return value.message
  }
  return 'unknown'
}
export interface FsyncDiagnostic { access: 'readonly' | 'writable'; opened: boolean; flushed: boolean; code: string | null }
export function nativeFsyncFixture(directory: string): FsyncDiagnostic[] {
  const path = join(directory, 'fsync-fixture')
  writeFileSync(path, Buffer.from('synthetic filesystem metadata only'), { flag: 'wx', mode: 0o600 })
  try {
    return (['readonly', 'writable'] as const).map(access => {
      let fd: number | undefined, opened = false
      try {
        fd = openSync(path, (access === 'readonly' ? constants.O_RDONLY : constants.O_WRONLY) | constants.O_NOFOLLOW)
        opened = true
        fsyncSync(fd)
        return { access, opened, flushed: true, code: null }
      } catch (error) { return { access, opened, flushed: false, code: safeVaultErrorCode(error) } }
      finally { if (fd !== undefined) closeSync(fd) }
    })
  } finally { rmSync(path, { force: true }) }
}
/** Project child JSON; never forward raw stdout, stderr, paths, messages or extra fields. */
export function projectNativeVaultReceipt(value: unknown, phase: 'write' | 'read', expectedPlatform: NodeJS.Platform = process.platform) {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.phase !== phase || typeof v.passed !== 'boolean' || !['darwin', 'win32'].includes(String(v.platform)) || v.platform !== expectedPlatform) return null
  const fsync = Array.isArray(v.fsync) ? v.fsync.slice(0, 2).flatMap(entry => {
    if (!entry || typeof entry !== 'object' || !['readonly', 'writable'].includes(entry.access)) return []
    return [{ access: entry.access as FsyncDiagnostic['access'], opened: entry.opened === true, flushed: entry.flushed === true, code: entry.code === null ? null : safeVaultErrorCode({ code: entry.code }) }]
  }) : []
  const electron = typeof v.electron === 'string' && /^[1-9]\d*\.\d+\.\d+$/.test(v.electron) ? v.electron : 'unknown'
  if (v.passed && (v.stage !== 'complete' || v.encryptionAvailable !== true || v.code !== null || electron === 'unknown' || !fsync.some(entry => entry.access === 'writable' && entry.opened && entry.flushed && entry.code === null))) return null
  return { phase, platform: v.platform as 'darwin' | 'win32', electron, encryptionAvailable: v.encryptionAvailable === true, backend: v.platform === 'darwin' ? 'Keychain' : 'DPAPI', stage: typeof v.stage === 'string' && (VAULT_STAGES as readonly string[]).includes(v.stage) ? v.stage : 'initialize', passed: v.passed, code: v.passed ? null : safeVaultErrorCode({ code: v.code }), fsync }
}
