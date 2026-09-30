import { createCipheriv, randomBytes, randomUUID } from 'node:crypto'

import { basename, isAbsolute, relative, resolve, sep } from 'node:path'


/**
 * Privileged browser profile import (Rox tracker Issue 15).
 *
 * Discovery never opens cookie or credential stores. Import reads those files
 * only after per-category consent, and credentials only after OS approval.
 * Summaries returned to the renderer contain counts, never secret values.
 */

export type BrowserFamily = 'chromium' | 'firefox' | 'safari'
export type ProfileImportState = 'ok' | 'locked' | 'corrupt' | 'running' | 'unsupported'
export type ImportCategory = 'history_bookmarks' | 'cookies' | 'credentials'

export interface ProfileFs {
  exists(path: string): boolean
  readText(path: string): string | null
  writeText(path: string, contents: string): void
  remove(path: string): void
  listPaths(prefix: string): string[]
}

export interface DiscoveredProfile {
  id: string
  family: BrowserFamily
  name: string
  path: string
  lastUsedAt: number | null
  recommended: boolean
  state: ProfileImportState
}

export interface ImportConsent {
  historyBookmarks: boolean
  cookies: boolean
  credentials: boolean
  osCredentialsApproved: boolean
  domains?: string[]
}

export interface ProtectedCookieImport {
  read(profile: DiscoveredProfile, domains: readonly string[]): string | null
  storeKey(key: Buffer): string | null
  /** Idempotent custody removal: true only for deleted or authoritatively absent.
   * Denied, locked and unknown states must return false so recovery is retained. */
  deleteKey?(reference: string): boolean
}

export interface ImportSummary {
  dryRun: boolean
  profileId: string
  counts: { history: number; bookmarks: number; cookies: number; credentials: number; skipped: number }
  accessedStores: ImportCategory[]
  rollbackToken: string | null
  deletionReceipt: { deletedAt: number; categories: ImportCategory[]; itemCount: number } | null
}

export interface IndexedItem {
  kind: 'bookmark' | 'history'
  url: string
  title: string
}

export const COOKIE_STORE_BASENAMES = [
  'Cookies',
  'Cookies.sqlite',
  'Cookies.binarycookies',
] as const

export const CREDENTIAL_STORE_BASENAMES = [
  'Login Data',
  'Login Data For Account',
  'logins.json',
  'key4.db',
  'key3.db',
  'logins-backup.json',
] as const

export const SECRET_STORE_BASENAMES = [
  ...COOKIE_STORE_BASENAMES,
  ...CREDENTIAL_STORE_BASENAMES,
] as const

export function isSecretStorePath(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  return (SECRET_STORE_BASENAMES as readonly string[]).includes(base)
}

export function recommendProfile(
  profiles: DiscoveredProfile[],
  explicitId?: string,
  now = Date.now(),
): DiscoveredProfile | null {
  if (explicitId) {
    return profiles.find((profile) => profile.id === explicitId) ?? null
  }
  const start = startOfLocalDay(now)
  const sameDay = profiles
    .filter((profile) => profile.state === 'ok' && profile.lastUsedAt !== null && profile.lastUsedAt >= start)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
  return sameDay[0] ?? profiles.find((profile) => profile.state === 'ok') ?? null
}

export function discoverBrowserProfiles(input: {
  home: string
  platform: NodeJS.Platform
  now?: number
  fs: ProfileFs
  explicitId?: string
}): DiscoveredProfile[] {
  const now = input.now ?? Date.now()
  const found: DiscoveredProfile[] = []
  for (const root of chromiumRoots(input.home, input.platform)) {
    found.push(...discoverChromium(root, input.fs))
  }
  for (const root of firefoxRoots(input.home, input.platform)) {
    found.push(...discoverFirefox(root, input.fs))
  }
  if (input.platform === 'darwin') {
    found.push(...discoverSafari(`${input.home}/Library/Safari`, input.fs))
  }
  const recommended = recommendProfile(found, input.explicitId, now)
  return found.map((profile) => ({
    ...profile,
    recommended: recommended?.id === profile.id,
  }))
}

/** Resolve only the profile explicitly chosen by the user, without scanning sibling profiles or reading store contents. */
export function discoverBrowserProfileById(input: {
  home: string
  platform: NodeJS.Platform
  fs: ProfileFs
  profileId: string
}): DiscoveredProfile | null {
  const [family, ...pathParts] = input.profileId.split(':')
  const requestedPath = pathParts.join(':')
  if (!requestedPath || (family !== 'chromium' && family !== 'firefox' && family !== 'safari')) return null
  const roots =
    family === 'chromium'
      ? chromiumRootRel(input.platform)
      : family === 'firefox'
        ? firefoxRootRel(input.platform)
        : input.platform === 'darwin'
          ? ['Library/Safari']
          : []
  const candidate = resolve(requestedPath)
  const allowedRoot = roots
    .map((path) => resolve(input.home, path))
    .find((root) => {
      const fromRoot = relative(root, candidate)
      return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
    })
  if (!allowedRoot) return null

  let profilePath = candidate
  if (family === 'chromium' && candidate === allowedRoot) profilePath = resolve(candidate, 'Default')
  if (!input.fs.exists(profilePath)) return null
  const state = ['lock', 'SingletonLock', 'parent.lock'].some((name) => input.fs.exists(`${profilePath}/${name}`))
    ? 'running'
    : 'ok'
  return {
    id: input.profileId,
    family,
    name: basename(profilePath) || family,
    path: profilePath,
    lastUsedAt: null,
    recommended: false,
    state,
  }
}

export function parseBookmarks(raw: string): IndexedItem[] {
  const items: IndexedItem[] = []
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { roots?: Record<string, { children?: unknown[] }> }
      for (const root of Object.values(parsed.roots ?? {})) {
        collectChromeBookmarks(root.children ?? [], items)
      }
    } catch {
      return []
    }
    return dedupeItems(items)
  }
  const re = /<DT>\s*<A[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) {
    items.push({ kind: 'bookmark', url: match[1] ?? '', title: decodeHtml(match[2] ?? '') })
  }
  return dedupeItems(items)
}

export function parseHistory(raw: string): IndexedItem[] {
  try {
    const parsed = JSON.parse(raw) as { visits?: Array<{ url?: string; title?: string }> }
    return dedupeItems(
      (parsed.visits ?? [])
        .filter((visit) => visit.url)
        .map((visit) => ({ kind: 'history' as const, url: visit.url ?? '', title: visit.title ?? '' })),
    )
  } catch {
    return []
  }
}

export function canAccessCredentials(consent: ImportConsent): boolean {
  return consent.credentials && consent.osCredentialsApproved
}

export function importProfile(input: {
  profile: DiscoveredProfile
  consent: ImportConsent
  authorizedScopes: { cookies: boolean; credentials: boolean }
  protectedCookies?: ProtectedCookieImport
  fs: ProfileFs
  indexPath: string
  vaultPath: string
  dryRun: boolean
  now?: number
}): ImportSummary {
  if (input.profile.state === 'unsupported' || input.profile.state === 'locked') {
    return emptySummary(input.profile.id, input.dryRun)
  }

  const accessed: ImportCategory[] = []
  let bookmarks: IndexedItem[] = []
  let history: IndexedItem[] = []
  let cookieCount = 0
  let cookieKeyRef: string | null = null
  let sealedCookies: string | null = null
  let credentialCount = 0
  let skipped = 0

  if (input.consent.historyBookmarks) {
    accessed.push('history_bookmarks')
    const bookmarkFile = firstExisting(input.fs, [
      `${input.profile.path}/Bookmarks`,
      `${input.profile.path}/bookmarks.html`,
      `${input.profile.path}/Bookmarks.plist`,
    ])
    const historyFile = firstExisting(input.fs, [
      `${input.profile.path}/history.json`,
      `${input.profile.path}/History.json`,
    ])
    if (bookmarkFile) bookmarks = parseBookmarks(input.fs.readText(bookmarkFile) ?? '')
    if (historyFile) history = parseHistory(input.fs.readText(historyFile) ?? '')
    if (input.profile.state === 'corrupt' && bookmarks.length === 0 && history.length === 0) {
      skipped += 1
    }
  }

  if (input.consent.cookies) {
    if (!input.authorizedScopes.cookies || !input.consent.domains?.length || !input.protectedCookies) {
      skipped += 1
    } else {
      const cookieFile = firstSecret(input.fs, input.profile.path)
      if (!cookieFile) {
        skipped += 1
      } else {
        const blob = input.protectedCookies.read(input.profile, input.consent.domains)
        if (blob === null) {
          skipped += 1
        } else {
          accessed.push('cookies')
          cookieCount = countCookieRecords(blob)
          if (!input.dryRun) {
            const key = randomBytes(32)
            try {
              const reference = input.protectedCookies.storeKey(key)
              if (!reference) throw new Error('protected-cookie-key-unavailable')
              cookieKeyRef = reference
              sealedCookies = sealCookieBlob(blob, key)
            } finally { key.fill(0) }
          }
        }
      }
    }
  }

  if (input.consent.credentials) {
    if (!input.authorizedScopes.credentials || !canAccessCredentials(input.consent)) {
      skipped += 1
    } else {
      accessed.push('credentials')
      const loginFile = firstExisting(
        input.fs,
        CREDENTIAL_STORE_BASENAMES.map((name) => `${input.profile.path}/${name}`),
      )
      if (loginFile) {
        credentialCount = countCredentialRecords(input.fs.readText(loginFile) ?? '')
      } else {
        skipped += 1
      }
    }
  }

  const rollbackToken = input.dryRun ? null : `rb-${randomUUID()}`
  try {
    if (!input.dryRun && (input.consent.historyBookmarks || cookieKeyRef !== null)) {
      const previous = input.fs.readText(input.indexPath) ?? JSON.stringify({ bookmarks: [], history: [] })
      if (rollbackToken) input.fs.writeText(`${input.indexPath}.${rollbackToken}`, previous)
      let existing: { bookmarks?: IndexedItem[]; history?: IndexedItem[]; cookieKeyRef?: string } = {}
      try {
        existing = JSON.parse(previous) as typeof existing
      } catch {
        existing = {}
      }
      if (cookieKeyRef && rollbackToken) {
        if (existing.cookieKeyRef === cookieKeyRef) throw new Error('protected-cookie-key-reference-must-be-unique')
        // Recovery metadata precedes vault publication; it contains ciphertext only.
        input.fs.writeText(`${input.indexPath}.${rollbackToken}.cookies`, JSON.stringify({
          vaultPath: input.vaultPath, previousVault: input.fs.readText(input.vaultPath),
          currentKeyRef: cookieKeyRef, keyDeleted: false,
        }))
        input.fs.writeText(input.vaultPath, sealedCookies!)
      }
      input.fs.writeText(
        input.indexPath,
        JSON.stringify({
          bookmarks: input.consent.historyBookmarks ? bookmarks : existing.bookmarks ?? [],
          history: input.consent.historyBookmarks ? history : existing.history ?? [],
          cookieKeyRef: cookieKeyRef ?? existing.cookieKeyRef,
        }),
      )
    }

  } catch (error) {
    // Before recovery metadata exists, publication did not start. Afterward,
    // retain custody and ciphertext so the rollback can be retried.
    if (cookieKeyRef && rollbackToken && !input.fs.exists(`${input.indexPath}.${rollbackToken}.cookies`)) {
      const previous = input.fs.readText(input.indexPath)
      if (previous === null || JSON.parse(previous).cookieKeyRef !== cookieKeyRef) {
        if (!input.protectedCookies?.deleteKey?.(cookieKeyRef)) throw new Error('protected-cookie-key-cleanup-failed')
      }
    }
    throw error
  }

  return redactImportSummary({
    dryRun: input.dryRun,
    profileId: input.profile.id,
    counts: {
      history: history.length,
      bookmarks: bookmarks.length,
      cookies: cookieCount,
      credentials: credentialCount,
      skipped,
    },
    accessedStores: accessed,
    rollbackToken,
    deletionReceipt: null,
  })
}

export function rollbackImport(fs: ProfileFs, indexPath: string, token: string,
  cookies?: { vaultPath: string; deleteKey(reference: string): boolean }): boolean {
  if (!/^rb-[a-zA-Z0-9-]+$/.test(token)) throw new Error('invalid-rollback-token')
  const backup = `${indexPath}.${token}`
  const snapshot = fs.readText(backup)
  if (snapshot === null) return false
  const cookieBackup = `${backup}.cookies`
  const raw = fs.readText(cookieBackup)
  if (raw !== null) {
    const recovery = JSON.parse(raw) as { vaultPath: string; previousVault: string | null; currentKeyRef: string; keyDeleted: boolean }
    if (!cookies || recovery.vaultPath !== cookies.vaultPath || typeof recovery.currentKeyRef !== 'string' ||
      (recovery.previousVault !== null && typeof recovery.previousVault !== 'string')) throw new Error('cookie-rollback-custody-required')
    const currentIndex = fs.readText(indexPath)
    if (currentIndex !== snapshot && JSON.parse(currentIndex ?? '{}').cookieKeyRef !== recovery.currentKeyRef) {
      throw new Error('cookie-rollback-source-changed')
    }
    if (!recovery.keyDeleted) {
      if (!cookies.deleteKey(recovery.currentKeyRef)) throw new Error('protected-cookie-key-delete-failed')
      recovery.keyDeleted = true
      fs.writeText(cookieBackup, JSON.stringify(recovery))
    }
    if (recovery.previousVault === null) fs.remove(cookies.vaultPath)
    else fs.writeText(cookies.vaultPath, recovery.previousVault)
    if (fs.readText(cookies.vaultPath) !== recovery.previousVault) throw new Error('cookie-rollback-readback-failed')
  }
  fs.writeText(indexPath, snapshot)
  if (fs.readText(indexPath) !== snapshot) throw new Error('import-rollback-readback-failed')
  fs.remove(cookieBackup)
  fs.remove(backup)
  return true
}

export function deleteImportedProfile(input: {
  fs: ProfileFs
  indexPath: string
  vaultPath: string
  protectedCookies?: ProtectedCookieImport
  now?: number
}): { deletionReceipt: { deletedAt: number; categories: ImportCategory[]; itemCount: number } } {
  const raw = input.fs.readText(input.indexPath)
  let itemCount = 0
  let cookieKeyRef: string | undefined
  const categories: ImportCategory[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { bookmarks?: unknown[]; history?: unknown[]; cookieKeyRef?: string }
      itemCount = (parsed.bookmarks?.length ?? 0) + (parsed.history?.length ?? 0)
      cookieKeyRef = parsed.cookieKeyRef
      if (itemCount > 0) categories.push('history_bookmarks')
    } catch {
      itemCount = 0
    }
  }
  const backupPrefix = `${input.indexPath}.rb-`
  const backups = input.fs.listPaths(backupPrefix).filter(path =>
    path.startsWith(backupPrefix) && /^[a-zA-Z0-9-]+(?:\.cookies)?$/.test(path.slice(backupPrefix.length)))
  const ownedKeys = new Set<string>(cookieKeyRef ? [cookieKeyRef] : [])
  for (const path of backups.filter(path => path.endsWith('.cookies'))) {
    const recovery = JSON.parse(input.fs.readText(path) ?? 'null') as { currentKeyRef?: string; vaultPath?: string; keyDeleted?: boolean } | null
    if (!recovery || recovery.vaultPath !== input.vaultPath || !recovery.currentKeyRef) throw new Error('cookie-deletion-recovery-invalid')
    if (!recovery.keyDeleted) ownedKeys.add(recovery.currentKeyRef)
  }
  const deletionJournal = `${input.indexPath}.delete-custody`
  const savedDeletion = input.fs.readText(deletionJournal)
  const pending: string[] = savedDeletion === null ? [...ownedKeys] : JSON.parse(savedDeletion)
  if (!Array.isArray(pending) || pending.some(reference => typeof reference !== 'string')) throw new Error('cookie-deletion-recovery-invalid')
  input.fs.writeText(deletionJournal, JSON.stringify(pending))
  while (pending.length) {
    const reference = pending[0]!
    if (!input.protectedCookies?.deleteKey || !input.protectedCookies.deleteKey(reference)) throw new Error('protected-cookie-key-delete-failed')
    pending.shift()
    input.fs.writeText(deletionJournal, JSON.stringify(pending))
  }
  // Only exact owned rollback filenames are removed; other profile/history files stay intact.
  for (const path of backups) input.fs.remove(path)
  if (input.fs.exists(input.vaultPath)) {
    categories.push('cookies')
    input.fs.remove(input.vaultPath)
    input.fs.remove(`${input.vaultPath}.key`)
  }
  if (raw) input.fs.remove(input.indexPath)
  input.fs.remove(deletionJournal)
  return {
    deletionReceipt: {
      deletedAt: input.now ?? Date.now(),
      categories,
      itemCount,
    },
  }
}

export function redactImportSummary(summary: ImportSummary): ImportSummary {
  return JSON.parse(JSON.stringify(summary)) as ImportSummary
}

export function summaryLeaksSecrets(summary: unknown, secrets: string[]): boolean {
  const blob = JSON.stringify(summary)
  return secrets.some((secret) => secret.length > 0 && blob.includes(secret))
}

/** Relative Chromium-family roots (under $HOME). Discovery is read-only. */
export function chromiumRootRel(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [
      'Library/Application Support/Google/Chrome',
      'Library/Application Support/Google/Chrome Canary',
      'Library/Application Support/Google/Chrome Beta',
      'Library/Application Support/Google/Chrome Dev',
      'Library/Application Support/Chromium',
      'Library/Application Support/Microsoft Edge',
      'Library/Application Support/BraveSoftware/Brave-Browser',
      'Library/Application Support/com.operasoftware.Opera',
      'Library/Application Support/com.operasoftware.OperaGX',
      'Library/Application Support/Vivaldi',
      'Library/Application Support/Arc/User Data',
      'Library/Application Support/zen',
      'Library/Application Support/Zen',
      'Library/Application Support/app.zen-browser.zen',
      'Library/Application Support/Perplexity',
      'Library/Application Support/PerplexityComet',
      'Library/Application Support/ChatGPT Atlas',
      'Library/Application Support/OpenAI Atlas',
      'Library/Application Support/Yandex/YandexBrowser',
      'Library/Application Support/Yandex/YandexBrowserEnterprise',
    ]
  }
  if (platform === 'win32') {
    return [
      'AppData/Local/Google/Chrome/User Data',
      'AppData/Local/Google/Chrome SxS/User Data',
      'AppData/Local/Google/Chrome Beta/User Data',
      'AppData/Local/Google/Chrome Dev/User Data',
      'AppData/Local/Chromium/User Data',
      'AppData/Local/Microsoft/Edge/User Data',
      'AppData/Local/BraveSoftware/Brave-Browser/User Data',
      'AppData/Roaming/Opera Software/Opera Stable',
      'AppData/Roaming/Opera Software/Opera GX Stable',
      'AppData/Local/Vivaldi/User Data',
      'AppData/Roaming/zen',
      'AppData/Local/Yandex/YandexBrowser/User Data',
      'AppData/Local/Yandex/YandexBrowserEnterprise/User Data',
      'AppData/Local/Perplexity/User Data',
      'AppData/Local/ChatGPT Atlas/User Data',
    ]
  }
  return [
    '.config/google-chrome',
    '.config/google-chrome-beta',
    '.config/google-chrome-unstable',
    '.config/google-chrome-canary',
    '.config/chromium',
    '.config/microsoft-edge',
    '.config/microsoft-edge-beta',
    '.config/microsoft-edge-dev',
    '.config/BraveSoftware/Brave-Browser',
    '.config/opera',
    '.config/opera-beta',
    '.config/vivaldi',
    '.config/zen',
    '.config/zen-browser',
    '.config/yandex-browser',
    '.config/yandex-browser-beta',
    '.config/perplexity',
    '.config/chatgpt-atlas',
  ]
}

export function firefoxRootRel(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [
      'Library/Application Support/Firefox',
      'Library/Application Support/Firefox Nightly',
      'Library/Application Support/Firefox Developer Edition',
      'Library/Application Support/FirefoxNightly',
      'Library/Application Support/Mozilla/Firefox',
    ]
  }
  if (platform === 'win32') {
    return [
      'AppData/Roaming/Mozilla/Firefox',
      'AppData/Roaming/Mozilla/Firefox Nightly',
      'AppData/Roaming/Mozilla/Firefox Developer Edition',
    ]
  }
  return [
    '.mozilla/firefox',
    '.mozilla/firefox-nightly',
    '.mozilla/firefox-dev',
    '.mozilla/firefox-developer-edition',
  ]
}

function chromiumRoots(home: string, platform: NodeJS.Platform): string[] {
  return chromiumRootRel(platform).map((rel) => `${home}/${rel}`)
}

function firefoxRoots(home: string, platform: NodeJS.Platform): string[] {
  return firefoxRootRel(platform).map((rel) => `${home}/${rel}`)
}

function discoverChromium(root: string, fs: ProfileFs): DiscoveredProfile[] {
  if (!fs.exists(root)) return []
  const localStateRaw = fs.readText(`${root}/Local State`)
  if (localStateRaw === null) {
    return [{
      id: `chromium:${root}`,
      family: 'chromium',
      name: 'Chromium',
      path: `${root}/Default`,
      lastUsedAt: null,
      recommended: false,
      state: fs.exists(`${root}/Default`) ? 'ok' : 'unsupported',
    }]
  }
  let parsed: { profile?: { info_cache?: Record<string, { name?: string; active_time?: number }> } }
  try {
    parsed = JSON.parse(localStateRaw)
  } catch {
    return [{
      id: `chromium:${root}:corrupt`,
      family: 'chromium',
      name: 'Chromium',
      path: root,
      lastUsedAt: null,
      recommended: false,
      state: 'corrupt',
    }]
  }
  const cache = parsed.profile?.info_cache ?? {}
  const dirs = Object.keys(cache)
  if (dirs.length === 0 && fs.exists(`${root}/Default`)) {
    return [chromiumProfile(root, 'Default', 'Person 1', null, fs)]
  }
  return dirs.map((dir) => chromiumProfile(root, dir, cache[dir]?.name ?? dir, cache[dir]?.active_time ?? null, fs))
}

function chromiumProfile(
  root: string,
  dir: string,
  name: string,
  lastUsedAt: number | null,
  fs: ProfileFs,
): DiscoveredProfile {
  const path = `${root}/${dir}`
  return {
    id: `chromium:${path}`,
    family: 'chromium',
    name,
    path,
    lastUsedAt,
    recommended: false,
    state: profileState(path, fs, `${path}/Bookmarks`),
  }
}

function discoverFirefox(root: string, fs: ProfileFs): DiscoveredProfile[] {
  if (!fs.exists(root)) return []
  const ini = fs.readText(`${root}/profiles.ini`)
  if (ini === null) {
    return [{
      id: `firefox:${root}`,
      family: 'firefox',
      name: 'Firefox',
      path: root,
      lastUsedAt: null,
      recommended: false,
      state: 'unsupported',
    }]
  }
  const profiles: DiscoveredProfile[] = []
  const blocks = ini.split(/\[Profile\d+\]/i).slice(1)
  for (const block of blocks) {
    const name = /Name=(.+)/i.exec(block)?.[1]?.trim() ?? 'Firefox'
    const relative = /Path=(.+)/i.exec(block)?.[1]?.trim()
    const isRelative = /IsRelative=1/i.test(block)
    if (!relative) continue
    const path = isRelative ? `${root}/${relative}` : relative
    profiles.push({
      id: `firefox:${path}`,
      family: 'firefox',
      name,
      path,
      lastUsedAt: null,
      recommended: false,
      state: profileState(path, fs, `${path}/places.sqlite`),
    })
  }
  return profiles
}

function discoverSafari(path: string, fs: ProfileFs): DiscoveredProfile[] {
  if (!fs.exists(path)) return []
  return [{
    id: `safari:${path}`,
    family: 'safari',
    name: 'Safari',
    path,
    lastUsedAt: null,
    recommended: false,
    state: profileState(path, fs, `${path}/Bookmarks.plist`),
  }]
}

function profileState(path: string, fs: ProfileFs, probeFile: string): ProfileImportState {
  if (!fs.exists(path)) return 'locked'
  if (fs.exists(`${path}/lock`) || fs.exists(`${path}/SingletonLock`) || fs.exists(`${path}/parent.lock`)) {
    return 'running'
  }
  if (fs.exists(probeFile)) {
    const raw = fs.readText(probeFile)
    if (raw !== null && probeFile.endsWith('Bookmarks') && raw.trim().startsWith('{')) {
      try {
        JSON.parse(raw)
      } catch {
        return 'corrupt'
      }
    }
  }
  return 'ok'
}

function collectChromeBookmarks(nodes: unknown[], out: IndexedItem[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const record = node as { type?: string; url?: string; name?: string; children?: unknown[] }
    if (record.type === 'url' && record.url) {
      out.push({ kind: 'bookmark', url: record.url, title: record.name ?? '' })
    }
    if (Array.isArray(record.children)) collectChromeBookmarks(record.children, out)
  }
}

function dedupeItems(items: IndexedItem[]): IndexedItem[] {
  const seen = new Set<string>()
  const out: IndexedItem[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.url}`
    if (seen.has(key) || !item.url) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function firstExisting(fs: ProfileFs, paths: string[]): string | null {
  return paths.find((path) => fs.exists(path)) ?? null
}

function firstSecret(fs: ProfileFs, profilePath: string): string | null {
  return firstExisting(fs, COOKIE_STORE_BASENAMES.map((name) => `${profilePath}/${name}`))
}

function countCookieRecords(raw: string): number {
  if (!raw) return 0
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object' && 'cookies' in parsed && Array.isArray(parsed.cookies)) {
      return parsed.cookies.length
    }
  } catch {
    /* The encrypted cookie payload format may be provider-specific. */
  }
  return raw.split('\n').filter((line) => line.includes('=') || line.includes('\t')).length || 1
}

function countCredentialRecords(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { logins?: unknown[] }
    if (Array.isArray(parsed.logins)) return parsed.logins.length
  } catch {
    /* sqlite/binary stores: presence counts as one sealed record, never the secret */
  }
  return raw ? 1 : 0
}

function sealCookieBlob(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({
    alg: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: encrypted.toString('hex'),
  })
}

function emptySummary(profileId: string, dryRun: boolean): ImportSummary {
  return {
    dryRun,
    profileId,
    counts: { history: 0, bookmarks: 0, cookies: 0, credentials: 0, skipped: 1 },
    accessedStores: [],
    rollbackToken: null,
    deletionReceipt: null,
  }
}

function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}
