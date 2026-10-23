/**
 * LiveKit credentials resolution.
 *
 * Order: the user's override (CONFIG_DIR/team-calls.json, 0600, written by hand or a future Settings page) → the built-in defaults injected into the main-process bundle at
 *  build time (never committed, never sent to the renderer).
 * Secrets never leave this module except as minted tokens.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'

export interface CallCredentials {
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
}

export interface CallSettingsFile {
  livekitUrl?: string
  livekitApiKey?: string
  livekitApiSecret?: string
  /** Workspace-service origin for messenger contract `/v1/im/*` (no secrets). */
  workspaceServiceUrl?: string
}

export type CallCredentialSource = 'override' | 'builtin' | 'none'

let builtin: CallCredentials = { livekitUrl: '', livekitApiKey: '', livekitApiSecret: '' }

/** Called once by the Electron main process with its build-time defaults. */
export function setBuiltinCallCredentials(creds: Partial<CallCredentials>): void {
  builtin = {
    livekitUrl: creds.livekitUrl?.trim() ?? '',
    livekitApiKey: creds.livekitApiKey?.trim() ?? '',
    livekitApiSecret: creds.livekitApiSecret?.trim() ?? '',
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
export function resolveCallCredentials(): CallCredentials & { source: CallCredentialSource } {
  const o = readCallSettings()
  const overrideLk = !!(o.livekitUrl && o.livekitApiKey && o.livekitApiSecret)
  const lk = overrideLk
    ? { livekitUrl: o.livekitUrl!, livekitApiKey: o.livekitApiKey!, livekitApiSecret: o.livekitApiSecret! }
    : { livekitUrl: builtin.livekitUrl, livekitApiKey: builtin.livekitApiKey, livekitApiSecret: builtin.livekitApiSecret }
  const source = overrideLk ? 'override' : lk.livekitApiKey ? 'builtin' : 'none'
  return { ...lk, source }
}
