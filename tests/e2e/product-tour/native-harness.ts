import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const repository = resolve(import.meta.dirname, '../../..')

/** Reuses the existing meeting harness isolation boundaries; real product entrypoint only. */
export async function bootNativeProduct(): Promise<{ app: ElectronApplication; page: Page; dispose(): Promise<void> }> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Native acceptance requires macOS or Windows; Linux is NOT_RUN.')
  const main = resolve(repository, 'apps/electron/dist/main.cjs')
  if (!existsSync(main)) throw new Error('Build the product Electron entrypoint first.')
  const require = createRequire(import.meta.url)
  const executablePath: string = require('electron')
  const profile = await mkdtemp(join(tmpdir(), 'rox-product-tour-native-'))
  for (const child of ['home', 'config', 'userData', 'tmp', 'appData', 'localAppData']) await mkdir(join(profile, child))
  const env: Record<string, string> = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (process.env[name]) env[name] = process.env[name]!
  }
  Object.assign(env, {
    HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
    ROX_CONFIG_DIR: join(profile, 'config'), CRAFT_CONFIG_DIR: join(profile, 'config'),
    ROX_USER_DATA_DIR: join(profile, 'userData'), CRAFT_USER_DATA_DIR: join(profile, 'userData'),
    TMPDIR: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'),
    APPDATA: join(profile, 'appData'), LOCALAPPDATA: join(profile, 'localAppData'),
    CRAFT_INSTANCE_NUMBER: `product-tour-native-${process.pid}`,
  })
  let app: ElectronApplication
  try { app = await _electron.launch({ executablePath, args: [main], cwd: repository, env }) }
  catch (error) { await rm(profile, { recursive: true, force: true }); throw error }
  const page = await app.firstWindow()
  return { app, page, async dispose() { await app.close(); await rm(profile, { recursive: true, force: true }) } }
}
