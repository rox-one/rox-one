/**
 * Automatic cookie/session import for the in-app browser.
 *
 * Cookies are credentials, so NOTHING is read until the user turns on the
 * single in-app consent switch (default off, persisted in the config dir).
 * After consent, the most recently used Chromium-family profile is
 * auto-detected and its cookies are copied into the in-app browser session
 * on startup and then periodically (only when the cookie DB changed).
 * Cookie values are decrypted in this process and handed straight to
 * Electron's cookie store; they are never logged, persisted elsewhere or
 * returned over RPC. Passwords are never imported.
 */

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { session } from 'electron'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import {
  discoverBrowserProfiles,
  recommendProfile,
  type DiscoveredProfile,
  type ProfileFs,
} from '@craft-agent/shared/browser/profile-import'
import type { BrowserCookieAutoStatus } from '../shared/types'
import {
  browserNameFor,
  decryptChromiumValue,
  deriveChromiumKey,
  safeStorageServiceFor,
  toElectronCookie,
  type ChromiumCookieRow,
} from './browser-cookie-crypto'

/** Same partition as BROWSER_PANE_SESSION_PARTITION in browser-pane-manager.ts. */
const BROWSER_PANE_PARTITION = 'persist:browser-pane'
const STARTUP_DELAY_MS = 30_000
const INTERVAL_MS = 6 * 60 * 60_000

interface StoredState {
  consent?: boolean
  consentAt?: number | null
  profileId?: string | null
  lastRunAt?: number | null
  lastDbMtime?: number | null
  imported?: number
  error?: string | null
}

const statePath = () => join(CONFIG_DIR, 'browser-cookie-import.json')

function readState(): StoredState {
  try {
    if (!existsSync(statePath())) return {}
    return JSON.parse(readFileSync(statePath(), 'utf8')) as StoredState
  } catch {
    return {}
  }
}

function writeState(next: StoredState): void {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), `${JSON.stringify(next, null, 2)}\n`)
}

const readOnlyFs: ProfileFs = {
  exists: (path) => existsSync(path),
  readText: (path) => {
    try {
      return existsSync(path) ? readFileSync(path, 'utf8') : null
    } catch {
      return null
    }
  },
  writeText: () => {},
  remove: () => {},
}

/** Detect installed Chromium-family profiles; the most recently used one is picked. */
export function detectCookieProfile(explicitId?: string | null): { profile: DiscoveredProfile | null; browsers: string[] } {
  const all = discoverBrowserProfiles({ home: homedir(), platform: process.platform, fs: readOnlyFs })
  const chromium = all
    .filter((profile) => profile.family === 'chromium' && profile.state !== 'unsupported' && profile.state !== 'corrupt')
    .filter((profile) => cookieDbPath(profile.path) !== null)
  const browsers = [...new Set(chromium.map((profile) => browserNameFor(profile.path)))]
  const byId = explicitId ? chromium.find((profile) => profile.id === explicitId) : undefined
  const recommended = byId ?? recommendProfile(chromium.map((p) => ({ ...p, state: (p.state === 'running' ? 'ok' : p.state) as DiscoveredProfile['state'] })))
  const profile = recommended ? chromium.find((p) => p.id === recommended.id) ?? null : null
  return { profile, browsers }
}

function cookieDbPath(profilePath: string): string | null {
  for (const candidate of [join(profilePath, 'Network', 'Cookies'), join(profilePath, 'Cookies')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function keychainPassword(service: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'security',
      ['find-generic-password', '-w', '-s', service],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) reject(new Error(`keychain: ${service} not available`))
        else resolve(stdout.trim())
      },
    )
  })
}

const keyCache = new Map<string, Buffer>()

async function cookieKeyFor(profilePath: string): Promise<Buffer> {
  const service = process.platform === 'darwin' ? safeStorageServiceFor(profilePath) : 'peanuts'
  const cached = keyCache.get(service)
  if (cached) return cached
  let key: Buffer
  if (process.platform === 'darwin') key = deriveChromiumKey(await keychainPassword(service), 1003)
  else if (process.platform === 'linux') key = deriveChromiumKey('peanuts', 1)
  else throw new Error('unsupported-platform')
  keyCache.set(service, key)
  return key
}

type SqliteModule = { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
  prepare(sql: string): { all(): unknown[]; get(): unknown }
  close(): void
} }

async function readCookieRows(dbPath: string): Promise<{ rows: ChromiumCookieRow[]; metaVersion: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'rox-cookies-'))
  try {
    // The live DB is locked by the browser: work on a private copy.
    const copy = join(dir, 'Cookies')
    copyFileSync(dbPath, copy)
    for (const suffix of ['-wal', '-journal']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix)
    }
    const sqlite = (await import('node:sqlite')) as unknown as SqliteModule
    const db = new sqlite.DatabaseSync(copy, { readOnly: true })
    try {
      let metaVersion = 0
      try {
        const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string } | undefined
        metaVersion = Number(meta?.value ?? 0) || 0
      } catch {
        metaVersion = 0
      }
      const rows = db
        .prepare(
          'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies',
        )
        .all() as ChromiumCookieRow[]
      return { rows, metaVersion }
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export class BrowserCookieAutoImporter {
  private running: Promise<BrowserCookieAutoStatus> | null = null
  private liveState: BrowserCookieAutoStatus['state'] | null = null
  private timers: ReturnType<typeof setTimeout>[] = []

  status(): BrowserCookieAutoStatus {
    const stored = readState()
    const { profile, browsers } = detectCookieProfile(stored.profileId)
    const supported = process.platform === 'darwin' || process.platform === 'linux'
    const consent = stored.consent === true
    return {
      consent,
      supported,
      state: this.liveState ?? (!consent ? 'off' : stored.error ? 'error' : stored.lastRunAt ? 'done' : 'idle'),
      browsers,
      browser: profile ? browserNameFor(profile.path) : null,
      profileName: profile?.name ?? null,
      imported: stored.imported ?? 0,
      lastRunAt: stored.lastRunAt ?? null,
      error: stored.error ?? undefined,
    }
  }

  setConsent(consent: boolean): BrowserCookieAutoStatus {
    const stored = readState()
    writeState({ ...stored, consent, consentAt: consent ? Date.now() : null, error: null, lastDbMtime: consent ? stored.lastDbMtime : null })
    if (consent) void this.run(true)
    return this.status()
  }

  run(force = false): Promise<BrowserCookieAutoStatus> {
    if (this.running) return this.running
    this.running = this.runOnce(force).finally(() => {
      this.running = null
      this.liveState = null
    })
    return this.running
  }

  private async runOnce(force: boolean): Promise<BrowserCookieAutoStatus> {
    const stored = readState()
    // Hard consent gate: without the explicit in-app switch nothing is read.
    if (stored.consent !== true) return this.status()
    const { profile } = detectCookieProfile(stored.profileId)
    if (!profile) {
      writeState({ ...stored, error: 'no-browser', lastRunAt: Date.now() })
      return this.status()
    }
    const dbPath = cookieDbPath(profile.path)
    if (!dbPath) {
      writeState({ ...stored, error: 'no-cookie-store', lastRunAt: Date.now() })
      return this.status()
    }
    const mtime = statSync(dbPath).mtimeMs
    if (!force && stored.lastDbMtime === mtime && !stored.error) return this.status()

    this.liveState = 'importing'
    try {
      const key = await cookieKeyFor(profile.path)
      const { rows, metaVersion } = await readCookieRows(dbPath)
      const target = session.fromPartition(BROWSER_PANE_PARTITION)
      const nowS = Date.now() / 1000
      let imported = 0
      let processed = 0
      for (const row of rows) {
        const value = row.value || decryptChromiumValue(row.encrypted_value, key, metaVersion)
        if (value === null) continue
        const cookie = toElectronCookie(row, value, nowS)
        if (!cookie) continue
        try {
          await target.cookies.set(cookie)
          imported += 1
        } catch {
          // Electron rejects a few legacy/invalid cookies; skip them.
        }
        processed += 1
        if (processed % 200 === 0) await yieldToLoop()
      }
      await target.cookies.flushStore().catch(() => {})
      writeState({ ...readState(), profileId: profile.id, lastRunAt: Date.now(), lastDbMtime: mtime, imported, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeState({ ...readState(), lastRunAt: Date.now(), error: message })
    }
    return this.status()
  }

  start(): void {
    if (this.timers.length > 0) return
    const tick = () => {
      if (readState().consent === true) void this.run().catch(() => {})
    }
    const first = setTimeout(tick, STARTUP_DELAY_MS)
    const repeat = setInterval(tick, INTERVAL_MS)
    ;(first as { unref?: () => void }).unref?.()
    ;(repeat as { unref?: () => void }).unref?.()
    this.timers.push(first, repeat as unknown as ReturnType<typeof setTimeout>)
  }
}

let singleton: BrowserCookieAutoImporter | null = null
export function getBrowserCookieAutoImporter(): BrowserCookieAutoImporter {
  singleton ??= new BrowserCookieAutoImporter()
  return singleton
}
