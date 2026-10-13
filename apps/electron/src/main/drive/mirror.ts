/**
 * ROX Drive (R13 mirror) — host composition of the app-config mirror engine.
 *
 * Wires the frozen core (`@rox/shared/drive/mirror`: catalog scan → incremental
 * plan → durable journal → upload queue) into one engine the RPC surface
 * (`drive:mirror*`) can drive. Like `composeDriveImportEngine`, the mirror
 * needs an S3-compatible destination: `ROX_DRIVE_S3_*` in the process env
 * first, then the operator file `<configDir>/drive-s3.env` (the packaged app
 * never sees the shell environment). Without one the engine is left
 * uncomposed, so `drive:mirror*` answers `UNSUPPORTED_OPERATION` honestly
 * instead of failing per file at runtime.
 *
 * The engine owns no timers: `run()` is the only work entry point and it never
 * overlaps itself. `pause`/`cancel` are honoured even while the catalog is
 * still being scanned (the scan is the long first step), and a cancel during
 * the scan never uploads a single byte.
 */
import { join } from 'node:path'
import { CONFIG_DIR } from '@rox/shared/config'
import {
  createMirrorJournal,
  createMirrorQueue,
  planMirrorDiff,
  scanMirrorCatalog,
  type MirrorJournal,
  type MirrorQueue,
  type MirrorQueueStatus,
  type MirrorRunResult,
} from '@rox/shared/drive'
import {
  createS3UploadTarget,
  loadEnvFile,
  s3TargetOptionsFromEnv,
} from '@rox/shared/drive/importers'
import { configureDriveMirror, type DriveMirrorEngine } from '@rox/server-core/handlers/rpc/drive'

/** Mirror id for the app's own config directory; filename-safe by contract. */
export const APP_CONFIG_MIRROR_ID = 'app-config'

export interface ComposeDriveMirrorOptions {
  configDir?: string
  /** Compose the engine again even if an earlier call already did (tests). */
  forceMirrorComposition?: boolean
}

let mirrorEngineComposed = false

/**
 * Composes the `drive:mirror*` engine: one journal + queue over the state dir
 * under the config dir, uploading into the S3 target. Idempotent per process;
 * pass `{ forceMirrorComposition: true }` to recompose in tests.
 */
export function composeDriveMirrorEngine(options: ComposeDriveMirrorOptions = {}): DriveMirrorEngine | null {
  if (mirrorEngineComposed && !options.forceMirrorComposition) return null
  mirrorEngineComposed = true
  const configDir = options.configDir ?? CONFIG_DIR
  try {
    // Env first (dev/server), then the operator file the packaged app can read.
    const direct = s3TargetOptionsFromEnv(process.env)
    const fromFile = direct ? null : s3TargetOptionsFromEnv(loadEnvFile(join(configDir, 'drive-s3.env')))
    const targetOptions = direct ?? fromFile
    if (!targetOptions) {
      throw new Error('ROX_DRIVE_S3_* target is not configured (env or <configDir>/drive-s3.env)')
    }

    const journal: MirrorJournal = createMirrorJournal({
      stateDir: join(configDir, 'drive', 'mirror'),
      mirrorId: APP_CONFIG_MIRROR_ID,
    })
    const queue: MirrorQueue = createMirrorQueue({
      journal,
      uploadTarget: createS3UploadTarget(targetOptions),
    })

    let inFlight: Promise<MirrorRunResult> | null = null
    let lastResult: MirrorRunResult | null = null
    let scanning = false
    let cancelRequested = false
    let pauseRequested = false

    function run(): Promise<MirrorRunResult> {
      if (inFlight) return inFlight
      cancelRequested = false
      pauseRequested = false
      scanning = true
      inFlight = (async (): Promise<MirrorRunResult> => {
        try {
          const entries = await scanMirrorCatalog({ configDir })
          const record = await journal.load()
          const plan = planMirrorDiff(entries, record)
          // The queue resets its own flags on `enqueue`, so a pause/cancel
          // requested during the scan must short-circuit before it — nothing
          // has been uploaded, and the journal is unchanged (so it resumes).
          if (cancelRequested || pauseRequested) {
            const result: MirrorRunResult = {
              added: 0,
              changed: 0,
              removed: 0,
              bytesUploaded: 0,
              paused: pauseRequested && !cancelRequested,
              cancelled: cancelRequested,
              errors: [],
            }
            lastResult = result
            return result
          }
          queue.enqueue(plan)
          const result = await queue.run()
          lastResult = result
          return result
        } finally {
          scanning = false
          inFlight = null
        }
      })()
      return inFlight
    }

    const engine: DriveMirrorEngine = {
      run,
      pause(): void {
        pauseRequested = true
        queue.pause()
      },
      cancel(): void {
        cancelRequested = true
        queue.cancel()
      },
      status(): MirrorQueueStatus {
        const snapshot = queue.status()
        if (snapshot.state !== 'idle') return snapshot
        // The queue is idle between enqueue and run (and while the catalog is
        // being scanned); surface the user's intent instead of a bare `idle`.
        if (scanning) {
          return { ...snapshot, state: cancelRequested ? 'cancelled' : pauseRequested ? 'paused' : 'running' }
        }
        if (pauseRequested) return { ...snapshot, state: 'paused' }
        return snapshot
      },
      lastResult(): MirrorRunResult | null {
        return lastResult
      },
    }

    return configureDriveMirror(engine)
  } catch (error) {
    // No ROX_DRIVE_S3_* target (or a bad one): leave the mirror uncomposed so
    // the RPC surface reports UNSUPPORTED_OPERATION rather than a half-built engine.
    console.warn(`[drive] app-config mirror engine not composed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}