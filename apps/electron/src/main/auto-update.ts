/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. Updates are served from https://agents.craft.do/electron/latest
 * using the generic provider (YAML manifests + binaries on R2/S3).
 *
 * Platform behavior:
 * - macOS: Downloads zip, extracts and swaps app bundle atomically
 * - Windows: Downloads NSIS installer, runs silently on quit
 * - Linux: Downloads AppImage, replaces current file
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 * quitAndInstall() handles restart natively — no external scripts.
 */

import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { platform } from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { mainLog, autoUpdateLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { readJsonFileSync } from '@craft-agent/shared/utils/files'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'
import {
  shouldSuppressUpdateFeed,
  shouldAcceptReadyUpdate,
} from './auto-update-policy'
import { execFileSync, spawnSync } from 'child_process'

// Platform detection
const PLATFORM = platform()
const IS_MAC = PLATFORM === 'darwin'
const IS_WINDOWS = PLATFORM === 'win32'

// electron-builder.yml sets updaterCacheDirName; fall back to app.getName()-updater.
const DEFAULT_UPDATER_CACHE_DIR_NAME = '@craft-agentelectron-updater'

function readUpdaterCacheDirName(): string {
  try {
    const ymlPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app-update.yml')
      : path.join(app.getAppPath(), 'dev-app-update.yml')
    if (fs.existsSync(ymlPath)) {
      const raw = fs.readFileSync(ymlPath, 'utf8')
      const match = raw.match(/^updaterCacheDirName:\s*['"]?([^'"\n]+)['"]?\s*$/m)
      if (match?.[1]) return match[1].trim()
    }
  } catch {
    // ignore — use defaults
  }
  return DEFAULT_UPDATER_CACHE_DIR_NAME
}

function getUpdaterCacheRoots(): string[] {
  const names = new Set<string>([readUpdaterCacheDirName(), `${app.getName()}-updater`])
  const roots: string[] = []
  for (const name of names) {
    if (IS_MAC) {
      roots.push(path.join(app.getPath('home'), 'Library', 'Caches', name))
    } else if (IS_WINDOWS) {
      const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
      roots.push(path.join(localAppData, name))
    } else {
      roots.push(path.join(app.getPath('home'), '.cache', name))
    }
  }
  return roots
}

function getUpdateCacheDir(): string {
  // Prefer a pending dir that already exists (stale download may live here).
  for (const root of getUpdaterCacheRoots()) {
    const pending = path.join(root, 'pending')
    if (fs.existsSync(pending)) return pending
  }
  return path.join(getUpdaterCacheRoots()[0]!, 'pending')
}

/** Detect macOS ad-hoc / unsigned local dist (CSC_IDENTITY_AUTO_DISCOVERY=false). */
function detectMacAdHocSigned(execPath: string): boolean {
  if (!IS_MAC) return false
  try {
    const result = spawnSync('codesign', ['-dv', '--verbose=4', execPath], { encoding: 'utf8' })
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    if (/Signature=adhoc/i.test(out)) return true
    if (/code object is not signed/i.test(out)) return true
  } catch {
    try {
      execFileSync('codesign', ['-dv', '--verbose=4', execPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? err)
      if (/Signature=adhoc/i.test(stderr)) return true
      if (/code object is not signed/i.test(stderr)) return true
    }
  }
  return false
}

function isUpdateFeedSuppressed(): boolean {
  return shouldSuppressUpdateFeed({
    craftDevRuntime: process.env.CRAFT_DEV_RUNTIME,
    homeDir: app.getPath('home'),
    execPath: process.execPath,
    isAdHocSigned: detectMacAdHocSigned(process.execPath),
  })
}

/**
 * Clear stale downloadedUpdateHelper / pending cache when the channel is
 * local/dev/ad-hoc or a cached version cannot be accepted for the feed.
 */
async function clearStaleDownloadedUpdate(reason: string): Promise<void> {
  try {
    // @ts-expect-error - internal electron-updater API
    const helper = autoUpdater.downloadedUpdateHelper as { clear?: () => Promise<void> } | null
    if (helper?.clear) {
      await helper.clear()
    }
  } catch (error) {
    mainLog.warn('[auto-update] downloadedUpdateHelper.clear failed:', error)
  }

  for (const root of getUpdaterCacheRoots()) {
    const pending = path.join(root, 'pending')
    try {
      if (fs.existsSync(pending)) {
        fs.rmSync(pending, { recursive: true, force: true })
        mainLog.info(`[auto-update] Removed pending update cache: ${pending} (${reason})`)
      }
    } catch (error) {
      mainLog.warn(`[auto-update] Failed to remove ${pending}:`, error)
    }
  }

  if (updateInfo.available || updateInfo.downloadState === 'ready' || updateInfo.downloadState === 'downloading') {
    updateInfo = {
      ...updateInfo,
      available: false,
      latestVersion: null,
      downloadState: 'idle',
      downloadProgress: 0,
      error: undefined,
    }
    broadcastUpdateInfo()
  }
}

function markUpdateReady(feedVersion: string, cachedVersion?: string | null): boolean {
  if (!shouldAcceptReadyUpdate({
    localVersion: updateInfo.currentVersion,
    feedVersion,
    cachedVersion,
  })) {
    mainLog.info(
      `[auto-update] Ignoring ready state (local=${updateInfo.currentVersion}, feed=${feedVersion}, cached=${cachedVersion ?? 'n/a'})`,
    )
    void clearStaleDownloadedUpdate('ready-version-mismatch')
    return false
  }
  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: feedVersion,
    downloadState: 'ready',
    downloadProgress: 100,
  }
  broadcastUpdateInfo()
  return true
}

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false

// Hook fired immediately before quitAndInstall, while BrowserWindows still exist.
// electron-updater destroys windows between quitAndInstall and before-quit firing,
// so the regular before-quit save site would see an empty array.
let beforeUpdateQuitHook: (() => void) | null = null

// Hook fired (awaited) immediately before quitAndInstall, AFTER the window
// snapshot. index.ts uses it to flush sessions + release resources BEFORE the
// installer quit, so before-quit no longer needs to preventDefault (which
// cancelled Squirrel.Mac's quit and left the update downloaded-but-not-installed).
let beforeUpdateInstallHook: (() => Promise<void>) | null = null

// Hook fired when quitAndInstall throws AFTER beforeUpdateInstallHook already tore
// the app down (sessions flushed, services disposed, lock released, isQuitting set).
// The process cannot safely keep running at that point — index.ts uses this to
// inform the user and relaunch into a fresh process instead of leaving a zombie
// app whose next quit would skip the flush entirely (#891).
let installQuitFailedHook: (() => void) | null = null

/**
 * Register a callback to run inside installUpdate() before quitAndInstall.
 * Used by index.ts to snapshot multi-window state while windows are still alive.
 */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
}

/**
 * Register an async callback run (awaited) inside installUpdate() right before
 * quitAndInstall. index.ts uses it to run the full quit cleanup so the installer
 * handoff isn't interrupted by the before-quit handler's preventDefault (#891).
 */
export function setBeforeUpdateInstallHook(fn: () => Promise<void>): void {
  beforeUpdateInstallHook = fn
}

/**
 * Register the recovery callback for a quitAndInstall failure that happens after
 * the install cleanup hook already ran. index.ts relaunches the app from it.
 */
export function setInstallQuitFailedHook(fn: () => void): void {
  installQuitFailedHook = fn
}

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Auto-download updates in the background after detection
autoUpdater.autoDownload = true

// Install on app quit (if update is downloaded but user hasn't clicked "Restart")
autoUpdater.autoInstallOnAppQuit = true

// Release-channel override without rebuilding electron-builder.yml. Production
// keeps the build-baked publish config (agents.craft.do); for forks/OSS builds
// point this at any generic-updater host that serves latest-*.yml (e.g. a
// GitHub release URL), e.g.:
//   CRAFT_UPDATER_URL=https://<host>/path/to/channel
//   CRAFT_UPDATER_URL=github://<owner>/<repo>  (uses the GitHub provider)
const updaterUrlOverride = process.env.CRAFT_UPDATER_URL
if (updaterUrlOverride) {
  const githubMatch = updaterUrlOverride.match(/^github:\/\/([^/]+)\/([^/]+)$/)
  if (githubMatch) {
    autoUpdater.setFeedURL({ provider: 'github', owner: githubMatch[1]!, repo: githubMatch[2]! })
  } else {
    autoUpdater.setFeedURL({ provider: 'generic', url: updaterUrlOverride })
  }
  mainLog.info('[auto-update] Using overridden feed provider')
}

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', (info) => {
  autoUpdateLog.info(`Update available: ${updateInfo.currentVersion} → ${info.version}`)

  if (!shouldAcceptReadyUpdate({
    localVersion: updateInfo.currentVersion,
    feedVersion: info.version,
  })) {
    mainLog.info(`[auto-update] Feed ${info.version} not newer than local ${updateInfo.currentVersion}; ignoring`)
    void clearStaleDownloadedUpdate('feed-not-newer')
    updateInfo = {
      ...updateInfo,
      available: false,
      latestVersion: info.version,
      downloadState: 'idle',
      downloadProgress: 0,
    }
    broadcastUpdateInfo()
    return
  }

  // First, check electron-updater's internal state (most reliable)
  const internalState = checkElectronUpdaterState()
  if (internalState.ready) {
    mainLog.info(`[auto-update] electron-updater reports download ready`)
    if (markUpdateReady(info.version, internalState.version ?? info.version)) return
  }

  // Fallback: check if file exists in cache directory
  const existing = checkForExistingDownload()
  if (existing.exists) {
    mainLog.info(`[auto-update] Update already downloaded (file check), setting state to ready`)
    if (markUpdateReady(info.version, existing.version ?? null)) return
  }

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'downloading',
    downloadProgress: 0,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', async (info) => {
  autoUpdateLog.info(`Update downloaded: v${info.version}`)

  if (!markUpdateReady(info.version, info.version)) {
    return
  }

  // Rebuild menu to show "Install Update..." option
  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
})

autoUpdater.on('error', (error) => {
  autoUpdateLog.error('electron-updater error', error)

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Check if electron-updater already has a validated download ready.
 * This uses electron-updater's internal state which is more reliable than file checks.
 */
function checkElectronUpdaterState(): { ready: boolean; version?: string } {
  try {
    // Access electron-updater's internal downloadedUpdateHelper
    // @ts-expect-error - accessing internal API for reliability
    const helper = autoUpdater.downloadedUpdateHelper
    if (helper) {
      mainLog.info(`[auto-update] downloadedUpdateHelper exists, cacheDir: ${helper.cacheDir}`)
      // @ts-expect-error - accessing internal API
      const versionInfo = helper.versionInfo
      if (versionInfo) {
        mainLog.info(`[auto-update] electron-updater has validated download: ${JSON.stringify(versionInfo)}`)
        const version = versionInfo.version as string | undefined
        if (version && !shouldAcceptReadyUpdate({
          localVersion: updateInfo.currentVersion,
          feedVersion: version,
          cachedVersion: version,
        })) {
          mainLog.info(`[auto-update] Ignoring stale downloadedUpdateHelper version ${version}`)
          void clearStaleDownloadedUpdate('stale-helper-version')
          return { ready: false }
        }
        return { ready: true, version }
      }
    }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking electron-updater state:', error)
  }
  return { ready: false }
}

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true) */
  autoDownload?: boolean
}

/**
 * Check if a downloaded update already exists in the cache directory.
 * This helps detect updates that were downloaded in a previous session.
 */
function checkForExistingDownload(): { exists: boolean; version?: string } {
  try {
    const cacheDir = getUpdateCacheDir()
    mainLog.info(`[auto-update] Checking cache directory: ${cacheDir}`)

    if (!fs.existsSync(cacheDir)) {
      mainLog.info(`[auto-update] Cache directory does not exist`)
      return { exists: false }
    }

    const files = fs.readdirSync(cacheDir)
    mainLog.info(`[auto-update] Files in cache: ${JSON.stringify(files)}`)

    // Look for update info file that electron-updater creates
    const updateInfoFile = files.find(f => f === 'update-info.json')
    if (updateInfoFile) {
      const infoPath = path.join(cacheDir, updateInfoFile)
      const info = readJsonFileSync(infoPath) as Record<string, unknown> | null
      mainLog.info(`[auto-update] update-info.json contents: ${JSON.stringify(info)}`)

      // electron-updater uses 'fileName' (not 'path') in update-info.json
      const fileName = (info?.fileName || info?.path) as string | undefined
      if (fileName && fs.existsSync(path.join(cacheDir, fileName))) {
        mainLog.info(`[auto-update] Found existing download via update-info.json: ${fileName}`)
        return { exists: true, version: info?.version as string }
      }
    }

    // Fallback: check for any installer/zip/dmg file
    const downloadFile = files.find(f =>
      f.endsWith('.zip') ||
      f.endsWith('.exe') ||
      f.endsWith('.AppImage') ||
      f.endsWith('.dmg') ||
      f.endsWith('.nupkg')
    )
    if (downloadFile) {
      mainLog.info(`[auto-update] Found existing download file: ${downloadFile}`)
      return { exists: true }
    }

    mainLog.info(`[auto-update] No existing download found in cache`)
    return { exists: false }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking for existing download:', error)
    return { exists: false }
  }
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  const { autoDownload = true } = options

  if (isUpdateFeedSuppressed()) {
    await clearStaleDownloadedUpdate('suppressed-channel')
    autoUpdateLog.info('Skipping update check (CRAFT_DEV_RUNTIME / ~/Applications / ad-hoc sign)')
    updateInfo = {
      ...updateInfo,
      available: false,
      latestVersion: null,
      downloadState: 'idle',
      downloadProgress: 0,
      error: undefined,
    }
    return getUpdateInfo()
  }

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    // Check for updates - this returns a promise that resolves with the check result
    const result = await autoUpdater.checkForUpdates()

    // If update is available and was already downloaded, the update-downloaded event
    // should fire. Wait a moment for events to settle before returning.
    if (result?.updateInfo) {
      const feedVersion = result.updateInfo.version
      // Give electron-updater time to fire update-downloaded if file exists
      await new Promise(resolve => setTimeout(resolve, 500))

      // Double-check: if we're still showing 'downloading' but file exists, update state
      if (updateInfo.downloadState === 'downloading') {
        const existing = checkForExistingDownload()
        if (existing.exists) {
          mainLog.info('[auto-update] Update already downloaded, updating state to ready')
          markUpdateReady(feedVersion, existing.version ?? null)
        }
      }

      if (updateInfo.downloadState === 'ready' && !shouldAcceptReadyUpdate({
        localVersion: updateInfo.currentVersion,
        feedVersion: updateInfo.latestVersion,
        cachedVersion: updateInfo.latestVersion,
      })) {
        await clearStaleDownloadedUpdate('post-check-version-gate')
      }
    }
  } catch (error) {
    autoUpdateLog.error('Update check failed', error)
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Check failed',
    }
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

export async function installUpdate(): Promise<void> {
  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  autoUpdateLog.info('Installing update and restarting...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true

  // Diagnostic correlation with before-quit's [update-flow] log. If these
  // window counts diverge, electron-updater is destroying windows between
  // here and before-quit firing — confirms the multi-window restore bug.
  autoUpdateLog.info('installUpdate pre-quit', {
    electronWindowCount: BrowserWindow.getAllWindows().length,
    downloadState: updateInfo.downloadState,
    latestVersion: updateInfo.latestVersion,
  })

  // Snapshot window state BEFORE quitAndInstall — electron-updater destroys
  // BrowserWindows between this call and before-quit firing, so the regular
  // before-quit save would clobber window-state.json with an empty array.
  try {
    beforeUpdateQuitHook?.()
  } catch (err) {
    autoUpdateLog.error('beforeUpdateQuit hook failed', err)
  }

  // Run the app's quit cleanup (session flush, timers, lock release) BEFORE the
  // installer hands off. This lets the before-quit handler skip its own
  // preventDefault-based cleanup, so Squirrel.Mac's quit runs to a real exit and
  // the update actually installs (#891).
  try {
    await beforeUpdateInstallHook?.()
  } catch (err) {
    autoUpdateLog.error('beforeUpdateInstall cleanup hook failed', err)
  }

  try {
    // isSilent=false shows the installer UI on Windows if needed (fallback)
    // isForceRunAfter=true ensures the app relaunches after install
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    __isUpdating = false
    autoUpdateLog.error('quitAndInstall failed', error)
    updateInfo = { ...updateInfo, downloadState: 'error' }
    broadcastUpdateInfo()
    // beforeUpdateInstallHook already tore the app down — recover via the
    // registered relaunch hook instead of leaving a zombie process (#891).
    try {
      installQuitFailedHook?.()
    } catch (hookErr) {
      autoUpdateLog.error('installQuitFailed hook failed', hookErr)
    }
    throw error
  }
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}


export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  if (isUpdateFeedSuppressed()) {
    await clearStaleDownloadedUpdate('launch-suppressed-channel')
    autoUpdateLog.info('Skipping auto-update feed (CRAFT_DEV_RUNTIME / ~/Applications / ad-hoc sign)')
    return { action: 'skipped', reason: 'local-or-dev-channel' }
  }

  autoUpdateLog.info('Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress — will notify when ready via update-downloaded event
  return { action: 'downloading', version: info.latestVersion }
}
