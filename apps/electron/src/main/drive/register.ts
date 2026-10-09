/**
 * ROX Drive (wave 1) — host composition.
 *
 * Wires the device-local engine into the RPC dependency bag. The Electron main
 * process calls `createDriveService()` once per process; there is no shared
 * global, so tests can construct an isolated engine with `createLocalDrive`.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from '@rox/shared/config'
import type { DriveService } from '@rox/server-core/handlers'
import { createLocalDrive } from './local-drive'

export interface CreateDriveServiceOptions {
  configDir?: string
  homeDir?: string
}

export function createDriveService(options: CreateDriveServiceOptions = {}): DriveService {
  const configDir = options.configDir ?? CONFIG_DIR
  return createLocalDrive({
    rootDir: join(configDir, 'drive'),
    homeDir: options.homeDir ?? homedir(),
  })
}

export { createLocalDrive }
export type { LocalDriveOptions } from './local-drive'