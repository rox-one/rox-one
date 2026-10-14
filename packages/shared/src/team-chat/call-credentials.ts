/**
 * Call / search credentials resolution.
 *
 * Order: the user's override (CONFIG_DIR/team-calls.json, 0600, set in
 * Settings) → the built-in defaults injected into the main-process bundle at
 * build time (never committed, never sent to the renderer).
 *
 * `tokenMode: 'server'` (flag, off by default) asks a Rox server for the
 * LiveKit token instead of minting locally — kept for the server-token path.
 * Secrets never leave this module except as minted tokens / Exa requests.
 */
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'

export interface CallCredentials {
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  exaApiKey: string
}

export interface CallSettingsFile {
  livekitUrl?: string
  livekitApiKey?: string
  livekitApiSecret?: string
  exaApiKey?: string
  tokenMode?: 'local' | 'server'
  serverTokenUrl?: string
  /** Automatic transcription of calls (default on). */
  autoTranscribe?: boolean
}

/** What the renderer may see: no secrets, only which source is active. */
export interface CallSettingsView {
  livekitUrl: string
  livekitConfigured: boolean
  exaConfigured: boolean
  source: 'override' | 'builtin' | 'none'
  hasOverride: boolean
  tokenMode: 'local' | 'server'
  serverTokenUrl?: string
  autoTranscribe: boolean
}

let builtin: CallCredentials = { livekitUrl: '', livekitApiKey: '', livekitApiSecret: '', exaApiKey: '' }

/** Called once by the Electron main process with its build-time defaults. */
export function setBuiltinCallCredentials(creds: Partial<CallCredentials>): void {
  builtin = {
    livekitUrl: creds.livekitUrl?.trim() ?? '',
    livekitApiKey: creds.livekitApiKey?.trim() ?? '',
    livekitApiSecret: creds.livekitApiSecret?.trim() ?? '',
    exaApiKey: creds.exaApiKey?.trim() ?? '',
  }
}

function settingsPath(): string {
  return join(resolveConfigDir(), 'team-calls.json')
}

export function readCallSettings(): CallSettingsFile {
  const path = settingsPath()
  if (!existsSync(path)) return {}
  const raw = readJsonFileSync<CallSettingsFile>(path)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

/** Effective credentials (override fields win field-by-field when the LiveKit triple is complete). */
export function resolveCallCredentials(): CallCredentials & { source: CallSettingsView['source'] } {
  const o = readCallSettings()
  const overrideLk = !!(o.livekitUrl && o.livekitApiKey && o.livekitApiSecret)
  const lk = overrideLk
    ? { livekitUrl: o.livekitUrl!, livekitApiKey: o.livekitApiKey!, livekitApiSecret: o.livekitApiSecret! }
    : { livekitUrl: builtin.livekitUrl, livekitApiKey: builtin.livekitApiKey, livekitApiSecret: builtin.livekitApiSecret }
  const exaApiKey = o.exaApiKey || builtin.exaApiKey
  const source = overrideLk || o.exaApiKey ? 'override' : (lk.livekitApiKey || exaApiKey) ? 'builtin' : 'none'
  return { ...lk, exaApiKey, source }
}
