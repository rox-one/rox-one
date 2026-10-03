import type { DiscoveredProfile } from './profile-import.ts'

/** Host-owned capabilities. Renderer preferences never manufacture a grant. */
export type BrowserCredentialMechanism = 'macos-keychain' | 'linux-secret-service' | 'windows-dpapi'
export interface BrowserCredentialCapability {
  supported: boolean
  mechanism: BrowserCredentialMechanism | null
  reason?: string
}
export interface BrowserCredentialGrant {
  status: 'granted'
  profileId: string
  profilePath: string
  workspaceId: string
  mechanism: BrowserCredentialMechanism
  key: Buffer | null
  decryptWindows?: (blob: Uint8Array) => Promise<Buffer>
  release(): void
}
export type BrowserCredentialAccess = BrowserCredentialGrant | {
  status: 'denied' | 'cancelled' | 'unavailable' | 'unsupported'
  reason: string
}
export interface BrowserCredentialHost {
  capabilities(profile: DiscoveredProfile): BrowserCredentialCapability
  requestAccess(request: { profile: DiscoveredProfile; workspaceId: string; webContentsId?: number }): Promise<BrowserCredentialAccess>
  vaultKeys: {
    available(): boolean
    storeKey(reference: string, key: Buffer): boolean
    deleteKey(reference: string): boolean
  }
}
