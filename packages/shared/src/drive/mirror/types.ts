/**
 * ROX Drive (R13 mirror) — contracts for the app-config mirror engine.
 *
 * The engine mirrors a slice of the local app-config directory
 * (`resolveConfigDir()` — settings, workspaces, sessions, Keeper vault, …) into
 * ROX Drive. This module is the frozen contract surface shared by the scanner
 * (`./catalog`), the incremental diff (`./plan`), the durable journal
 * (`./journal`) and the resumable upload queue (`./queue`).
 *
 * This module is pure: only a type-only import of the receiver contract. Bytes
 * and persistence live in the sibling modules.
 */

import type { DriveUploadTarget } from '../importers/types'

/** One independently-configurable slice of the app-config directory. */
export type DriveMirrorSliceId =
  | 'workspaces'
  | 'sessions'
  | 'settings'
  | 'keeper'
  | 'drive'
  | 'meetings'
  | 'clipboard'

/** Per-slice inclusion policy for the catalog scan. */
export interface MirrorSlicePolicy {
  sliceId: DriveMirrorSliceId
  include: boolean
  patterns: readonly string[]
  maxFileBytes: number
}

/** One file the catalog decided to mirror. */
export interface MirrorSourceEntry {
  sliceId: DriveMirrorSliceId
  /** Path relative to the config dir, using `/` separators. */
  relativePath: string
  /** Absolute path on this device; the queue reads bytes from here lazily. */
  absPath: string
  sizeBytes: number
  mtimeMs: number
  /** Hex SHA-256; absent only when the scan could not hash the file. */
  sha256?: string
}

/**
 * One committed file in the journal.
 *
 * `committedAtMs` is the only clock the frozen contract records; the diff's
 * size+mtime fallback therefore degrades to a size comparison for entries
 * without a `sha256` (see `planMirrorDiff`).
 */
export interface MirrorRecordEntry {
  sha256: string
  sizeBytes: number
  committedAtMs: number
}

/** Durable journal payload; `version` is the on-disk schema marker. */
export interface MirrorJournalRecord {
  version: 1
  entries: Record<string, MirrorRecordEntry>
  tombstones: string[]
}

/**
 * Durable record of what has already been mirrored. The unit of resume is the
 * committed file: `commit` is called only after the receiver accepted a file.
 * All mutations are atomic (same-directory temp + rename).
 */
export interface MirrorJournal {
  load(): Promise<MirrorJournalRecord>
  commit(entry: { relativePath: string; sha256: string; sizeBytes: number }): Promise<void>
  addTombstones(paths: readonly string[]): Promise<void>
}

/** Incremental work between the catalog snapshot and the journal. */
export interface MirrorPlan {
  add: readonly MirrorSourceEntry[]
  changed: readonly MirrorSourceEntry[]
  unchanged: readonly MirrorSourceEntry[]
  tombstones: readonly string[]
}

/** One per-file failure captured during a run; never thrown out of a run. */
export interface MirrorRunError {
  relativePath: string
  message: string
}

/** Outcome of one `run()`. */
export interface MirrorRunResult {
  added: number
  changed: number
  removed: number
  bytesUploaded: number
  paused: boolean
  cancelled: boolean
  errors: readonly MirrorRunError[]
}

export type MirrorQueueState = 'idle' | 'running' | 'paused' | 'cancelled' | 'error'

/** Progress snapshot; safe to render (carries no file bytes). */
export interface MirrorQueueStatus {
  state: MirrorQueueState
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  lastCommittedAtMs?: number
}

/** Resumable mirror queue over a `DriveUploadTarget`. */
export interface MirrorQueue {
  /** Configure the next run from a fresh diff; resets per-run counters. */
  enqueue(plan: MirrorPlan): void
  /** Upload `add` + `changed` and record `tombstones`; never rejects on per-file errors. */
  run(): Promise<MirrorRunResult>
  /** Stop scheduling new files once in-flight work settles. */
  pause(): void
  /** Interrupt the run; marks the queue cancelled. */
  cancel(): void
  status(): MirrorQueueStatus
}

export interface MirrorJournalOptions {
  /** Directory holding `<mirrorId>.json` (e.g. `<configDir>/drive/mirror`). */
  stateDir: string
  /** File name stem; must be filename-safe (no separators). */
  mirrorId: string
  now?: () => number
}

export interface MirrorQueueOptions {
  journal: MirrorJournal
  uploadTarget: DriveUploadTarget
  now?: () => number
  /** SHA-256 fallback for entries the catalog could not hash. */
  hash?: (bytes: Uint8Array) => Promise<string>
  /** Backoff seam for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  /** Parallel workers; default 2. */
  maxParallel?: number
}

/** Minimal dirent shape the catalog needs (keeps the scan testable without fs). */
export interface MirrorCatalogDirent {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

/** Injected filesystem seam for the catalog scan. */
export interface MirrorCatalogFs {
  readdir(dir: string): Promise<MirrorCatalogDirent[]>
  stat(path: string): Promise<{ size: number; mtimeMs: number }>
  readFile(path: string): Promise<Uint8Array>
}

export interface MirrorCatalogOptions {
  configDir: string
  /** Override the default slice policies (order defines first-match precedence). */
  policies?: readonly MirrorSlicePolicy[]
  fs?: MirrorCatalogFs
}