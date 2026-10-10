/**
 * ROX Drive (wave 1) — local-first storage contracts shared by the renderer,
 * the server-core RPC handlers, and the Electron main-process engine.
 *
 * The wave-1 engine is device-local: bytes live under
 * `<configDir>/drive/<workspaceId>/<prefix>/...`, the index is a single
 * atomically-rewritten JSON document, and the ledger is always recomputed from
 * completed files (never trusted from a running counter).
 */

/**
 * Default per-workspace quota: 1 tebibyte (1 ТБ).
 *
 * R13 («ROX Drive/Space: 1 ТБ отображение») fixes the displayed figure at
 * 1 ТБ — `docs/plans/2026-10-09-platform-program.md` line 47, «DriveSurface:
 * 1 ТБ». 1024 ** 4 (= 1 099 511 627 776) renders as «1 ТБ»/«1 TB» via the
 * Drive byte formatter, so the meter's title and total agree with the spec.
 */
export const DRIVE_DEFAULT_QUOTA_BYTES = 1024 ** 4

/** One upload part is 16 MiB; the renderer uploads 8 in parallel. */
export const DRIVE_PART_SIZE_BYTES = 16 * 1024 * 1024
export const DRIVE_MAX_PARALLEL_PARTS = 8

/** Upload sessions whose parts exceed this count are rejected by the engine. */
export const DRIVE_MAX_PARTS = 100_000

/** Root folder id — «Мой диск». */
export const DRIVE_ROOT_FOLDER_ID = 'root'
export const DRIVE_ROOT_FOLDER_NAME = 'Мой диск'

export type DriveFileSource = 'upload' | 'device-backup' | 'import'

/** Device-backup source folders offered by the consent chooser (5 defaults). */
export type DriveBackupSourceKind =
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'desktop'
  | 'screenshots'

export interface DriveQuota {
  /** Configured quota in bytes (default 1 TiB). */
  totalBytes: number
  /** Sum of completed file sizes (recomputed from the index). */
  usedBytes: number
  /** Sum of bytes reserved by open upload sessions. */
  reservedBytes: number
  /** `totalBytes - usedBytes - reservedBytes`, floored at 0. */
  freeBytes: number
}

export interface DriveFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface DriveFile {
  id: string
  name: string
  size: number
  folderId: string
  /** Relative on-disk directory under `<configDir>/drive/<workspaceId>/`. */
  prefix: string
  sha256: string
  source: DriveFileSource
  createdAt: string
}

export interface DriveListing {
  folderId: string
  /** Ancestor chain from the root («Мой диск») to the current folder. */
  path: DriveFolder[]
  folders: DriveFolder[]
  files: DriveFile[]
}

export interface DrivePart {
  index: number
  sizeBytes: number
  done: boolean
  sha256?: string
}

export type DriveUploadStatus = 'open' | 'completed' | 'aborted'

export interface DriveUploadSession {
  id: string
  workspaceId: string
  name: string
  size: number
  folderId: string
  partSize: number
  source: DriveFileSource
  /**
   * Absolute source path for `device-backup` sessions. Absent for renderer-fed
   * uploads, where the renderer ships part bytes over `drive:uploadPart`.
   */
  sourcePath?: string
  parts: DrivePart[]
  /** Optional whole-file digest the caller expects; verified on completion. */
  expectedSha256?: string
  status: DriveUploadStatus
  createdAt: string
  updatedAt: string
}

export interface DriveScanFile {
  name: string
  /** Path relative to the scanned root; the engine walks, never the renderer. */
  relativePath: string
  size: number
}

export interface DriveScanResult {
  sourceKind: DriveBackupSourceKind
  rootPath: string
  files: DriveScanFile[]
  totalBytes: number
  skippedSymlinks: number
  /** True when the walk hit the safety cap and omitted remaining files. */
  truncated: boolean
}

export interface DriveUploadProgress {
  uploadId: string
  name: string
  size: number
  doneBytes: number
  doneParts: number
  totalParts: number
  status: DriveUploadStatus | 'error'
  error?: string
}

export interface DriveAggregateProgress {
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
}

/** Human labels for the five default device-backup sources. */
export const DRIVE_BACKUP_SOURCE_KINDS: readonly DriveBackupSourceKind[] = [
  'downloads',
  'documents',
  'pictures',
  'desktop',
  'screenshots',
] as const