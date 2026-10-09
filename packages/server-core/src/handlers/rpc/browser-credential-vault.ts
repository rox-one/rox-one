import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { BrowserCredentialHost, BrowserCredentialAccess } from '@rox/shared/browser/browser-credential-host'
import type { DiscoveredProfile, ProtectedCredentialImport } from '@rox/shared/browser/profile-import'
import { sealNativeBrowserCredentials } from '@rox/shared/browser/profile-native-credentials'
import { openBrowserCredentialEnvelope } from './keeper'

/** Decryption and sealing stay inside the privileged host process. */
export async function prepareBrowserCredentialImport(input: {
  host: BrowserCredentialHost
  workspaceId: string
  webContentsId?: number
  platform?: NodeJS.Platform
  profile: DiscoveredProfile
  seal?: typeof sealNativeBrowserCredentials
}): Promise<{
  status: BrowserCredentialAccess['status']
  protectedCredentials?: ProtectedCredentialImport
  dispose(): void
}> {
  const { host, profile, workspaceId } = input
  if (!host.vaultKeys.available() || !host.capabilities(profile).supported) {
    return { status: 'unsupported', dispose() {} }
  }
  let grant: BrowserCredentialAccess
  try { grant = await host.requestAccess({ profile, workspaceId, webContentsId: input.webContentsId }) }
  catch { return { status: 'unavailable', dispose() {} } }
  if (grant.status !== 'granted') return { status: grant.status, dispose() {} }
  const key = randomBytes(32)
  try {
    if (grant.profileId !== profile.id || resolve(grant.profilePath) !== resolve(profile.path) || grant.workspaceId !== workspaceId) {
      throw new Error('browser-credentials-profile-not-authorized')
    }
    const sealed = await (input.seal ?? sealNativeBrowserCredentials)(profile, grant, key, { platform: input.platform })
    const scope = createHash('sha256').update(JSON.stringify([workspaceId, profile.id])).digest('hex').slice(0, 20)
    const reference = `credential-${scope}-${randomUUID()}`
    let stored = false
    return {
      status: 'granted',
      protectedCredentials: {
        ...sealed,
        keyReference: reference,
        storeKey() {
          if (stored) return reference
          try { if (!host.vaultKeys.storeKey(reference, key)) return null }
          catch { return null }
          stored = true
          return reference
        },
        deleteKey(reference) { try { return host.vaultKeys.deleteKey(reference) } catch { return false } },
      },
      dispose() { key.fill(0); grant.release() },
    }
  } catch (error) {
    key.fill(0)
    grant.release()
    // Raw helper errors can contain OS diagnostics. Only stable safe errors escape.
    if (error instanceof Error && /^browser-credentials-[a-z-]+$/.test(error.message)) throw error
    throw new Error('browser-credentials-read-failed')
  }
}

/** One plaintext login handed to the Keeper import; never persisted by this module. */
export interface KeeperBrowserCredentialItem {
  /** Vault-key slug derived from the origin/username (see {@link keeperExportKey}). */
  key: string
  origin: string
  username: string
  password: string
}

export interface KeeperBrowserCredentialExport {
  status: BrowserCredentialAccess['status']
  items: KeeperBrowserCredentialItem[]
  /** Rows the sealed envelope held that were dropped: duplicates, empty, or over the cap. */
  skipped: number
}

/** Upper bound on items returned by a single export, independent of the stored envelope. */
export const KEEPER_EXPORT_MAX_ITEMS = 2000
const KEEPER_KEY_MAX = 120

function slugSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
}

/**
 * Derive the Keeper item key for one browser login: `slug(origin)-slug(username)`,
 * capped at 120 chars (the Infisical secret-name limit). A collision with an
 * already-taken key gains a numeric suffix. Pure; `taken` is not mutated — the
 * caller records the returned key.
 */
export function keeperExportKey(origin: string, username: string, taken: ReadonlySet<string> = new Set()): string {
  const parts = [slugSegment(origin), slugSegment(username)].filter((part) => part !== '')
  let base = parts.join('-').slice(0, KEEPER_KEY_MAX).replace(/^[-._]+|[-._]+$/g, '')
  if (base === '') base = 'login'
  if (!taken.has(base)) return base
  let suffix = 2
  for (;;) {
    const tail = `-${suffix}`
    const candidate = `${base.slice(0, KEEPER_KEY_MAX - tail.length).replace(/[-._]+$/g, '')}${tail}`
    if (!taken.has(candidate)) return candidate
    suffix += 1
  }
}

/**
 * Reopen the workspace's sealed browser-credential envelope in the host process
 * and hand Keeper a bounded, de-duplicated list of logins. Gated by the exact
 * same native grant/OS consent as {@link prepareBrowserCredentialImport}: the
 * renderer cannot manufacture access, the vault key never leaves this process,
 * and no plaintext is logged.
 */
export async function exportBrowserCredentialsForKeeper(input: {
  host: BrowserCredentialHost
  workspaceId: string
  webContentsId?: number
  profile: DiscoveredProfile
  /** Reads the persisted sealed envelope (e.g. `browser/credential-vault.json`). */
  readSealedEnvelope: () => string | null
  /** Reads the OS-custody reference recorded at import time (e.g. `credentialKeyRef`). */
  readKeyReference: () => string | null
  /** Reads the OS-protected vault key for a reference; null = custody unavailable. */
  readVaultKey: (reference: string) => Buffer | null
  limit?: number
}): Promise<KeeperBrowserCredentialExport> {
  const { host, workspaceId, profile } = input
  if (!host.vaultKeys.available()) return { status: 'unsupported', items: [], skipped: 0 }
  let grant: BrowserCredentialAccess
  try { grant = await host.requestAccess({ profile, workspaceId, webContentsId: input.webContentsId }) }
  catch { return { status: 'unavailable', items: [], skipped: 0 } }
  if (grant.status !== 'granted') return { status: grant.status, items: [], skipped: 0 }
  let key: Buffer | null = null
  try {
    if (grant.profileId !== profile.id || resolve(grant.profilePath) !== resolve(profile.path) || grant.workspaceId !== workspaceId) {
      throw new Error('browser-credentials-profile-not-authorized')
    }
    const reference = input.readKeyReference()
    if (!reference) return { status: 'granted', items: [], skipped: 0 }
    key = input.readVaultKey(reference)
    if (!key) return { status: 'granted', items: [], skipped: 0 }
    const sealedText = input.readSealedEnvelope()
    if (!sealedText) return { status: 'granted', items: [], skipped: 0 }
    const { records } = openBrowserCredentialEnvelope(sealedText, key)
    const limit = Math.max(0, Math.min(input.limit ?? KEEPER_EXPORT_MAX_ITEMS, KEEPER_EXPORT_MAX_ITEMS))
    const seen = new Set<string>()
    const keys = new Set<string>()
    const items: KeeperBrowserCredentialItem[] = []
    let skipped = 0
    for (const record of records) {
      if (items.length >= limit) { skipped += 1; continue }
      const origin = record.origin
      const username = record.username
      const fingerprint = `${origin.toLowerCase()}\u0000${username}`
      if (seen.has(fingerprint) || record.password === '' || origin === '') { skipped += 1; continue }
      seen.add(fingerprint)
      const itemKey = keeperExportKey(origin, username, keys)
      keys.add(itemKey)
      items.push({ key: itemKey, origin, username, password: record.password })
    }
    return { status: 'granted', items, skipped }
  } catch (error) {
    // Raw helper errors can contain OS diagnostics. Only stable safe errors escape.
    if (error instanceof Error && /^browser-credentials-[a-z-]+$/.test(error.message)) throw error
    throw new Error('browser-credentials-read-failed')
  } finally {
    key?.fill(0)
    grant.release()
  }
}
