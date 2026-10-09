/**
 * ROX Drive (device backup) — selection → ordered upload plan.
 *
 * The chooser hands back a `BackupPlanSelection`; `buildPlan` turns it into a
 * deterministic list of upload work items (`{path, size}`), reusing the bounded
 * walk from `backup-sources`. Nothing here touches the network or the upload
 * queue — the queue (`upload-queue.ts`) consumes the returned items verbatim.
 *
 * Skips: hidden files, symlinks, default cache/VCS globs (plus user globs),
 * duplicates (by realpath) and files above the oversized threshold. Oversized
 * files are surfaced separately so the UI can prompt instead of silently
 * dropping them.
 */
import { realpath } from 'node:fs/promises'
import { walkTree, type BackupSource, type BackupSourceError, type BackupSourceId } from './backup-sources'

/** Files strictly larger than this are flagged `oversized` and left out of the plan. */
export const BACKUP_OVERSIZED_FILE_BYTES = 5 * 1024 ** 3

/** Subfolders are included by default; only the folder's own files are planned otherwise. */
export const DEFAULT_INCLUDE_SUBFOLDERS = true

/** Cache / VCS directories excluded unless the caller opts out via a narrower selection. */
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/.cache/**',
  '**/Cache/**',
  '**/Caches/**',
]

export interface BackupPlanSelection {
  selectedIds: BackupSourceId[]
  includeSubfolders: boolean
  excludeGlobs: string[]
}

export interface BackupPlanItem {
  /** Absolute source path (upload-queue `device-backup` input). */
  path: string
  size: number
  sourceId: BackupSourceId
  /** Path relative to the source root, `/`-separated. */
  relativePath: string
}

export interface BackupPlanSkipped {
  hidden: number
  symlink: number
  excluded: number
  oversized: number
  duplicate: number
}

export interface BackupPlanSummary {
  files: number
  bytes: number
  skipped: BackupPlanSkipped
}

export interface OversizedFile {
  path: string
  size: number
  sourceId: BackupSourceId
}

export interface BackupPlan {
  /** Upload work items, ordered by source then `relativePath`. */
  items: BackupPlanItem[]
  summary: BackupPlanSummary
  /** Skipped-but-actionable oversized files, in the same order as `items` would be. */
  oversized: OversizedFile[]
  /** Walk errors (unreadable folders/files); the plan stays usable. */
  errors: BackupSourceError[]
}

export interface BuildPlanOptions {
  /** Oversized threshold override (tests / policy). Defaults to 5 GiB. */
  maxFileBytes?: number
  /** Parallel directory reads during each source walk. */
  concurrency?: number
}

/** Fresh selection with the documented defaults. */
export function createBackupSelection(selectedIds: BackupSourceId[]): BackupPlanSelection {
  return { selectedIds: [...selectedIds], includeSubfolders: DEFAULT_INCLUDE_SUBFOLDERS, excludeGlobs: [] }
}

/** Characters that must be escaped when compiling a literal glob character. */
const GLOB_SPECIAL_CHARACTERS: Record<string, true> = {
  '.': true,
  '+': true,
  '^': true,
  '$': true,
  '{': true,
  '}': true,
  '(': true,
  ')': true,
  '|': true,
  '[': true,
  ']': true,
  '\\': true,
}

/**
 * Compile a glob (`**`, `*`, `?`) to an anchored regex matched against the
 * `/`-separated relative path. A double star followed by a slash matches zero
 * or more leading directories.
 */
export function globToRegExp(glob: string): RegExp {
  const source = glob.replace(/\\/g, '/')
  let pattern = '^'
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === '*') {
      if (source[i + 1] === '*') {
        i += 1
        if (source[i + 1] === '/') {
          i += 1
          pattern += '(?:.*/)?'
        } else {
          pattern += '.*'
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (char === '?') {
      pattern += '[^/]'
    } else {
      pattern += GLOB_SPECIAL_CHARACTERS[char!] ? '\\' + char : char
    }
  }
  return new RegExp(pattern + '$')
}

/**
 * Build the deterministic upload plan for `selection` over `sources`.
 *
 * Items are ordered by the order of `sources` (filtered to selected, existing
 * folders) and then by `relativePath`, so identical inputs always yield an
 * identical plan.
 */
export async function buildPlan(
  sources: readonly BackupSource[],
  selection: BackupPlanSelection,
  options: BuildPlanOptions = {},
): Promise<BackupPlan> {
  const maxFileBytes = options.maxFileBytes ?? BACKUP_OVERSIZED_FILE_BYTES
  const matchers = [...DEFAULT_EXCLUDE_GLOBS, ...selection.excludeGlobs].map(globToRegExp)
  const selected = new Set(selection.selectedIds)

  const items: BackupPlanItem[] = []
  const oversized: OversizedFile[] = []
  const errors: BackupSourceError[] = []
  const skipped: BackupPlanSkipped = { hidden: 0, symlink: 0, excluded: 0, oversized: 0, duplicate: 0 }
  const seenRealPaths = new Set<string>()
  let bytes = 0

  for (const source of sources) {
    if (source.exists === false || !selected.has(source.id)) continue
    const walked = await walkTree(source.path, {
      concurrency: options.concurrency,
      maxDepth: selection.includeSubfolders ? undefined : 1,
    })
    errors.push(...walked.errors)
    skipped.symlink += walked.symlinks

    for (const file of walked.files) {
      const segments = file.relativePath.split('/')
      if (segments.some(segment => segment.startsWith('.'))) {
        skipped.hidden += 1
        continue
      }
      if (matchers.some(matcher => matcher.test(file.relativePath))) {
        skipped.excluded += 1
        continue
      }
      if (file.size > maxFileBytes) {
        skipped.oversized += 1
        oversized.push({ path: file.path, size: file.size, sourceId: source.id })
        continue
      }
      let canonicalPath = file.path
      try {
        canonicalPath = await realpath(file.path)
      } catch {
        // Unresolvable realpath: fall back to the as-walked path for dedupe.
      }
      if (seenRealPaths.has(canonicalPath)) {
        skipped.duplicate += 1
        continue
      }
      seenRealPaths.add(canonicalPath)
      items.push({ path: file.path, size: file.size, sourceId: source.id, relativePath: file.relativePath })
      bytes += file.size
    }
  }

  return { items, summary: { files: items.length, bytes, skipped }, oversized, errors }
}