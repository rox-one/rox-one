/**
 * Browser-password access is a short-lived host capability, never a renderer
 * checkbox. The native confirmation precedes every keychain/DPAPI operation.
 * These commands let the OS enforce its own lock and ACL policy; Rox cannot
 * promise that an already-unlocked keychain will display another OS prompt.
 */
import { spawn } from 'node:child_process'
import { pbkdf2Sync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import type { DiscoveredProfile } from '@craft-agent/shared/browser/profile-import'

export type BrowserCredentialMechanism = 'macos-keychain' | 'linux-secret-service' | 'windows-dpapi'
export type BrowserCredentialAccessFailure = {
  status: 'denied' | 'cancelled' | 'unavailable' | 'unsupported'
  reason: string
}
export interface BrowserCredentialCapability {
  supported: boolean
  mechanism: BrowserCredentialMechanism | null
  reason?: string
}
export interface BrowserCredentialAccessRequest {
  profile: DiscoveredProfile
  workspaceId: string
  /** Server-bound requesting desktop window; never trusted from RPC args. */
  webContentsId?: number
}
export interface BrowserCredentialAccessGrant {
  status: 'granted'
  profileId: string
  profilePath: string
  workspaceId: string
  mechanism: BrowserCredentialMechanism
  key: Buffer | null
  decryptWindows?: (blob: Uint8Array) => Promise<Buffer>
  /** Invalidates this grant and overwrites its derived key. */
  release(): void
}
export type BrowserCredentialAccess = BrowserCredentialAccessGrant | BrowserCredentialAccessFailure
export type BrowserCredentialConfirmation = 'allow' | 'deny' | 'cancel'
export interface NativeCredentialCommandOptions {
  input?: Buffer
  timeoutMs: number
  maxOutputBytes: number
}
export type NativeCredentialCommand = (
  executable: string,
  args: readonly string[],
  options: NativeCredentialCommandOptions,
) => Promise<Buffer>

interface BrowserSecretService {
  service: string
  application: string
}

/** Exact browser identities: never ask for another browser's safe-storage key. */
function secretServiceFor(profilePath: string, platform: NodeJS.Platform): BrowserSecretService | null {
  const path = profilePath.replaceAll('\\', '/').toLowerCase()
  const definitions: Array<[RegExp, string, string]> = platform === 'darwin'
    ? [
      [/\/google\/chrome(?:[^/]*)\//, 'Chrome Safe Storage', 'chrome'],
      [/\/microsoft edge(?:[^/]*)\//, 'Microsoft Edge Safe Storage', 'msedge'],
      [/\/bravesoftware\/brave-browser(?:[^/]*)\//, 'Brave Safe Storage', 'brave'],
      [/\/chromium\//, 'Chromium Safe Storage', 'chromium'],
      [/\/vivaldi\//, 'Vivaldi Safe Storage', 'vivaldi'],
      [/\/com\.operasoftware\.opera(?:[^/]*)\//, 'Opera Safe Storage', 'opera'],
      [/\/yandex\/yandexbrowser\//, 'Yandex Safe Storage', 'yandex-browser'],
    ]
    : [
      [/\/google-chrome(?:[^/]*)\//, 'Chrome Safe Storage', 'chrome'],
      [/\/microsoft-edge(?:[^/]*)\//, 'Microsoft Edge Safe Storage', 'msedge'],
      [/\/bravesoftware\/brave-browser(?:[^/]*)\//, 'Brave Safe Storage', 'brave'],
      [/\/chromium\//, 'Chromium Safe Storage', 'chromium'],
      [/\/vivaldi\//, 'Vivaldi Safe Storage', 'vivaldi'],
      [/\/opera(?:[^/]*)\//, 'Opera Safe Storage', 'opera'],
      [/\/yandex-browser\//, 'Yandex Safe Storage', 'yandex-browser'],
    ]
  for (const [pattern, service, application] of definitions) {
    if (pattern.test(`${path}/`)) return { service, application }
  }
  return null
}

const DPAPI_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$encrypted = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  'try { [Console]::Out.Write([Convert]::ToBase64String($plain)) } finally { [Array]::Clear($plain, 0, $plain.Length) }',
].join('\n')
const MAX_OUTPUT_BYTES = 1024 * 1024

/** No shell, no secrets in argv, and no child output copied into errors/logs. */
export const runNativeCredentialCommand: NativeCredentialCommand = (executable, args, options) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let settled = false
  let size = 0
  const output: Buffer[] = []
  // Stderr is used only to classify a native denial; it is never returned.
  const errors: Buffer[] = []
  let errorSize = 0
  const wipe = () => { for (const chunk of [...output, ...errors]) chunk.fill(0) }
  const fail = (reason: string) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    child.kill()
    wipe()
    reject(new Error(reason))
  }
  const timer = setTimeout(() => fail('browser-credential-access-cancelled'), options.timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) { chunk.fill(0); return }
    size += chunk.length
    if (size > options.maxOutputBytes) { chunk.fill(0); fail('browser-credential-access-unavailable'); return }
    output.push(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    if (settled || errorSize + chunk.length > 8192) { chunk.fill(0); return }
    errorSize += chunk.length
    errors.push(chunk)
  })
  child.stdin.on('error', () => fail('browser-credential-access-unavailable'))
  child.on('error', () => fail('browser-credential-access-unavailable'))
  child.on('close', (code) => {
    if (settled) return
    if (code !== 0) {
      const message = Buffer.concat(errors)
      const cancelled = /cancel|user canceled|user cancelled|-128/i.test(message.toString('utf8'))
      const denied = /denied|not allowed|authorization|authentication|authfailed|-25293/i.test(message.toString('utf8'))
      message.fill(0)
      fail(cancelled ? 'browser-credential-access-cancelled' : denied ? 'browser-credential-access-denied' : 'browser-credential-access-unavailable')
      return
    }
    settled = true
    clearTimeout(timer)
    const result = Buffer.concat(output)
    wipe()
    resolve(result)
  })
  child.stdin.end(options.input)
})

export function createBrowserCredentialPermissionAdapter(options: {
  /** Must show a host-owned native dialog, not accept a renderer attestation. */
  confirm: (request: BrowserCredentialAccessRequest & { mechanism: BrowserCredentialMechanism }) => Promise<BrowserCredentialConfirmation>
  platform?: NodeJS.Platform
  execute?: NativeCredentialCommand
  exists?: (path: string) => boolean
  windowsDirectory?: string
}) {
  const platform = options.platform ?? process.platform
  const execute = options.execute ?? runNativeCredentialCommand
  const exists = options.exists ?? existsSync
  const windowsDirectory = options.windowsDirectory ?? process.env.SystemRoot ?? 'C:\\Windows'
  const executable = platform === 'darwin' ? '/usr/bin/security'
    : platform === 'linux' ? '/usr/bin/secret-tool'
      : platform === 'win32' ? win32.join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null
  const activeRequests = new Set<string>()

  function capabilities(profile: DiscoveredProfile): BrowserCredentialCapability {
    if (profile.family !== 'chromium') return { supported: false, mechanism: null, reason: 'browser-credential-family-unsupported' }
    if (!executable) return { supported: false, mechanism: null, reason: 'browser-credential-platform-unsupported' }
    if (platform !== 'win32' && !secretServiceFor(profile.path, platform)) return { supported: false, mechanism: null, reason: 'browser-credential-browser-unsupported' }
    const mechanism = platform === 'darwin' ? 'macos-keychain' : platform === 'linux' ? 'linux-secret-service' : 'windows-dpapi'
    if (!exists(executable)) return { supported: false, mechanism, reason: 'browser-credential-native-service-unavailable' }
    return { supported: true, mechanism }
  }

  async function requestAccess(request: BrowserCredentialAccessRequest): Promise<BrowserCredentialAccess> {
    const capability = capabilities(request.profile)
    if (!capability.supported || !capability.mechanism || !executable) {
      return { status: capability.mechanism ? 'unavailable' : 'unsupported', reason: capability.reason ?? 'browser-credential-access-unsupported' }
    }
    if (!request.workspaceId.trim() || !request.profile.id || !request.profile.path) return { status: 'denied', reason: 'browser-credential-access-invalid-scope' }
    const scope = JSON.stringify([request.workspaceId, request.profile.id])
    if (activeRequests.has(scope)) return { status: 'denied', reason: 'browser-credential-access-pending' }
    activeRequests.add(scope)
    try {
      const decision = await options.confirm({ ...request, mechanism: capability.mechanism })
      if (decision !== 'allow') return { status: decision === 'deny' ? 'denied' : 'cancelled', reason: `browser-credential-access-${decision === 'deny' ? 'denied' : 'cancelled'}` }
      let key: Buffer | null = null
      let active = true
      const grant: BrowserCredentialAccessGrant = {
        status: 'granted', profileId: request.profile.id, profilePath: request.profile.path,
        workspaceId: request.workspaceId, mechanism: capability.mechanism, key,
        release() { active = false; key?.fill(0); grant.key = null },
      }
      if (platform === 'win32') {
        grant.decryptWindows = async (blob) => {
          if (!active) throw new Error('browser-credential-grant-expired')
          if (blob.length === 0 || blob.length > MAX_OUTPUT_BYTES / 2) throw new Error('browser-credential-protected-value-invalid')
          const input = Buffer.from(Buffer.from(blob).toString('base64'), 'ascii')
          let output: Buffer | null = null
          let plain: Buffer | null = null
          try {
            output = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(DPAPI_SCRIPT, 'utf16le').toString('base64')], {
              input, timeoutMs: 30_000, maxOutputBytes: MAX_OUTPUT_BYTES,
            })
            if (!active) throw new Error('browser-credential-grant-expired')
            const encoded = output.toString('ascii').trim()
            if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('browser-credential-access-unavailable')
            plain = Buffer.from(encoded, 'base64')
            if (plain.length === 0) throw new Error('browser-credential-access-unavailable')
            return plain
          } catch (error) {
            plain?.fill(0)
            const reason = error instanceof Error ? error.message : ''
            if (!active) throw new Error('browser-credential-grant-expired')
            if (reason === 'browser-credential-access-denied' || reason === 'browser-credential-access-cancelled') throw new Error(reason)
            throw new Error('browser-credential-access-unavailable')
          } finally { input.fill(0); output?.fill(0) }
        }
        return grant
      }
      const identity = secretServiceFor(request.profile.path, platform)!
      const secret = await execute(executable, platform === 'darwin'
        ? ['find-generic-password', '-w', '-s', identity.service]
        // In libsecret the displayed "Safe Storage" label is not an attribute.
        // Chromium's OSCrypt schema identifies its entry by application.
        : ['lookup', 'application', identity.application], { timeoutMs: 120_000, maxOutputBytes: 16_384 })
      try {
        let end = secret.length
        if (end && secret[end - 1] === 10) end -= 1
        if (end && secret[end - 1] === 13) end -= 1
        if (!end) return { status: 'unavailable', reason: 'browser-credential-safe-storage-unavailable' }
        key = pbkdf2Sync(secret.subarray(0, end), 'saltysalt', platform === 'darwin' ? 1003 : 1, 16, 'sha1')
        grant.key = key
        return grant
      } finally { secret.fill(0) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      if (reason === 'browser-credential-access-denied') return { status: 'denied', reason }
      if (reason === 'browser-credential-access-cancelled') return { status: 'cancelled', reason }
      return { status: 'unavailable', reason: 'browser-credential-access-unavailable' }
    } finally { activeRequests.delete(scope) }
  }

  return { capabilities, requestAccess }
}
