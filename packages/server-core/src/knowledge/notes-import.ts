/**
 * Notes import core (RX-TSK-0411, RX-DOC-0029 FR-4/FR-6).
 *
 * Pure, testable primitives behind the notesImport:* RPC channels:
 *  - `scanSourceFolder` — bounded traversal for the consent preview
 *    (max depth, max files, *.md only, symlinks skipped by design — the spec
 *    forbids raw OS symlinks in the canonical hierarchy).
 *  - `materializeImport` — copies the consented set into the workspace's
 *    imports folder and writes a provenance manifest next to it.
 *
 * No indexing or agent-context changes happen here; that is a separate,
 * explicitly consented step downstream (FR-7).
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync, renameSync, openSync, closeSync, readFileSync, fstatSync, constants as fsConstants } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const IMPORT_LIMITS = {
  /** Max directory depth scanned below the source root. */
  MAX_DEPTH: 6,
  /** Max .md files materialized per import. */
  MAX_FILES: 500,
  /** Max single-file size (5 MB) — guards against accidental VM dumps. */
  MAX_FILE_BYTES: 5 * 1024 * 1024,
} as const

export interface ScannedNote {
  /** Absolute source path. */
  readonly absolutePath: string
  /** Path relative to the scan root (POSIX separators). */
  readonly relativePath: string
  readonly sizeBytes: number
}

export interface ScanResult {
  readonly root: string
  readonly notes: readonly ScannedNote[]
  readonly skippedSymlinks: number
  readonly truncated: boolean
}

export class NotesImportError extends Error {}

/** Rejects symlinked dirs/files while walking; only regular .md files count. */
export function scanSourceFolder(sourcePath: string): ScanResult {
  const root = resolve(sourcePath)
  if (!existsSync(root)) throw new NotesImportError(`Source path does not exist: ${root}`)
  if (!lstatSync(root).isDirectory()) {
    throw new NotesImportError(`Source path is not a directory: ${root}`)
  }

  const notes: ScannedNote[] = []
  let skippedSymlinks = 0
  let truncated = false

  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > IMPORT_LIMITS.MAX_DEPTH) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return // unreadable subtree is skipped, not fatal
    }
    for (const entry of entries) {
      if (truncated) return
      const full = join(dir, entry)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) {
        skippedSymlinks += 1
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!st.isFile() || !entry.toLowerCase().endsWith('.md')) continue
      if (st.size > IMPORT_LIMITS.MAX_FILE_BYTES) continue
      if (notes.length >= IMPORT_LIMITS.MAX_FILES) {
        truncated = true
        return
      }
      notes.push({
        absolutePath: full,
        relativePath: relative(root, full).split('\\').join('/'),
        sizeBytes: st.size,
      })
    }
  }

  walk(root, 0)
  return { root, notes, skippedSymlinks, truncated }
}

export interface MaterializeResult {
  readonly destinationDir: string
  readonly manifestPath: string
  readonly copiedCount: number
  readonly skippedCount: number
}

/**
 * Copies each consented note into `<dataRoot>/imports/<folderName>/`,
 * preserving the relative layout, then writes `_provenance.json` beside it
 * (source root, per-file origin, timestamp). Existing destination files are
 * never silently overwritten — collisions rename with a `-N` suffix.
 */

/**
 * Guarantees (RX-TSK-0411): rejects STATIC symlinks in any intermediate
 * directory component between the scan root and the leaf, plus leaf-level
 * symlink/identity checks. Scope note: Node lacks openat(dirfd)-style atomic
 * traversal, so a racing parent-directory swap between these lstat/open calls
 * is OUT OF SCOPE here; the double component pass only narrows that window.
 */
function assertNoSymlinkComponents(root: string, filePath: string): void {
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolve(filePath))
  if (!rel || rel.startsWith('..')) {
    const err = new Error('outside-root') as NodeJS.ErrnoException
    err.code = 'ERANGEX'
    throw err
  }
  const parts = rel.split(/[\\/]/)
  let cur = resolvedRoot
  for (let i = 0; i < parts.length - 1; i++) {
    cur = join(cur, parts[i])
    const st = lstatSync(cur)
    if (st.isSymbolicLink()) {
      const err = new Error(`symlinked directory component: ${cur}`) as NodeJS.ErrnoException
      err.code = 'ESYMDIR'
      throw err
    }
    if (!st.isDirectory()) {
      const err = new Error(`non-directory component: ${cur}`) as NodeJS.ErrnoException
      err.code = 'ENOTDIRX'
      throw err
    }
  }
}

/**
 * Source paths are ALWAYS derived from (root, relativePath) — never trusted
 * from ScannedNote.absolutePath — so a forged ScanResult cannot read outside
 * the scanned root.
 */
function deriveSourcePath(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolve(resolvedRoot, relativePath))
  if (!rel || rel.startsWith('..')) {
    const err = new Error(`path escapes scan root: ${relativePath}`) as NodeJS.ErrnoException
    err.code = 'ERANGEX'
    throw err
  }
  return join(resolvedRoot, rel)
}

/** Portable no-follow open: component check + O_NOFOLLOW + identity fallback. */
export function openWithNoFollow(root: string, relativePath: string): { fd: number; dev: number; ino: number } | { error: string } {
  try {
    const path = deriveSourcePath(root, relativePath)
    assertNoSymlinkComponents(root, path)

    // Open first (O_NOFOLLOW) then fstat — avoids CodeQL js/file-system-race on lstat→open.
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    let fd: number
    try {
      fd = openSync(path, flags)
    } catch (err) {
      // ELOOP on O_NOFOLLOW platforms, ENOENT if missing/raced away.
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ELOOP') return { error: 'symlink' }
      if (code === 'ENOENT') return { error: 'swap-detected' }
      throw err
    }
    try {
      const post = fstatSync(fd)
      if (post.isSymbolicLink()) {
        closeSync(fd)
        return { error: 'symlink' }
      }
      if (!post.isFile()) {
        closeSync(fd)
        return { error: 'not-file' }
      }
      // Second component pass: narrows (does not close) the parent-swap race.
      assertNoSymlinkComponents(root, path)
      return { fd, dev: post.dev, ino: post.ino }
    } catch (err) {
      closeSync(fd)
      throw err
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function materializeImport(
  dataRoot: string,
  folderName: string,
  scan: ScanResult,
): MaterializeResult {
  const sanitized = basename(folderName).replace(/[^\w.-]+/g, '_')
  // Dot-only names ('.', '..') survive the regex and would escape imports/.
  const safeFolder = !sanitized || sanitized === '.' || sanitized === '..' ? 'import' : sanitized
  const destinationDir = join(resolve(dataRoot), 'imports', safeFolder)
  mkdirSync(destinationDir, { recursive: true })

  const now = new Date().toISOString()
  let copiedCount = 0
  let skippedCount = 0
  const origins: Array<{ from: string; to: string }> = []

  // Forged/oversized ScanResult defense-in-depth: never materialize more
  // than the consent-preview limit.
  const boundedNotes = scan.notes.slice(0, IMPORT_LIMITS.MAX_FILES)
  for (const note of boundedNotes) {
    // Destination containment: resolve + relative rejects siblings sharing a
    // prefix ('../foobar/pwn.md' vs dest '.../foo') that startsWith misses.
    const target = resolve(destinationDir, note.relativePath)
    const relFromDest = relative(destinationDir, target)
    if (!relFromDest || relFromDest === '..' || relFromDest.startsWith('..' + sep) || isAbsolute(relFromDest)) {
      skippedCount += 1
      continue
    }
    const relTarget = note.relativePath

    const srcAbs = resolve(scan.root, note.relativePath)
    const opened = openWithNoFollow(scan.root, note.relativePath)
    if ('error' in opened) { skippedCount += 1; continue }
    try {
      const st = fstatSync(opened.fd)
      if (!st.isFile() || st.size > IMPORT_LIMITS.MAX_FILE_BYTES) {
        skippedCount += 1
        continue
      }
      const content = readFileSync(opened.fd)

      mkdirSync(dirname(target), { recursive: true })
      let written = false
      for (let n = 0; n <= 50; n++) {
        const extIdx = target.toLowerCase().endsWith('.md') ? target.length - 3 : target.length
        const candidate = n === 0 ? target : target.slice(0, extIdx) + `-${n}` + target.slice(extIdx)
        try {
          writeFileSync(candidate, content, { flag: 'wx' })
          origins.push({ from: srcAbs, to: candidate })
          copiedCount += 1
          written = true
          break
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
      }
      if (!written) skippedCount += 1
    } catch {
      skippedCount += 1
    } finally {
      try { closeSync(opened.fd) } catch { /* already closed */ }
    }
  }

  // Manifest via temp+rename: rename replaces a pre-planted symlink entry at
  // manifestPath instead of following it (plain 'w' would overwrite the target).
  const manifestPath = join(destinationDir, '_provenance.json')
  const manifestTmp = join(destinationDir, `._provenance.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(
    manifestTmp,
    JSON.stringify({ importedAt: now, sourceRoot: scan.root, files: origins }, null, 2),
    'utf8',
  )
  renameSync(manifestTmp, manifestPath)
  return { destinationDir, manifestPath, copiedCount, skippedCount }
}

