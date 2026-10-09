/**
 * `drive:*` RPC — ROX Drive wave 1 (local-first storage).
 *
 * Every channel here is device-local: the bytes and the JSON index live under
 * the host's config dir, so the whole namespace is classified LOCAL_ONLY in the
 * routing table. The Electron main process composes `deps.drive`; headless
 * hosts answer UNSUPPORTED_OPERATION until they do.
 *
 * `drive:uploadPart` carries raw bytes (16 MiB parts) over the transport codec.
 * For `device-backup` sessions the host reads the slice itself and the renderer
 * sends no payload, so a device backup never ships file bytes through the UI.
 */
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import {
  DRIVE_BACKUP_SOURCE_KINDS,
  DRIVE_MAX_PARTS,
  DRIVE_PART_SIZE_BYTES,
  type DriveBackupSourceKind,
  type DriveFileSource,
} from '@rox/shared/drive'
import {
  createImportJobRunner,
  createS3UploadTarget,
  s3TargetOptionsFromEnv,
  type DriveUploadTarget,
  type ImportJobRunner,
  type ImportProvider,
  type ImportProviderId,
} from '@rox/shared/drive/importers'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import type { DriveService, HandlerDeps, OpenUploadInput } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.drive.QUOTA,
  RPC_CHANNELS.drive.LIST,
  RPC_CHANNELS.drive.CREATE_FOLDER,
  RPC_CHANNELS.drive.OPEN_UPLOAD,
  RPC_CHANNELS.drive.UPLOAD_PART,
  RPC_CHANNELS.drive.COMPLETE_UPLOAD,
  RPC_CHANNELS.drive.ABORT_UPLOAD,
  RPC_CHANNELS.drive.DELETE,
  RPC_CHANNELS.drive.SCAN_SOURCE,
  RPC_CHANNELS.drive.IMPORT_PLAN,
  RPC_CHANNELS.drive.IMPORT_START,
  RPC_CHANNELS.drive.IMPORT_PAUSE,
  RPC_CHANNELS.drive.IMPORT_RESUME,
  RPC_CHANNELS.drive.IMPORT_STATUS,
] as const

/** Provider ids accepted by `drive:importPlan`. */
export const IMPORT_PROVIDER_IDS: readonly ImportProviderId[] = [
  'google-drive',
  'onedrive',
  'yandex-disk',
  'icloud',
]

const MAX_ID_LENGTH = 128
const MAX_NAME_LENGTH = 255

function invalid(field: string): never {
  throw new CodedError('INVALID_PAYLOAD', `Invalid ${field}`)
}

function unavailable(): never {
  throw new CodedError('UNSUPPORTED_OPERATION', 'Drive operations are unavailable on this host')
}

function requireDrive(deps: HandlerDeps): DriveService {
  return deps.drive ?? unavailable()
}

function requireWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    return invalid('workspaceId')
  }
  return value
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    return invalid(field)
  }
  return value
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME_LENGTH || /[\\/\u0000-\u001f\u007f]/.test(value)) {
    return invalid('name')
  }
  return value
}

function normalizeSourceKind(value: unknown): DriveBackupSourceKind {
  const kind = DRIVE_BACKUP_SOURCE_KINDS.find(entry => entry === value)
  if (!kind) return invalid('sourceKind')
  return kind
}

function normalizeUploadInput(value: unknown): OpenUploadInput {
  if (!value || typeof value !== 'object') return invalid('input')
  const input = value as Record<string, unknown>
  const size = input.size
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return invalid('input.size')
  if (Math.ceil(size / DRIVE_PART_SIZE_BYTES) > DRIVE_MAX_PARTS) return invalid('input.size')

  const source: DriveFileSource | undefined =
    input.source === 'device-backup' || input.source === 'import' || input.source === 'upload'
      ? input.source
      : undefined
  if (input.source !== undefined && source === undefined) return invalid('input.source')

  const normalized: OpenUploadInput = {
    name: requireName(input.name),
    size,
    folderId: input.folderId === undefined ? undefined : requireId(input.folderId, 'input.folderId'),
    source,
  }
  if (source === 'device-backup') {
    normalized.sourceKind = normalizeSourceKind(input.sourceKind)
    if (typeof input.relativePath !== 'string' || input.relativePath.length === 0 || input.relativePath.length > 4096) {
      return invalid('input.relativePath')
    }
    normalized.relativePath = input.relativePath
  }
  if (input.expectedSha256 !== undefined) {
    if (typeof input.expectedSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(input.expectedSha256)) {
      return invalid('input.expectedSha256')
    }
    normalized.expectedSha256 = input.expectedSha256.toLowerCase()
  }
  return normalized
}

export interface DriveImportConfig {
  /** Directory for `<jobId>.json` state — e.g. `<configDir>/drive/imports`. */
  stateDir: string
  /** Explicit destination; when omitted the `ROX_DRIVE_S3_*` env builds one. */
  target?: DriveUploadTarget
  providers?: readonly ImportProvider[]
  concurrency?: number
  maxAttempts?: number
  retryBaseMs?: number
  sleep?: (ms: number) => Promise<void>
  env?: Record<string, string | undefined>
}

let importRunner: ImportJobRunner | null = null
const registeredProviders = new Map<ImportProviderId, ImportProvider>()

/**
 * Host composition for `drive:import*` (same pattern as
 * `configureTelegramLinkService`). The Electron main process calls this once
 * with the app-data state dir and the provider adapters; a host that never
 * calls it answers UNSUPPORTED_OPERATION.
 */
export function configureDriveImport(config: DriveImportConfig): ImportJobRunner {
  const envOptions = config.target ? null : s3TargetOptionsFromEnv(config.env ?? process.env)
  if (!config.target && !envOptions) {
    throw new CodedError('UNSUPPORTED_OPERATION', 'Drive import target is not configured (set ROX_DRIVE_S3_* or pass target)')
  }
  const target = config.target ?? createS3UploadTarget(envOptions!)
  importRunner = createImportJobRunner({
    target,
    stateDir: config.stateDir,
    providers: config.providers ?? [...registeredProviders.values()],
    concurrency: config.concurrency,
    maxAttempts: config.maxAttempts,
    retryBaseMs: config.retryBaseMs,
    sleep: config.sleep,
  })
  for (const provider of registeredProviders.values()) importRunner.registerProvider(provider)
  return importRunner
}

/** Registers (or replaces) a provider adapter; effective before or after `configureDriveImport`. */
export function registerImportProvider(provider: ImportProvider): void {
  registeredProviders.set(provider.id, provider)
  importRunner?.registerProvider(provider)
}

/** Test seam: drops the composed runner and pending adapters. */
export function resetDriveImport(): void {
  importRunner = null
  registeredProviders.clear()
}

function requireImport(): ImportJobRunner {
  return importRunner ?? unavailable()
}

function normalizeImportProvider(value: unknown): ImportProviderId {
  const id = IMPORT_PROVIDER_IDS.find(entry => entry === value)
  if (!id) return invalid('provider')
  return id
}

export function registerDriveHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.drive.QUOTA, async (_ctx: RequestContext, workspaceId: string) => {
    return requireDrive(deps).getQuota(requireWorkspaceId(workspaceId))
  })

  server.handle(RPC_CHANNELS.drive.LIST, async (_ctx: RequestContext, workspaceId: string, folderId?: string) => {
    return requireDrive(deps).list(
      requireWorkspaceId(workspaceId),
      folderId === undefined || folderId === null ? undefined : requireId(folderId, 'folderId'),
    )
  })

  server.handle(RPC_CHANNELS.drive.CREATE_FOLDER, async (_ctx: RequestContext, workspaceId: string, parentId: string, name: string) => {
    return requireDrive(deps).createFolder(requireWorkspaceId(workspaceId), requireId(parentId, 'parentId'), requireName(name))
  })

  server.handle(RPC_CHANNELS.drive.OPEN_UPLOAD, async (_ctx: RequestContext, workspaceId: string, input: unknown) => {
    return requireDrive(deps).openUpload(requireWorkspaceId(workspaceId), normalizeUploadInput(input))
  })

  server.handle(RPC_CHANNELS.drive.UPLOAD_PART, async (
    _ctx: RequestContext,
    workspaceId: string,
    uploadId: string,
    index: number,
    bytes?: Uint8Array,
  ) => {
    if (!Number.isInteger(index) || index < 0) return invalid('index')
    const payload = bytes === undefined || bytes === null ? undefined : bytes
    if (payload !== undefined && !(payload instanceof Uint8Array)) return invalid('bytes')
    if (payload !== undefined && payload.byteLength > DRIVE_PART_SIZE_BYTES) return invalid('bytes')
    return requireDrive(deps).uploadPart(
      requireWorkspaceId(workspaceId),
      requireId(uploadId, 'uploadId'),
      index,
      payload,
    )
  })

  server.handle(RPC_CHANNELS.drive.COMPLETE_UPLOAD, async (_ctx: RequestContext, workspaceId: string, uploadId: string) => {
    return requireDrive(deps).completeUpload(requireWorkspaceId(workspaceId), requireId(uploadId, 'uploadId'))
  })

  server.handle(RPC_CHANNELS.drive.ABORT_UPLOAD, async (_ctx: RequestContext, workspaceId: string, uploadId: string) => {
    return requireDrive(deps).abortUpload(requireWorkspaceId(workspaceId), requireId(uploadId, 'uploadId'))
  })

  server.handle(RPC_CHANNELS.drive.DELETE, async (_ctx: RequestContext, workspaceId: string, fileId: string) => {
    return requireDrive(deps).deleteFile(requireWorkspaceId(workspaceId), requireId(fileId, 'fileId'))
  })

  server.handle(RPC_CHANNELS.drive.SCAN_SOURCE, async (_ctx: RequestContext, workspaceId: string, sourceKind: unknown) => {
    return requireDrive(deps).scanSource(requireWorkspaceId(workspaceId), normalizeSourceKind(sourceKind))
  })

  // Wave 4 — cloud import pipeline (LOCAL_ONLY: bytes land in the host's S3 target).
  server.handle(RPC_CHANNELS.drive.IMPORT_PLAN, async (_ctx: RequestContext, provider: unknown, folderId?: string | null) => {
    return requireImport().plan(
      normalizeImportProvider(provider),
      folderId === undefined || folderId === null ? undefined : requireId(folderId, 'folderId'),
    )
  })

  server.handle(RPC_CHANNELS.drive.IMPORT_START, async (_ctx: RequestContext, jobId: string) => {
    return requireImport().start(requireId(jobId, 'jobId'))
  })

  server.handle(RPC_CHANNELS.drive.IMPORT_PAUSE, async (_ctx: RequestContext, jobId: string) => {
    return requireImport().pause(requireId(jobId, 'jobId'))
  })

  server.handle(RPC_CHANNELS.drive.IMPORT_RESUME, async (_ctx: RequestContext, jobId: string) => {
    return requireImport().resume(requireId(jobId, 'jobId'))
  })

  server.handle(RPC_CHANNELS.drive.IMPORT_STATUS, async (_ctx: RequestContext, jobId?: string | null) => {
    return requireImport().status(jobId === undefined || jobId === null ? undefined : requireId(jobId, 'jobId'))
  })
}