import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, open, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { observeFirstNativeWindow } from './native-startup'

const repository = resolve(import.meta.dirname, '../../..')
const LOG_TAIL_LIMIT = 16 * 1024
const PROFILE_LOG_PATHS = [join('home', 'Library', 'Logs', 'Electron', 'main.log'), join('userData', 'logs', 'main.log')]

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
  await rm(profile, { recursive: true, force: true })
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
  catch (error) { await rm(profile, { recursive: true, force: true }); throw error }
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
      // Provisioning may still be writing into the profile; retry and never fail the test for cleanup.
      // CI sets ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE=1 so a red lane ships the app log in its artifact.
      if (process.env.ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE === '1') {
        console.error(`native harness: keeping profile for diagnostics: ${profile}`)
      } else {
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
          .catch(error => { console.error('native harness: profile cleanup skipped:', error) })
      }
    }
  } }
}
