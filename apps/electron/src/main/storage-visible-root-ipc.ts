/**
 * W1-13 (#1510): Settings → "Visible Rox home" toggle for the
 * `storage.visible-root.v1` workbench flag (default OFF).
 *
 * The flag decides where the config dir resolves, which happens once at
 * process start, so a change only takes effect on the next launch: `set`
 * persists `workbench-flags.json` atomically (via the shared writer) and never
 * moves data, re-resolves paths, or creates `~/rox` in this process. The
 * renderer shows a restart affordance while `restartRequired` is true.
 */
import { homedir } from 'node:os'
import { isVisibleRoxHomeActive } from '@rox/shared/config'
import {
  readPersistedVisibleRootFlag,
  visibleRootEnvOverride,
  writePersistedVisibleRootFlag,
} from '@rox/shared/identity'
import {
  STORAGE_VISIBLE_ROOT_CHANNELS,
  type StorageVisibleRootState,
} from '../shared/storage-visible-root'

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>
type SenderEvent = { sender: { id: number } }

export interface StorageVisibleRootIpcDependencies {
  ipcMain: { handle(channel: string, listener: (event: SenderEvent, input?: unknown) => unknown): void }
  /** Only managed app windows may read or change the flag. */
  isTrustedSender(event: SenderEvent): boolean
  env?: Env
  homeDir?: string
  /** Flag state this process launched with (per-process cached probe). */
  activeAtLaunch?: boolean
}

export function createStorageVisibleRootHandlers(options: {
  env?: Env
  homeDir?: string
  activeAtLaunch?: boolean
} = {}): { get(): StorageVisibleRootState; set(input: unknown): StorageVisibleRootState } {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  const activeAtLaunch = options.activeAtLaunch ?? isVisibleRoxHomeActive(env, homeDir)
  const configDirOverride = Boolean(env.ROX_CONFIG_DIR?.trim() || env.CRAFT_CONFIG_DIR?.trim())
  const locked = configDirOverride || visibleRootEnvOverride(env) !== undefined

  const get = (): StorageVisibleRootState => {
    const enabled = readPersistedVisibleRootFlag(homeDir)
    return { enabled, activeAtLaunch, locked, restartRequired: !locked && enabled !== activeAtLaunch }
  }
  const set = (input: unknown): StorageVisibleRootState => {
    if (typeof input !== 'boolean') throw new Error('STORAGE_VISIBLE_ROOT_INVALID')
    if (locked) throw new Error('STORAGE_VISIBLE_ROOT_LOCKED')
    writePersistedVisibleRootFlag(input, homeDir)
    return get()
  }
  return { get, set }
}

export function registerStorageVisibleRootIpc(deps: StorageVisibleRootIpcDependencies): void {
  const handlers = createStorageVisibleRootHandlers(deps)
  const authorize = (event: SenderEvent) => {
    if (!deps.isTrustedSender(event)) throw new Error('STORAGE_VISIBLE_ROOT_DENIED')
  }
  deps.ipcMain.handle(STORAGE_VISIBLE_ROOT_CHANNELS.GET, (event) => {
    authorize(event)
    return handlers.get()
  })
  deps.ipcMain.handle(STORAGE_VISIBLE_ROOT_CHANNELS.SET, (event, input) => {
    authorize(event)
    return handlers.set(input)
  })
}
