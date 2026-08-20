/**
 * Parse/validate OEM kernel pin metadata (version + per-platform tarball sha256).
 * Binary payloads are not part of this module and must not live in the Apache tree.
 */

import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const OEM_PIN_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'] as const

export type OemPinPlatform = (typeof OEM_PIN_PLATFORMS)[number]

const SHA256_HEX = /^[0-9a-fA-F]{64}$/
const MAX_PARENTS = 8
const DEFAULT_PAYLOAD_DIR = '/tmp/oem-kernel-payload'

export const OEM_PIN_FILENAME = 'oem-kernel-pin.json'
export const OEM_G2_RECORD_RELATIVE = 'docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md'
export const OEM_PIN_DEV_RELATIVE = 'apps/electron/resources/oem-kernel-pin.json'

const PIN_RELATIVES = [
  join('resources', OEM_PIN_FILENAME),
  OEM_PIN_DEV_RELATIVE,
  OEM_PIN_FILENAME,
] as const

const G2_RELATIVES = [OEM_G2_RECORD_RELATIVE, 'g2-decision-record.md'] as const

const KERNEL_NAMES = ['knowledge-engine', 'knowledge-engine.exe', 'SiYuan-Kernel', 'SiYuan-Kernel.exe'] as const

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

/** Repo-root (dev) and extraResources (packaged) locations for G2 + pin. */
export interface OemManagedLayout {
  g2RecordPath: string | null
  pinPath: string | null
  kernelBinary: string | null
}

export interface ResolveOemManagedLayoutOptions {
  /** Packaged `process.resourcesPath` or repo root (`process.cwd()`). */
  cwd?: string
  env?: NodeJS.ProcessEnv
  existsSync?: (path: string) => boolean
  readFileSync?: (path: string, encoding: 'utf8') => string
  platform?: NodeJS.Platform
  arch?: string
}

function walkUpDirs(start: string, maxParents: number): string[] {
  const dirs: string[] = []
  let dir = start
  dirs.push(dir)
  for (let i = 0; i < maxParents; i++) {
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
    dirs.push(dir)
  }
  return dirs
}

function safeExists(exists: (path: string) => boolean, path: string): boolean {
  try {
    return !!exists(path)
  } catch {
    return false
  }
}

function firstExisting(candidates: string[], exists: (path: string) => boolean): string | null {
  for (const path of candidates) {
    if (safeExists(exists, path)) return path
  }
  return null
}

function envPath(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function tryParsePin(
  path: string,
  exists: (path: string) => boolean,
  read: (path: string, encoding: 'utf8') => string,
): OemKernelPin | null {
  try {
    if (!safeExists(exists, path)) return null
    return parseOemKernelPin(JSON.parse(read(path, 'utf8')) as unknown)
  } catch {
    return null
  }
}

function kernelDirsFor(base: string, relativePayloadDir: string | null): string[] {
  const dirs: string[] = []
  const add = (p: string) => {
    if (p && !dirs.includes(p)) dirs.push(p)
  }
  if (relativePayloadDir) add(join(base, relativePayloadDir))
  add(join(base, 'oem-kernel'))
  add(join(base, 'resources', 'oem-kernel'))
  return dirs
}

/**
 * Locate G2 record, pin JSON, and kernel binary.
 * Env (`G2_RECORD_PATH`, `OEM_PIN_PATH`, `OEM_KERNEL_BINARY`) wins when the
 * path exists, then a bounded walk-up from cwd (max 8 parents). Never throws.
 */
export function resolveOemManagedLayout(options: ResolveOemManagedLayoutOptions = {}): OemManagedLayout {
  try {
    const env = options.env ?? process.env
    const exists = options.existsSync ?? fsExistsSync
    const read = options.readFileSync ?? ((p, enc) => fsReadFileSync(p, enc))
    const platform = options.platform ?? process.platform
    const arch = options.arch ?? process.arch
    const cwd = options.cwd ?? process.cwd()
    const dirs = walkUpDirs(cwd, MAX_PARENTS)

    const envG2 = envPath(env, 'G2_RECORD_PATH')
    const envPin = envPath(env, 'OEM_PIN_PATH')
    const envBin = envPath(env, 'OEM_KERNEL_BINARY')
    const payloadDir = envPath(env, 'OEM_KERNEL_PAYLOAD_DIR') ?? DEFAULT_PAYLOAD_DIR

    let g2RecordPath = envG2 && safeExists(exists, envG2) ? envG2 : null
    let pinPath = envPin && safeExists(exists, envPin) ? envPin : null
    let kernelBinary = envBin && safeExists(exists, envBin) ? envBin : null

    if (!g2RecordPath) {
      const g2Candidates: string[] = []
      for (const dir of dirs) {
        for (const rel of G2_RELATIVES) g2Candidates.push(join(dir, rel))
      }
      g2RecordPath = firstExisting(g2Candidates, exists)
    }

    if (!pinPath) {
      const pinCandidates: string[] = []
      for (const dir of dirs) {
        for (const rel of PIN_RELATIVES) pinCandidates.push(join(dir, rel))
      }
      pinPath = firstExisting(pinCandidates, exists)
    }

    if (!kernelBinary) {
      const pin = pinPath ? tryParsePin(pinPath, exists, read) : null
      const relativePayloadDir = pin?.relativePayloadDir ?? null
      const binaryCandidates: string[] = []
      for (const dir of dirs) {
        for (const kdir of kernelDirsFor(dir, relativePayloadDir)) {
          for (const name of KERNEL_NAMES) binaryCandidates.push(join(kdir, name))
        }
      }
      try {
        const key = pinPlatformKey(platform, arch)
        for (const name of KERNEL_NAMES) {
          binaryCandidates.push(join(payloadDir, key, name))
        }
      } catch {
        /* unsupported platform — skip keyed payload dir */
      }
      kernelBinary = firstExisting(binaryCandidates, exists)
    }

    return { g2RecordPath, pinPath, kernelBinary }
  } catch {
    return { g2RecordPath: null, pinPath: null, kernelBinary: null }
  }
}
