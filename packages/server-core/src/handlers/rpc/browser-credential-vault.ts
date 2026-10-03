import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { BrowserCredentialHost, BrowserCredentialAccess } from '@rox/shared/browser/browser-credential-host'
import type { DiscoveredProfile, ProtectedCredentialImport } from '@rox/shared/browser/profile-import'
import { sealNativeBrowserCredentials } from '@rox/shared/browser/profile-native-credentials'

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
