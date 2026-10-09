/**
 * ROX Drive (device backup) — standard-folder enumeration + measurement.
 *
 * The consent chooser («Настроить бэкап моего устройства») offers the platform's
 * standard user folders. Enumeration is cheap and synchronous (existence only);
 * file count / byte totals stay lazy behind `measure()`, which walks with a
 * bounded concurrency cap so a huge tree never starves the main process.
 *
 * Every filesystem error is reported, never thrown: a folder the user cannot
 * read yields a partial result plus an `errors[]` entry carrying the errno code.
 */
import { statSync, type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { DRIVE_BACKUP_SOURCE_KINDS, type DriveBackupSourceKind } from '@rox/shared/drive'

/** The five standard device-backup source ids. */
export type BackupSourceId = DriveBackupSourceKind

export interface BackupSource {
  id: BackupSourceId
  /** Absolute folder path in the platform's native form. */
  path: string
  /** Whether the folder currently exists as a directory. */
  exists: boolean
  /** Lazily filled by `measure()`; absent until measured. */
  fileCount?: number
  /** Lazily filled by `measure()`; absent until measured. */
  totalBytes?: number
}

export interface BackupSourceError {
  /** Absolute path that produced the error. */
  path: string
  /** Node errno code (`EACCES`, `ENOENT`, …) or `UNKNOWN`. */
  code: string
  message: string
}

/** Default parallel directory reads during a walk. */
export const DEFAULT_WALK_CONCURRENCY = 8

/** Relative folder names per source, in canonical (`DRIVE_BACKUP_SOURCE_KINDS`) order. */
const SOURCE_RELATIVE_PATHS: Record<BackupSourceId, string[]> = {
  downloads: ['Downloads'],
  documents: ['Documents'],
  pictures: ['Pictures'],
  desktop: ['Desktop'],
  screenshots: ['Pictures', 'Screenshots'],
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function errnoCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN'
}

/**
 * Enumerate the platform's standard folders, in `DRIVE_BACKUP_SOURCE_KINDS` order.
 *
 * - `darwin`: `~/Downloads`, `~/Documents`, `~/Pictures`, `~/Desktop`,
 *   `~/Pictures/Screenshots`.
 * - `win32`: the same user folders derived from `%USERPROFILE%` (falling back to
 *   the supplied `home`), joined with Windows separators.
 * - anything else: an empty list (the chooser shows nothing).
 *
 * Enumeration never reads folder contents — `fileCount`/`totalBytes` are filled
 * by `measure()`.
 */
export function enumerateStandardFolders(
  platform: string = process.platform,
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): BackupSource[] {
  if (platform === 'darwin') {
    return DRIVE_BACKUP_SOURCE_KINDS.map(id => {
      const path = posix.join(home, ...SOURCE_RELATIVE_PATHS[id])
      return { id, path, exists: isDirectory(path) }
    })
  }
  if (platform === 'win32') {
    const base = typeof env.USERPROFILE === 'string' && env.USERPROFILE.length > 0 ? env.USERPROFILE : home
    return DRIVE_BACKUP_SOURCE_KINDS.map(id => {
      const path = win32.join(base, ...SOURCE_RELATIVE_PATHS[id])
      return { id, path, exists: isDirectory(path) }
    })
  }
  return []
}

/** Ids of the enumerated folders that exist — the default chooser selection. */
export function defaultSelectedIds(sources: readonly BackupSource[]): BackupSourceId[] {
  return sources.filter(source => source.exists).map(source => source.id)
}

// ---- measurement -------------------------------------------------------------

export interface WalkedFile {
  /** Absolute path (platform-native join). */
  path: string
  /** Path relative to the walked root, always `/`-separated. */
  relativePath: string
  size: number
}

export interface WalkResult {
  /** Regular files only, sorted by `relativePath` for deterministic output. */
  files: WalkedFile[]
  errors: BackupSourceError[]
  /** Symlinked entries encountered; never followed. */
  symlinks: number
  /** True when the walk hit `limit` and omitted the remaining files. */
  overflow: boolean
}

export interface WalkOptions {
  /** Stop after this many files; absent = unbounded. */
  limit?: number
  /** Parallel directory reads. Defaults to `DEFAULT_WALK_CONCURRENCY`. */
  concurrency?: number
  /** Maximum relative path depth (segments) to descend. `1` = direct children only. */
  maxDepth?: number
}

function compareByRelativePath(a: WalkedFile, b: WalkedFile): number {
  if (a.relativePath < b.relativePath) return -1
  if (a.relativePath > b.relativePath) return 1
  return 0
}

/**
 * Bounded recursive walk. Symlinks are counted but never followed, unreadable
 * directories are reported (not thrown) and reading stops at `limit`.
 */
export async function walkTree(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_WALK_CONCURRENCY))
  const limit = options.limit
  const maxDepth = options.maxDepth
  const files: WalkedFile[] = []
  const errors: BackupSourceError[] = []
  let symlinks = 0
  let overflow = false

  const pending: string[] = ['']
  const running = new Set<Promise<void>>()

  const recordError = (path: string, error: unknown): void => {
    errors.push({ path, code: errnoCode(error), message: error instanceof Error ? error.message : String(error) })
  }

  const readDir = async (relDir: string): Promise<void> => {
    if (overflow) return
    const absDir = relDir ? join(root, relDir) : root
    let entries: Dirent[]
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch (error) {
      recordError(absDir, error)
      return
    }
    for (const entry of entries) {
      if (overflow) return
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        symlinks += 1
        continue
      }
      if (entry.isDirectory()) {
        const nextDepth = relPath.split('/').length + 1
        if (maxDepth === undefined || nextDepth <= maxDepth) pending.push(relPath)
        continue
      }
      if (!entry.isFile()) continue
      if (limit !== undefined && files.length >= limit) {
        overflow = true
        return
      }
      const absPath = join(root, relPath)
      let size: number
      try {
        size = (await stat(absPath)).size
      } catch (error) {
        recordError(absPath, error)
        continue
      }
      files.push({ path: absPath, relativePath: relPath, size })
    }
  }

  const spawn = (): void => {
    while (!overflow && pending.length > 0 && running.size < concurrency) {
      const relDir = pending.shift() as string
      const task: Promise<void> = readDir(relDir).finally(() => {
        running.delete(task)
        spawn()
      })
      running.add(task)
    }
  }

  spawn()
  while (running.size > 0) await Promise.race(running)

  files.sort(compareByRelativePath)
  return { files, errors, symlinks, overflow }
}

export interface MeasureOptions {
  /** Stop after this many files; absent = unbounded. */
  limit?: number
  concurrency?: number
}

export interface MeasureResult {
  files: number
  bytes: number
  overflow: boolean
  symlinks: number
  errors: BackupSourceError[]
}

/**
 * Lazy size/count measurement for one folder (or an `enumerateStandardFolders`
 * entry). Never throws: unreadable paths yield a partial result plus `errors[]`.
 */
export async function measure(
  folder: string | BackupSource,
  options: MeasureOptions = {},
): Promise<MeasureResult> {
  const path = typeof folder === 'string' ? folder : folder.path
  if (typeof folder !== 'string' && folder.exists === false) {
    return { files: 0, bytes: 0, overflow: false, symlinks: 0, errors: [] }
  }
  const walked = await walkTree(path, { limit: options.limit, concurrency: options.concurrency })
  let bytes = 0
  for (const file of walked.files) bytes += file.size
  return {
    files: walked.files.length,
    bytes,
    overflow: walked.overflow,
    symlinks: walked.symlinks,
    errors: walked.errors,
  }
}