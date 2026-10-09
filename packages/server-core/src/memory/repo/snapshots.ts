/**
 * snapshots.ts — no-git fallback history for the memory repository
 * (spec §6): full file trees under `.snapshots/<ts>/` plus an append-only
 * `index.jsonl` of `{ id, parent, ts, message, files: [{path, op, hash}] }`.
 *
 * Exposes the read API the service needs: list entries, read a file from a
 * snapshot, and diff two snapshots by comparing file sets/hashes (with a
 * multiset line delta for `additions`/`deletions`).
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export interface SnapshotFileRef {
  path: string
  op: 'added' | 'modified' | 'deleted'
  hash: string
}

export interface SnapshotEntry {
  id: string
  parent: string | null
  ts: string
  message: string
  files: SnapshotFileRef[]
}

export interface SnapshotResult {
  /** The new entry when one was appended, else the previous (unchanged) entry. */
  entry: SnapshotEntry
  /** False when the tree matched the previous snapshot and nothing was appended. */
  appended: boolean
}

const SNAPSHOTS_DIR = '.snapshots'
const INDEX_FILE = 'index.jsonl'
const EXCLUDED_DIRS: Record<string, true> = { '.git-rox': true, '.snapshots': true, '.conflicts': true }

function snapshotDir(repoPath: string): string {
  return join(repoPath, SNAPSHOTS_DIR)
}

function indexPath(repoPath: string): string {
  return join(snapshotDir(repoPath), INDEX_FILE)
}

/** `*.tmp` staging files never enter snapshots/history. */
function isExcludedName(name: string): boolean {
  return name.endsWith('.tmp')
}

/**
 * True for internal bookkeeping paths that must never be served as repo files:
 * anything under a top-level EXCLUDED_DIRS entry, or any path with a `*.tmp`
 * segment. Mirrors listRepoFiles' exclusions (which hides them from tree/export).
 */
export function isReservedRepoPath(path: string): boolean {
  const segments = path.split('/')
  for (const segment of segments) if (isExcludedName(segment)) return true
  return EXCLUDED_DIRS[segments[0] ?? ''] === true
}

/** Sorted repo-relative POSIX paths of the snapshot-eligible file tree. */
export function listRepoFiles(repoPath: string, base: string = repoPath): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (isExcludedName(entry.name)) continue
    const abs = join(base, entry.name)
    if (entry.isDirectory()) {
      if (base === repoPath && EXCLUDED_DIRS[entry.name]) continue
      out.push(...listRepoFiles(repoPath, abs))
    } else if (entry.isFile()) {
      out.push(relative(repoPath, abs).split(sep).join('/'))
    }
  }
  return out.sort()
}

export function readSnapshots(repoPath: string): SnapshotEntry[] {
  const file = indexPath(repoPath)
  if (!existsSync(file)) return []
  const entries: SnapshotEntry[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.ts === 'string') {
        entries.push(parsed)
      }
    } catch {
      // skip corrupt index line
    }
  }
  return entries
}

export function lastSnapshot(repoPath: string): SnapshotEntry | null {
  const entries = readSnapshots(repoPath)
  return entries.length > 0 ? entries[entries.length - 1]! : null
}

export function readSnapshotFile(repoPath: string, id: string, path: string): string | null {
  if (!isSafeRelativePath(path)) return null
  const abs = join(snapshotDir(repoPath), id, ...path.split('/'))
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\0')) return false
  const segments = path.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

/**
 * Snapshot the current repo tree. Unchanged files (same hash as the parent's
 * full tree) are omitted from the entry's `files`; deletions are recorded.
 *
 * A tree identical to the previous snapshot is a no-op: no index line is
 * appended (and no files are copied) and the previous entry is returned with
 * `appended: false`. This keeps a retried batch — which re-detects already
 * written paths as `changed` because its recorded hashes are stale — from
 * minting an empty-diff history entry and moving `head` onto it.
 */
export function createSnapshot(
  repoPath: string,
  opts: { message: string; now: Date },
): SnapshotResult {
  const previous = lastSnapshot(repoPath)
  const previousHashes = new Map<string, string>()
  if (previous) for (const ref of snapshotTree(repoPath, previous.id)) previousHashes.set(ref.path, ref.hash)

  const currentFiles = listRepoFiles(repoPath)
  const currentHashes = new Map<string, string>()
  for (const path of currentFiles) currentHashes.set(path, hashFile(join(repoPath, ...path.split('/'))))

  const files: SnapshotFileRef[] = []
  for (const path of currentFiles) {
    const hash = currentHashes.get(path)!
    const prevHash = previousHashes.get(path)
    if (prevHash === hash) continue
    files.push({ path, op: prevHash === undefined ? 'added' : 'modified', hash })
  }
  for (const path of [...previousHashes.keys()].sort()) {
    if (currentHashes.has(path)) continue
    files.push({ path, op: 'deleted', hash: previousHashes.get(path)! })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  // No-op: the current tree equals the previous snapshot's tree byte-for-byte
  // (and a previous entry exists). Do not append an empty-diff entry.
  if (previous && files.length === 0) return { entry: previous, appended: false }

  const id = uniqueSnapshotId(repoPath, opts.now)
  const target = join(snapshotDir(repoPath), id)
  mkdirSync(target, { recursive: true })
  for (const path of currentFiles) {
    const dest = join(target, ...path.split('/'))
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(repoPath, ...path.split('/')), dest)
  }

  const entry: SnapshotEntry = {
    id,
    parent: previous ? previous.id : null,
    ts: opts.now.toISOString(),
    message: opts.message,
    files,
  }
  mkdirSync(snapshotDir(repoPath), { recursive: true })
  writeFileSync(indexPath(repoPath), JSON.stringify(entry) + '\n', { flag: 'a' })
  return { entry, appended: true }
}

/** Full file map of a snapshot directory on disk: path → sha1. */
export function snapshotTree(repoPath: string, id: string): SnapshotFileRef[] {
  const root = join(snapshotDir(repoPath), id)
  if (!existsSync(root)) return []
  const refs: SnapshotFileRef[] = []
  for (const path of listRepoFiles(root)) {
    refs.push({ path, op: 'modified', hash: hashFile(join(root, ...path.split('/'))) })
  }
  return refs
}

/**
 * Diff two snapshots (`fromId = null` = empty tree). Op from set membership;
 * line counts from a multiset line delta of the snapshot file contents.
 */
export function snapshotDiff(
  repoPath: string,
  fromId: string | null,
  toId: string,
  treeCache?: Map<string, SnapshotFileRef[]>,
): Array<{ path: string; op: 'added' | 'modified' | 'deleted'; additions: number; deletions: number }> {
  const treeFor = (id: string): SnapshotFileRef[] => {
    if (!treeCache) return snapshotTree(repoPath, id)
    const cached = treeCache.get(id)
    if (cached) return cached
    const tree = snapshotTree(repoPath, id)
    treeCache.set(id, tree)
    return tree
  }
  const from = fromId === null ? [] : treeFor(fromId)
  const to = treeFor(toId)
  const fromMap = new Map(from.map((ref) => [ref.path, ref.hash]))
  const toMap = new Map(to.map((ref) => [ref.path, ref.hash]))
  const paths = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort()
  const out: Array<{ path: string; op: 'added' | 'modified' | 'deleted'; additions: number; deletions: number }> = []
  for (const path of paths) {
    const before = fromMap.get(path)
    const after = toMap.get(path)
    if (before === after) continue
    const op = before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified'
    const { additions, deletions } = lineDelta(
      before === undefined ? '' : readSnapshotFile(repoPath, fromId!, path) ?? '',
      after === undefined ? '' : readSnapshotFile(repoPath, toId, path) ?? '',
    )
    out.push({ path, op, additions, deletions })
  }
  return out
}

/** Multiset line difference: lines only in `b` are additions, only in `a` deletions. */
function lineDelta(a: string, b: string): { additions: number; deletions: number } {
  const countLines = (text: string): Map<string, number> => {
    const counts = new Map<string, number>()
    if (text.length === 0) return counts
    for (const line of text.replace(/\n$/, '').split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1)
    return counts
  }
  const aCounts = countLines(a)
  const bCounts = countLines(b)
  let additions = 0
  let deletions = 0
  for (const [line, count] of bCounts) additions += Math.max(0, count - (aCounts.get(line) ?? 0))
  for (const [line, count] of aCounts) deletions += Math.max(0, count - (bCounts.get(line) ?? 0))
  return { additions, deletions }
}

function hashFile(path: string): string {
  try {
    return createHash('sha1').update(readFileSync(path)).digest('hex')
  } catch {
    return ''
  }
}

function uniqueSnapshotId(repoPath: string, now: Date): string {
  const base = now.toISOString().replace(/[:.]/g, '-')
  let id = base
  for (let suffix = 1; existsSync(join(snapshotDir(repoPath), id)); suffix++) id = `${base}-${suffix}`
  return id
}