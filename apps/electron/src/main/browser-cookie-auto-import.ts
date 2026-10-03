/**
 * Automatic cookie/session import for the in-app browser.
 *
 * Cookies are credentials, so NOTHING is read until the user turns on the
 * single in-app consent switch (default off, persisted in the config dir).
 * After consent, only the selected Chromium profile and exact selected
 * domains are read on startup and then periodically (only when the cookie DB changed).
 * Cookie values are decrypted in this process and handed straight to the
 * dedicated Electron cookie store; they are never logged, persisted elsewhere or
 * returned over RPC. Passwords are never imported.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { session } from 'electron'
import { CONFIG_DIR } from '@rox/shared/config'
import { loadPrivacyState, providerScopeAllowed, setProviderAccessConsent } from '@rox/shared/privacy'
import { chromiumRootRel, type DiscoveredProfile } from '@rox/shared/browser/profile-import'
import type { BrowserCookieAutoStatus } from '../shared/types'
import {
  browserNameFor,
  decryptChromiumValue,
  deriveChromiumKey,
  safeStorageServiceFor,
  toElectronCookie,
  type ChromiumCookieRow,
} from './browser-cookie-crypto'

/** Isolated partition shared with the browser-pane consumer; revoke cannot touch user sessions. */
const BROWSER_PANE_PARTITION = 'persist:browser-cookie-import'
const STARTUP_DELAY_MS = 30_000
const INTERVAL_MS = 6 * 60 * 60_000

interface StoredState {
  consent?: boolean
  consentAt?: number | null
  profileId?: string | null
  domains?: string[]
  lastRunAt?: number | null
  lastDbMtime?: number | null
  imported?: number
  error?: string | null
  revocationReceipt?: BrowserCookieAutoStatus['revocationReceipt'] | null
}

export interface BrowserCookieConsentInput {
  consent: boolean
  profileId?: string
  domains?: string[]
}

const CONSENT_PROVIDER = 'chromium-cookie-import'
const COOKIE_SCOPE = 'session-cookies'
const COOKIE_PURPOSE = 'browser-session'

function accountRef(profileId: string): string {
  return createHash('sha256').update(profileId).digest('hex')
}

function normalizeCookieDomains(domains: readonly string[]): string[] {
  const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))]
  if (
    normalized.length === 0 ||
    normalized.some((domain) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain))
  ) {
    throw new Error('Choose one or more exact cookie domains')
  }
  return normalized
}

const statePath = () => join(CONFIG_DIR, 'browser-cookie-import.json')
function parseRevocationReceipt(value: unknown): BrowserCookieAutoStatus['revocationReceipt'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  if (
    typeof receipt.revokedAt !== 'number' ||
    !Number.isFinite(receipt.revokedAt) ||
    !Array.isArray(receipt.domains) ||
    !receipt.domains.every((domain: unknown) => typeof domain === 'string') ||
    !Number.isSafeInteger(receipt.cookiesRemoved) ||
    Number(receipt.cookiesRemoved) < 0
  ) {
    return null
  }
  return {
    revokedAt: receipt.revokedAt,
    domains: receipt.domains.filter((domain: unknown): domain is string => typeof domain === 'string'),
    cookiesRemoved: Number(receipt.cookiesRemoved),
  }
}

function readState(): StoredState {
  try {
    if (!existsSync(statePath())) return {}
    const raw: unknown = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const value = raw as Record<string, unknown>
    return {
      consent: value.consent === true,
      consentAt: typeof value.consentAt === 'number' ? value.consentAt : null,
      profileId: typeof value.profileId === 'string' ? value.profileId : null,
      domains: Array.isArray(value.domains) && value.domains.every((domain) => typeof domain === 'string')
        ? value.domains
        : [],
      lastRunAt: typeof value.lastRunAt === 'number' ? value.lastRunAt : null,
      lastDbMtime: typeof value.lastDbMtime === 'number' ? value.lastDbMtime : null,
      imported: Number.isSafeInteger(value.imported) && Number(value.imported) >= 0 ? Number(value.imported) : 0,
      error: typeof value.error === 'string' ? value.error : null,
      revocationReceipt: parseRevocationReceipt(value.revocationReceipt),
    }
  } catch {
    return {}
  }
}

function writeState(next: StoredState): void {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), `${JSON.stringify(next, null, 2)}\n`)
}

/** Resolve only the already-selected Chromium profile; never enumerate sibling profiles. */
export function detectCookieProfile(explicitId?: string | null): { profile: DiscoveredProfile | null; browsers: string[] } {
  if (!explicitId?.startsWith('chromium:')) return { profile: null, browsers: [] }
  const profilePath = resolve(explicitId.slice('chromium:'.length))
  const roots = chromiumRootRel(process.platform).map((path) => resolve(homedir(), path))
  const belongsToKnownRoot = roots.some((root) => {
    const fromRoot = relative(root, profilePath)
    return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
  })
  if (!belongsToKnownRoot || !cookieDbPath(profilePath)) return { profile: null, browsers: [] }
  const name = browserNameFor(profilePath)
  return {
    profile: {
      id: explicitId,
      family: 'chromium',
      name,
      path: profilePath,
      lastUsedAt: null,
      recommended: false,
      state: 'ok',
    },
    browsers: [name],
  }
}

function cookieDbPath(profilePath: string): string | null {
  for (const candidate of [join(profilePath, 'Network', 'Cookies'), join(profilePath, 'Cookies')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function keychainPassword(service: string, profilePath: string): Promise<string> {
  const program = process.platform === 'darwin' ? 'security' : 'secret-tool'
  const args =
    process.platform === 'darwin'
      ? ['find-generic-password', '-w', '-s', service]
      : ['lookup', 'application', browserNameFor(profilePath), 'label', service]
  return new Promise((resolve, reject) => {
    execFile(program, args, { timeout: 120_000 }, (error, stdout) => {
      const secret = stdout.trim()
      if (error || !secret) reject(new Error('browser-safe-storage-unavailable'))
      else resolve(secret)
    })
  })
}

const keyCache = new Map<string, Buffer>()

async function cookieKeyFor(profilePath: string): Promise<Buffer> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('unsupported-platform')
  const service = safeStorageServiceFor(profilePath)
  const cached = keyCache.get(service)
  if (cached) return cached
  const password = await keychainPassword(service, profilePath)
  const key = deriveChromiumKey(password, process.platform === 'darwin' ? 1003 : 1)
  keyCache.set(service, key)
  return key
}

type SqliteModule = { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(): unknown }
  close(): void
} }

async function readCookieRows(dbPath: string, domains: readonly string[]): Promise<{ rows: ChromiumCookieRow[]; metaVersion: number }> {
  if (domains.length === 0) throw new Error('cookie-domain-scope-required')
  // node:sqlite is runtime-optional on Electron builds; load only after a valid scope grant.
  const sqlite = (await import('node:sqlite')) as unknown as SqliteModule
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
  try {
    let metaVersion = 0
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string } | undefined
      metaVersion = Number(meta?.value ?? 0) || 0
    } catch {
      metaVersion = 0
    }
    const placeholders = domains.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE lower(ltrim(host_key, '.')) IN (${placeholders})`,
      )
      .all(...domains) as ChromiumCookieRow[]
    return { rows, metaVersion }
  } finally {
    db.close()
  }
}
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export class BrowserCookieAutoImporter {
  private running: Promise<BrowserCookieAutoStatus> | null = null
  private liveState: BrowserCookieAutoStatus['state'] | null = null
  private generation = 0
  private consentUpdate: Promise<unknown> = Promise.resolve()

  constructor(private readonly resolveProfile = detectCookieProfile) {}
  private timers: ReturnType<typeof setTimeout>[] = []

  private consentActive(stored = readState()): boolean {
    if (stored.consent !== true || !stored.profileId || !stored.domains?.length) return false
    const state = loadPrivacyState(CONFIG_DIR)
    return stored.domains.every((domain) =>
      providerScopeAllowed(state, CONSENT_PROVIDER, accountRef(stored.profileId!), domain, COOKIE_SCOPE, COOKIE_PURPOSE),
    )
  }

  status(): BrowserCookieAutoStatus {
    const stored = readState()
    const consent = this.consentActive(stored)
    const supported = process.platform === 'darwin' || process.platform === 'linux'
    const { profile } = consent ? this.resolveProfile(stored.profileId) : { profile: null }
    return {
      consent,
      profileId: consent ? stored.profileId ?? undefined : undefined,
      domains: consent ? stored.domains : undefined,
      supported,
      state: this.liveState ?? (!consent ? (stored.error ? 'error' : 'off') : stored.error ? 'error' : stored.lastRunAt ? 'done' : 'idle'),
      browsers: profile ? [browserNameFor(profile.path)] : [],
      browser: profile ? browserNameFor(profile.path) : null,
      profileName: profile?.name ?? null,
      imported: consent ? stored.imported ?? 0 : 0,
      lastRunAt: consent ? stored.lastRunAt ?? null : null,
      error: stored.error ?? undefined,
      revocationReceipt: consent ? undefined : stored.revocationReceipt ?? undefined,
    }
  }

  setConsent(input: BrowserCookieConsentInput): Promise<BrowserCookieAutoStatus> {
    const captured = { ...input, domains: input.domains ? [...input.domains] : undefined }
    const update = this.consentUpdate.catch(() => {}).then(() => this.updateConsent(captured))
    this.consentUpdate = update
    return update
  }

  private async updateConsent(input: BrowserCookieConsentInput): Promise<BrowserCookieAutoStatus> {
    const stored = readState()
    this.generation += 1
    if (!input.consent) {
      const profileId = stored.profileId
      const domains = stored.domains ?? []
      let ledgerRevocationFailed = false
      if (profileId) {
        try {
          setProviderAccessConsent({
            provider: CONSENT_PROVIDER,
            accountRef: accountRef(profileId),
            domains: [],
            dataScopes: [],
            purposes: [],
            granted: false,
          }, CONFIG_DIR)
        } catch {
          ledgerRevocationFailed = true
        }
        const service = safeStorageServiceFor(profileId)
        keyCache.get(service)?.fill(0)
        keyCache.delete(service)
      }
      writeState({
        ...stored,
        consent: false,
        consentAt: null,
        error: ledgerRevocationFailed ? 'cookie-revocation-failed' : null,
        lastDbMtime: null,
        revocationReceipt: null,
      })
      const running = this.running
      if (running) await running.catch(() => {})
      if (domains.length === 0) return this.status()
      try {
        const cookiesRemoved = await this.clearImportedCookies(domains)
        writeState({
          ...readState(),
          error: ledgerRevocationFailed ? 'cookie-revocation-failed' : null,
          revocationReceipt: ledgerRevocationFailed
            ? null
            : { revokedAt: Date.now(), domains: [...domains], cookiesRemoved },
        })
      } catch {
        writeState({ ...readState(), error: 'cookie-revocation-failed', revocationReceipt: null })
      }
      return this.status()
    }

    const profileId = input.profileId?.trim()
    if (!profileId) throw new Error('Select one browser profile before granting cookie access')
    const { profile } = this.resolveProfile(profileId)
    if (!profile) throw new Error('Selected browser profile is unavailable')
    const domains = normalizeCookieDomains(input.domains ?? [])
    const previousDomains = stored.domains ?? []
    const removedDomains = stored.profileId !== profileId
      ? previousDomains
      : previousDomains.filter(domain => !domains.includes(domain))
    if (stored.profileId && removedDomains.length) {
      // Stop old imports first. Keep the old ledger/source binding until purge
      // succeeds, so a failed purge can be retried against the same exact scope.
      writeState({ ...stored, consent: false, error: null })
      if (this.running) await this.running.catch(() => {})
      try { await this.clearImportedCookies(removedDomains) }
      catch {
        writeState({ ...stored, consent: false, error: 'cookie-revocation-failed' })
        throw new Error('cookie-revocation-failed')
      }
      if (stored.profileId !== profileId) {
        setProviderAccessConsent({ provider: CONSENT_PROVIDER, accountRef: accountRef(stored.profileId),
          domains: [], dataScopes: [], purposes: [], granted: false }, CONFIG_DIR)
      }
    }
    setProviderAccessConsent({
      provider: CONSENT_PROVIDER,
      accountRef: accountRef(profileId),
      domains,
      dataScopes: [COOKIE_SCOPE],
      purposes: [COOKIE_PURPOSE],
      granted: true,
    }, CONFIG_DIR)
    writeState({
      ...stored,
      consent: true,
      consentAt: Date.now(),
      profileId,
      domains,
      error: null,
      lastDbMtime: null,
      revocationReceipt: null,
    })
    void this.run(true)
    return this.status()
  }

  private async clearImportedCookies(domains: readonly string[]): Promise<number> {
    if (domains.length === 0) return 0
    const target = session.fromPartition(BROWSER_PANE_PARTITION)
    const candidates: Array<{ domain: string; key: string }> = []
    for (const domain of domains) {
      const cookies = await target.cookies.get({ domain })
      for (const cookie of cookies) {
        if ((cookie.domain ?? '').replace(/^\./, '').toLowerCase() !== domain) continue
        candidates.push({
          domain,
          key: JSON.stringify([cookie.domain, cookie.name, cookie.path]),
        })
        const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`
        await target.cookies.remove(url, cookie.name)
      }
    }
    await target.cookies.flushStore()

    let removed = 0
    for (const domain of domains) {
      const remaining = new Set(
        (await target.cookies.get({ domain }))
          .filter((cookie) => (cookie.domain ?? '').replace(/^\./, '').toLowerCase() === domain)
          .map((cookie) => JSON.stringify([cookie.domain, cookie.name, cookie.path])),
      )
      if (candidates.some(candidate => candidate.domain === domain && remaining.has(candidate.key))) {
        throw new Error('cookie-revocation-readback-failed')
      }
      removed += candidates.filter((candidate) => candidate.domain === domain && !remaining.has(candidate.key)).length
    }
    return removed
  }

  run(force = false): Promise<BrowserCookieAutoStatus> {
    if (this.running) return this.running
    const generation = this.generation
    this.running = this.runOnce(force, generation).finally(() => {
      this.running = null
      this.liveState = null
    })
    return this.running
  }

  private async runOnce(force: boolean, generation: number): Promise<BrowserCookieAutoStatus> {
    const stored = readState()
    if (!this.consentActive(stored) || generation !== this.generation) return this.status()
    const { profile } = this.resolveProfile(stored.profileId)
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
      if (generation !== this.generation || !this.consentActive()) {
        const service = safeStorageServiceFor(profile.path)
        key.fill(0)
        keyCache.delete(service)
        return this.status()
      }
      const domains = stored.domains ?? []
      const { rows, metaVersion } = await readCookieRows(dbPath, domains)
      if (generation !== this.generation || !this.consentActive()) return this.status()
      const target = session.fromPartition(BROWSER_PANE_PARTITION)
      const nowS = Date.now() / 1000
      let imported = 0
      let processed = 0
      for (const row of rows) {
        if (generation !== this.generation || !this.consentActive()) break
        const domain = row.host_key.replace(/^\./, '').toLowerCase()
        if (!providerScopeAllowed(loadPrivacyState(CONFIG_DIR), CONSENT_PROVIDER, accountRef(profile.id), domain, COOKIE_SCOPE, COOKIE_PURPOSE)) continue
        const value = row.value || decryptChromiumValue(row.encrypted_value, key, metaVersion)
        if (value === null) continue
        const cookie = toElectronCookie(row, value, nowS)
        if (!cookie) continue
        if (generation !== this.generation || !this.consentActive()) break
        try {
          await target.cookies.set(cookie)
          imported += 1
        } catch {
          // Electron rejects a few legacy/invalid cookies; skip them.
        }
        processed += 1
        if (processed % 200 === 0) await yieldToLoop()
      }
      if (generation !== this.generation || !this.consentActive()) return this.status()
      await target.cookies.flushStore()
      writeState({ ...readState(), profileId: profile.id, lastRunAt: Date.now(), lastDbMtime: mtime, imported, error: null })
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof Error &&
          ['browser-safe-storage-unavailable', 'unsupported-platform', 'cookie-domain-scope-required'].includes(error.message)
          ? error.message
          : 'cookie-import-failed'
        writeState({ ...readState(), lastRunAt: Date.now(), error: message })
      }
    }
    return this.status()
  }

  start(): void {
    if (this.timers.length > 0) return
    const tick = () => {
      if (this.consentActive()) void this.run().catch(() => {})
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
