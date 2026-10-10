/**
 * ROX Drive (wave 1 + wave 4) — host composition.
 *
 * Wires the device-local engine into the RPC dependency bag and composes the
 * cloud-import pipeline once per process. The Electron main process calls
 * `createDriveService()` once per process; there is no shared global, so tests
 * can construct an isolated engine with `createLocalDrive` (or re-compose the
 * import engine with `composeDriveImportEngine({ force: true })`).
 *
 * Cloud import needs an S3-compatible destination, resolved from
 * `ROX_DRIVE_S3_*` in the process env first and then from the operator file
 * `<configDir>/drive-s3.env` (the packaged app never sees shell env). When
 * neither is present the import engine is left uncomposed so `drive:import*`
* it answers `UNSUPPORTED_OPERATION` honestly instead of failing per file at
 * runtime. The app-config mirror engine (`drive:mirror*`, R13) composes from the
 * same `<configDir>/drive-s3.env` destination and is likewise left uncomposed
 * without one.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from '@rox/shared/config'
import type { DriveService } from '@rox/server-core/handlers'
import { configureDriveImport, registerImportProvider } from '@rox/server-core/handlers/rpc/drive'
import {
  createGoogleDriveProvider,
} from '@rox/shared/drive/importers/providers/google-drive'
import { createOneDriveProvider } from '@rox/shared/drive/importers/providers/onedrive'
import { createYandexDiskProvider } from '@rox/shared/drive/importers/providers/yandex-disk'
import { createICloudProvider } from '@rox/shared/drive/importers/providers/icloud'
import {
  createS3UploadTarget,
  loadEnvFile,
  s3TargetOptionsFromEnv,
  type ImportJobRunner,
} from '@rox/shared/drive/importers'
import { createLocalDrive } from './local-drive'
import { composeDriveMirrorEngine } from './mirror'

export interface CreateDriveServiceOptions {
  configDir?: string
  homeDir?: string
  /** Compose the import engine again even if an earlier call already did (tests). */
  forceImportComposition?: boolean
  /** Compose the mirror engine again even if an earlier call already did (tests). */
  forceMirrorComposition?: boolean
}

let importEngineComposed = false

/**
 * Compose the `drive:import*` engine: register the four provider adapters and
 * hand the runner a persistent state dir under the config dir. Idempotent per
 * process; pass `{ forceImportComposition: true }` to recompose in tests.
 */
export function composeDriveImportEngine(options: CreateDriveServiceOptions = {}): ImportJobRunner | null {
  if (importEngineComposed && !options.forceImportComposition) return null
  importEngineComposed = true
  const configDir = options.configDir ?? CONFIG_DIR
  try {
    // Google's client id/secret are the PKCE broker's (drive:importAuthStart),
    // so the provider's refresh path uses the same credentials.
    registerImportProvider(createGoogleDriveProvider({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }))
    registerImportProvider(createOneDriveProvider({ clientId: process.env.ROX_MS_CLIENT_ID }))
    registerImportProvider(createYandexDiskProvider({
      clientId: process.env.ROX_YANDEX_CLIENT_ID,
      clientSecret: process.env.ROX_YANDEX_CLIENT_SECRET,
    }))
    registerImportProvider(createICloudProvider())
    // Env first (dev/server), then the operator file the packaged app can read
    // even though it never sees the shell environment.
    const direct = s3TargetOptionsFromEnv(process.env)
    const fromFile = direct ? null : s3TargetOptionsFromEnv(loadEnvFile(join(configDir, 'drive-s3.env')))
    const options = direct ?? fromFile
    return configureDriveImport({
      stateDir: join(configDir, 'drive', 'imports'),
      concurrency: 4,
      maxAttempts: 3,
      target: options ? createS3UploadTarget(options) : undefined,
    })
  } catch (error) {
    // No ROX_DRIVE_S3_* target (or a bad one): leave imports uncomposed so the
    // RPC surface reports UNSUPPORTED_OPERATION rather than a half-built runner.
    console.warn(`[drive] cloud import engine not composed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export function createDriveService(options: CreateDriveServiceOptions = {}): DriveService {
  const configDir = options.configDir ?? CONFIG_DIR
  composeDriveImportEngine(options)
  composeDriveMirrorEngine({ configDir, forceMirrorComposition: options.forceMirrorComposition })
  return createLocalDrive({
    rootDir: join(configDir, 'drive'),
    homeDir: options.homeDir ?? homedir(),
  })
}

export { createLocalDrive }
export type { LocalDriveOptions } from './local-drive'