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

import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync, openSync, closeSync, readFileSync, fstatSync, constants as fsConstants } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

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
export function materializeImport(
  dataRoot: string,
  folderName: string,
  scan: ScanResult,
): MaterializeResult {
  const safeFolder = basename(folderName).replace(/[^\w.-]+/g, '_') || 'import'
  const destinationDir = join(resolve(dataRoot), 'imports', safeFolder)
  mkdirSync(destinationDir, { recursive: true })

  const now = new Date().toISOString()
  let copiedCount = 0
  let skippedCount = 0
  const origins: Array<{ from: string; to: string }> = []

  for (const note of scan.notes) {
    let target = join(destinationDir, note.relativePath)
    if (!target.startsWith(destinationDir)) {
      skippedCount += 1
      continue
    }
    if (existsSync(target)) {
      const extIdx = target.toLowerCase().endsWith('.md') ? target.length - 3 : target.length
      let n = 1
      let candidate = `${target.slice(0, extIdx)}-${n}${target.slice(extIdx)}`
      while (existsSync(candidate)) {
        n += 1
        candidate = `${target.slice(0, extIdx)}-${n}${target.slice(extIdx)}`
      }
      target = candidate
    }
    mkdirSync(dirname(target), { recursive: true })
    // RX-TSK-0411 TOCTOU fix (code review): open with O_NOFOLLOW so a symlink
    // swapped in after scan fails here instead of leaking arbitrary content.
    let fd: number | null = null
    try {
      fd = openSync(note.absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      const st = fstatSync(fd)
      if (!st.isFile() || st.size > IMPORT_LIMITS.MAX_FILE_BYTES) {
        skippedCount += 1
        continue
      }
      const content = readFileSync(fd)
      writeFileSync(target, content)
      origins.push({ from: note.absolutePath, to: target })
      copiedCount += 1
    } catch {
      skippedCount += 1
    } finally {
      if (fd !== null) { try { closeSync(fd) } catch { /* already closed */ } }
    }
  }

  const manifestPath = join(destinationDir, '_provenance.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({ importedAt: now, sourceRoot: scan.root, files: origins }, null, 2),
    'utf8',
  )
  return { destinationDir, manifestPath, copiedCount, skippedCount }
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  const idx2 = p.lastIndexOf('\\')
  return p.slice(0, Math.max(idx, idx2))
}
