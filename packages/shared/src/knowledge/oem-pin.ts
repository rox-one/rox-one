/**
 * Parse/validate OEM kernel pin metadata (version + per-platform tarball sha256).
 * Binary payloads are not part of this module and must not live in the Apache tree.
 */

export const OEM_PIN_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'] as const

export type OemPinPlatform = (typeof OEM_PIN_PLATFORMS)[number]

const SHA256_HEX = /^[0-9a-fA-F]{64}$/

export interface OemKernelPin {
  version: string
  sha256: Record<OemPinPlatform, string>
  relativePayloadDir: string
  minApi: string
  maxApiExclusive: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`oem kernel pin: ${field} must be a non-empty string`)
  }
  return value
}

function parseSha256Map(raw: unknown): Record<OemPinPlatform, string> {
  if (!isRecord(raw)) {
    throw new Error('oem kernel pin: sha256 must be an object')
  }
  const out = {} as Record<OemPinPlatform, string>
  for (const platform of OEM_PIN_PLATFORMS) {
    const hash = raw[platform]
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      throw new Error(`oem kernel pin: sha256.${platform} must be a 64-char hex digest`)
    }
    out[platform] = hash.toLowerCase()
  }
  return out
}

export function parseOemKernelPin(raw: unknown): OemKernelPin {
  if (!isRecord(raw)) {
    throw new Error('oem kernel pin: expected an object')
  }
  return {
    version: requireNonEmptyString(raw.version, 'version'),
    sha256: parseSha256Map(raw.sha256),
    relativePayloadDir: requireNonEmptyString(raw.relativePayloadDir, 'relativePayloadDir'),
    minApi: requireNonEmptyString(raw.minApi, 'minApi'),
    maxApiExclusive: requireNonEmptyString(raw.maxApiExclusive, 'maxApiExclusive'),
  }
}

export function pinPlatformKey(platform: NodeJS.Platform, arch: string): keyof OemKernelPin['sha256'] {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  throw new Error(`oem kernel pin: unsupported platform ${platform}-${arch}`)
}
