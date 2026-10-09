/**
 * ROX Drive renderer upload scheduler.
 *
 * Splits a file into 16 MiB parts (shared `planParts`) and runs at most
 * `DRIVE_MAX_PARALLEL_PARTS` (8) `drive:uploadPart` calls concurrently. The
 * remaining progress is reported after every batch so the UI meter moves
 * without per-part re-renders.
 *
 * Renderer-fed uploads slice a `File`; device-backup sessions send no bytes —
 * the host reads the slice from the walked source path.
 */
import {
  DRIVE_MAX_PARALLEL_PARTS,
  DRIVE_PART_SIZE_BYTES,
  parallelBatches,
  planParts,
  type DriveBackupSourceKind,
  type DriveFile,
  type DriveFileSource,
  type DriveUploadSession,
} from '@rox/shared/drive'

export interface DriveUploadApi {
  driveOpenUpload: (workspaceId: string, input: {
    name: string
    size: number
    folderId?: string
    source?: DriveFileSource
    sourceKind?: DriveBackupSourceKind
    relativePath?: string
    expectedSha256?: string
  }) => Promise<DriveUploadSession>
  driveUploadPart: (workspaceId: string, uploadId: string, index: number, bytes?: Uint8Array) => Promise<{ index: number; done: boolean }>
  driveCompleteUpload: (workspaceId: string, uploadId: string) => Promise<DriveFile>
  driveAbortUpload: (workspaceId: string, uploadId: string) => Promise<void>
}

export interface RendererUploadRequest {
  workspaceId: string
  /** Renderer-fed file. Omit for device-backup sessions. */
  file?: File
  /** Device-backup descriptor. */
  sourceKind?: DriveBackupSourceKind
  relativePath?: string
  name: string
  size: number
  folderId?: string
  source?: DriveFileSource
  signal?: AbortSignal
  onProgress?: (progress: { doneBytes: number; doneParts: number; totalParts: number }) => void
}

export interface RendererUploadResult {
  file: DriveFile
  resumed: boolean
}

const RETRYABLE_UPLOAD_CODES: Record<string, true> = {
  DRIVE_PART_SIZE_MISMATCH: true,
  DRIVE_PARTS_INCOMPLETE: true,
  DRIVE_CHECKSUM_MISMATCH: true,
  DRIVE_SOURCE_CHANGED: true,
}

/** A caller may retry the whole upload when the failure is transient. */
export function isRetryableUploadError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && RETRYABLE_UPLOAD_CODES[code] === true
}

function partBytesFromFile(file: File, start: number, end: number): Promise<Uint8Array> {
  return file.slice(start, end).arrayBuffer().then(buffer => new Uint8Array(buffer))
}

export async function runRendererUpload(
  api: DriveUploadApi,
  request: RendererUploadRequest,
): Promise<RendererUploadResult> {
  const partSize = DRIVE_PART_SIZE_BYTES
  const plan = planParts(request.size, partSize)
  const session = await api.driveOpenUpload(request.workspaceId, {
    name: request.name,
    size: request.size,
    folderId: request.folderId,
    source: request.source ?? (request.sourceKind ? 'device-backup' : 'upload'),
    sourceKind: request.sourceKind,
    relativePath: request.relativePath,
  })
  const resumed = session.parts.some(part => part.done)

  const isDeviceBackup = session.source === 'device-backup'
  let doneBytes = session.parts.reduce((sum, part) => sum + (part.done ? part.sizeBytes : 0), 0)
  let doneParts = session.parts.filter(part => part.done).length
  request.onProgress?.({ doneBytes, doneParts, totalParts: session.parts.length })

  const pending = plan.filter(part => !session.parts[part.index]?.done)
  // At most `DRIVE_MAX_PARALLEL_PARTS` in flight: each batch is awaited as one unit.
  for (const batch of parallelBatches(pending.length, DRIVE_MAX_PARALLEL_PARTS)) {
    if (request.signal?.aborted) {
      await api.driveAbortUpload(request.workspaceId, session.id).catch(() => undefined)
      throw Object.assign(new Error('Upload aborted'), { code: 'DRIVE_UPLOAD_ABORTED' })
    }
    await Promise.all(batch.map(async offset => {
      const part = pending[offset]
      if (!part) return
      const bytes = isDeviceBackup || !request.file
        ? undefined
        : await partBytesFromFile(request.file, part.start, part.end)
      await api.driveUploadPart(request.workspaceId, session.id, part.index, bytes)
      doneBytes += part.sizeBytes
      doneParts += 1
    }))
    request.onProgress?.({ doneBytes, doneParts, totalParts: session.parts.length })
  }

  const file = await api.driveCompleteUpload(request.workspaceId, session.id)
  request.onProgress?.({ doneBytes: request.size, doneParts: session.parts.length, totalParts: session.parts.length })
  return { file, resumed }
}