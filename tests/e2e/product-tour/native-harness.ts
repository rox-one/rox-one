import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, open, readdir, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { observeFirstNativeWindow } from './native-startup'

const repository = resolve(import.meta.dirname, '../../..')
const LOG_TAIL_LIMIT = 16 * 1024
const PROFILE_LOG_PATHS = [join('home', 'Library', 'Logs', 'Electron', 'main.log'), join('userData', 'logs', 'main.log')]

/**
 * How long one profile release may take before the lane gives up on it.
 *
 * CI keeps the profile (`ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE=1`) and every boot
 * resets it, so the reset removes a tree the previous test's app may still be
 * writing into: the app provisions the `omp` toolchain (`toolchain/omp/<ver>/
 * package` + `npm ci` into its `node_modules`, `onnxruntime-web` among them)
 * from a process that outlives `app.close()` — Playwright's shutdown only owns
 * the Electron main process — and the downloader retries with a
 * [5 s, 30 s, 2 m] backoff. A single un-retried `rm` therefore loses that race
 * and dies with `ENOTEMPTY: directory not empty, rmdir` on a directory the
 * writer had just repopulated, which is what failed MEMREPO-NATIVE-02 at 719 ms.
 * The provisioning is finite, so retrying inside one bounded budget converges;
 * the budget is generous because the alternative is a red lane that hides which
 * test really failed.
 */
const PROFILE_RELEASE_BUDGET_MS = 60_000
/** How long to pause between release attempts (rm re-walks the whole tree). */
const PROFILE_RELEASE_PAUSE_MS = 250
/** How many leftover paths a failed release names — evidence, not a tree dump. */
const PROFILE_LEFTOVER_LIMIT = 24

/** Depth-first sample of whatever is still under `root`, bounded to `limit` entries. */
async function leftoverPaths(root: string, limit = PROFILE_LEFTOVER_LIMIT): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (found.length >= limit) return
      const path = join(directory, entry.name)
      found.push(relative(root, path) + (entry.isDirectory() ? '/' : ''))
      if (entry.isDirectory()) await walk(path)
    }
  }
  await walk(root)
  return found
}

/**
 * Remove the owned profile, outlasting the app's own writer instead of losing
 * the race to it (see `PROFILE_RELEASE_BUDGET_MS`).
 *
 * Never throws and never fails a test: provisioning that is still running is the
 * app's own state, not this lane's verdict. A release that cannot finish inside
 * the budget is reported with the paths that stayed behind, so a profile left
 * half-released explains itself in the job log instead of surfacing later as a
 * first-run screen that never appears.
 */
async function releaseProfile(profile: string): Promise<void> {
  const deadline = Date.now() + PROFILE_RELEASE_BUDGET_MS
  for (let attempt = 1; ; attempt += 1) {
    try {
      // No `maxRetries`: this loop owns both the cadence and the budget, so a
      // retry can never overshoot the deadline by re-walking the tree twice.
      await rm(profile, { recursive: true, force: true })
      return
    } catch (error) {
      if (Date.now() >= deadline) {
        const leftovers = await leftoverPaths(profile)
        console.error(`native harness: profile release of ${profile} gave up after ${attempt} attempt(s) in ${PROFILE_RELEASE_BUDGET_MS}ms: ${String(error)}; `
          + (leftovers.length
            ? `${leftovers.length}${leftovers.length >= PROFILE_LEFTOVER_LIMIT ? '+' : ''} entr${leftovers.length === 1 ? 'y' : 'ies'} still present: ${leftovers.join(', ')}`
            : 'nothing is present any more'))
        return
      }
      await delay(PROFILE_RELEASE_PAUSE_MS)
    }
  }
}

/** Test-only startup evidence the native spec attaches to its Playwright report. */
interface NativeStartupDiagnostics {
  profile: string
  profileLogs: Array<{ path: string; tail: string }>
  scope: 'Owned fresh-profile startup diagnostics; no native acceptance result'
}

/** Reads only the owned profile's product log, bounded to its tail. */
async function ownedProfileLogs(profile: string): Promise<NativeStartupDiagnostics['profileLogs']> {
  for (const relativePath of PROFILE_LOG_PATHS) {
    const file = await open(join(profile, relativePath), 'r').catch(() => null)
    if (!file) continue
    try {
      const size = (await file.stat()).size
      const bytes = Buffer.alloc(Math.min(size, LOG_TAIL_LIMIT))
      const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length))
      return [{ path: relativePath, tail: bytes.subarray(0, bytesRead).toString('utf8') }]
    } finally { await file.close() }
  }
  return []
}

/** Reuses the existing meeting harness isolation boundaries; real product entrypoint only. */
export async function bootNativeProduct(report?: (diagnostics: NativeStartupDiagnostics) => Promise<void>): Promise<{ app: ElectronApplication; page: Page; dispose(): Promise<void> }> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Native acceptance requires macOS or Windows; Linux is NOT_RUN.')
  const main = resolve(repository, 'apps/electron/dist/main.cjs')
  if (!existsSync(main)) throw new Error('Build the product Electron entrypoint first.')
  const require = createRequire(import.meta.url)
  const executablePath: string = require('electron')
  // Playwright only injects its Electron loader when it resolves the binary
  // itself; an explicit `executablePath` suppresses it. Without the loader the
  // app never receives Playwright's chromium switches nor the deferred
  // `app.whenReady()` handshake, so the renderer stays blank and the launch
  // blocks past the deadline. Re-inject the exact loader Playwright would use.
  const electronLoader = join(dirname(require.resolve('playwright-core/package.json')), 'lib/server/electron/loader.js')
  if (!existsSync(electronLoader)) throw new Error('Playwright Electron loader is required for an instrumented native launch.')
  const profile = resolve(repository, 'test-results/product-tour/native/profiles', String(process.pid))
  // Reused across the spec's tests in one worker (`workers: 1`), so this boot's
  // reset is what makes it a fresh profile — including for the test before it,
  // whose app may still be provisioning the toolchain into it.
  await releaseProfile(profile)
  await mkdir(profile, { recursive: true })
  for (const child of ['home', 'config', 'userData', 'tmp', 'appData', 'localAppData']) await mkdir(join(profile, child))
  const env: Record<string, string> = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (process.env[name]) env[name] = process.env[name]!
  }
  Object.assign(env, {
    // The login keychain must stay reachable: Chromium safeStorage answers
    // isEncryptionAvailable() from the real HOME, and the app fails closed with
    // ROX_OS_SECURE_STORAGE_UNAVAILABLE when it is not (which masks the onboarding).
    HOME: process.env.HOME ?? join(profile, 'home'), USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? join(profile, 'home'),
    ROX_CONFIG_DIR: join(profile, 'config'), CRAFT_CONFIG_DIR: join(profile, 'config'),
    ROX_USER_DATA_DIR: join(profile, 'userData'), CRAFT_USER_DATA_DIR: join(profile, 'userData'),
    TMPDIR: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'),
    APPDATA: join(profile, 'appData'), LOCALAPPDATA: join(profile, 'localAppData'),
    CRAFT_INSTANCE_NUMBER: `product-tour-native-${process.pid}`,
    ROX_DEV_DISABLE_PROTOCOL_REGISTRATION: '1',
    ROX_SKIP_PROTOCOL_REGISTRATION: '1',
    NODE_ENV: 'test',
  })
  let app: ElectronApplication
  try { app = await _electron.launch({ executablePath, args: ['-r', electronLoader, main], cwd: repository, env }) }
  catch (error) { await releaseProfile(profile); throw error }
  const page = await observeFirstNativeWindow(app, profile,
    resolve(repository, 'test-results/product-tour/native', `startup-${process.pid}.json`))
  return { app, page, async dispose() {
    // A stalled Electron shutdown must not consume the parent CLI deadline.
    const shutdown = Promise.withResolvers<void>()
    const bound = setTimeout(() => shutdown.resolve(), 20_000)
    try {
      await Promise.race([app.close().catch(() => {}), shutdown.promise])
      try {
        const child = app.process()
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      } catch { /* close() disposed Playwright's process binding; nothing left to signal */ }
      // Electron writes logs under the real HOME now (the login keychain must stay
      // reachable for safeStorage); copy the log into the profile so both the report
      // attach and a kept CI profile ship it.
      const realHome = process.env.HOME ?? process.env.USERPROFILE
      if (realHome) {
        for (const candidate of [join(realHome, 'Library', 'Logs', 'Rox', 'main.log'), join(realHome, 'Library', 'Logs', 'Electron', 'main.log')]) {
          if (!existsSync(candidate)) continue
          const target = join(profile, 'home', 'Library', 'Logs', 'Electron', 'main.log')
          await mkdir(dirname(target), { recursive: true }).catch(() => {})
          await copyFile(candidate, target).catch(() => {})
          break
        }
      }
      const profileLogs = await ownedProfileLogs(profile).catch(() => [])
      if (report && profileLogs.length) await report({ profile, profileLogs, scope: 'Owned fresh-profile startup diagnostics; no native acceptance result' }).catch(() => {})
    } finally {
      clearTimeout(bound)
      // CI sets ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE=1 so a red lane ships the app log in its artifact.
      if (process.env.ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE === '1') {
        console.error(`native harness: keeping profile for diagnostics: ${profile}`)
      } else {
        // The app's toolchain provisioning can still be writing into the
        // profile after `close()`; `releaseProfile` waits it out and reports
        // what stayed behind instead of failing the test for cleanup.
        await releaseProfile(profile)
      }
    }
  } }
}
