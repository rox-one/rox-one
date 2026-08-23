import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  scanSourceFolder,
  materializeImport,
  NotesImportError,
  IMPORT_LIMITS,
} from '../notes-import.ts'

/** RX-TSK-0411 / RX-DOC-0029 FR-4/FR-6: bounded scan + materialized copies. */
describe('notes import core', () => {
  let src: string
  let data: string

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'notes-src-'))
    data = mkdtempSync(join(tmpdir(), 'notes-data-'))
  })
  afterEach(() => {
    rmSync(src, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  })

  it('scans .md recursively with relative paths, skips symlinks and non-md', () => {
    mkdirSync(join(src, 'sub', 'deep'), { recursive: true })
    writeFileSync(join(src, 'a.md'), 'A')
    writeFileSync(join(src, 'sub', 'b.md'), 'B')
    writeFileSync(join(src, 'sub', 'deep', 'c.md'), 'C')
    writeFileSync(join(src, 'skip.txt'), 'nope')
    try {
      symlinkSync(join(src, 'a.md'), join(src, 'link.md'))
      symlinkSync(src, join(src, 'linkdir'))
    } catch { /* symlink perms may be unavailable — skip assertions below */ }

    const res = scanSourceFolder(src)
    expect(res.notes.map((n) => n.relativePath).sort()).toEqual(['a.md', 'sub/b.md', 'sub/deep/c.md'])
    expect(res.notes.every((n) => existsSync(n.absolutePath))).toBe(true)
    if (existsSync(join(src, 'link.md'))) expect(res.skippedSymlinks).toBeGreaterThanOrEqual(1)
  })

  it('rejects missing path and non-directories', () => {
    expect(() => scanSourceFolder(join(src, 'nope'))).toThrow(NotesImportError)
    const f = join(src, 'file.md')
    writeFileSync(f, 'x')
    expect(() => scanSourceFolder(f)).toThrow(NotesImportError)
  })

  it('truncates at MAX_FILES', () => {
    for (let i = 0; i < IMPORT_LIMITS.MAX_FILES + 5; i++) {
      writeFileSync(join(src, `n${i}.md`), 'x')
    }
    const res = scanSourceFolder(src)
    expect(res.notes).toHaveLength(IMPORT_LIMITS.MAX_FILES)
    expect(res.truncated).toBe(true)
  })

  it('materializes copies (no symlinks), writes provenance, renames collisions', () => {
    mkdirSync(join(src, 'sub'), { recursive: true })
    writeFileSync(join(src, 'a.md'), 'AAA')
    writeFileSync(join(src, 'sub', 'a.md'), 'BBB')
    const scan = scanSourceFolder(src)

    const res = materializeImport(data, 'My Vault', scan)
    expect(res.copiedCount).toBe(2)
    expect(existsSync(res.manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    expect(manifest.files).toHaveLength(2)
    expect(manifest.files[0].from).toContain('notes-src-')

    // Обе копии существуют (коллизия имён переименована), содержимое раздельно
    const a1 = readFileSync(join(res.destinationDir, 'a.md'), 'utf8')
    const a2 = readFileSync(join(res.destinationDir, 'sub', 'a.md'), 'utf8')
    expect([a1, a2]).toEqual(['AAA', 'BBB'])

    // Повторный импорт не затирает: создаёт -1 суффиксы
    const again = materializeImport(data, 'My Vault', scan)
    expect(again.copiedCount).toBe(2)
    expect(existsSync(join(again.destinationDir, 'a-1.md'))).toBe(true)
  })

  it('destination stays inside data root even with hostile folder names', () => {
    writeFileSync(join(src, 'x.md'), 'x')
    const scan = scanSourceFolder(src)
    const res = materializeImport(data, '../../escape', scan)
    expect(res.destinationDir.startsWith(resolve(data))).toBe(true)
  })
})

describe('notes import TOCTOU regression (code review)', () => {
  let src: string
  let data: string
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'notes-toc-'))
    data = mkdtempSync(join(tmpdir(), 'notes-dat-'))
  })
  afterEach(() => {
    rmSync(src, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  })

  it('symlink swapped after scan is rejected at copy time', () => {
    writeFileSync(join(src, 'safe.md'), 'safe content')
    const scan = scanSourceFolder(src)
    // Simulate TOCTOU: replace scanned file with symlink to sensitive target
    const secretPath = join(src, 'secret.txt')
    writeFileSync(secretPath, 'TOP_SECRET')
    rmSync(join(src, 'safe.md'))
    symlinkSync(secretPath, join(src, 'safe.md'))

    const res = materializeImport(data, 'toc-test', scan)
    // Symlink was NOT followed — no file with TOP_SECRET content in destination
    const destFile = join(res.destinationDir, 'safe.md')
    if (existsSync(destFile)) {
      expect(readFileSync(destFile, 'utf8')).not.toContain('TOP_SECRET')
    }
    // Or the file was skipped entirely
    expect(res.copiedCount + res.skippedCount).toBe(scan.notes.length)
  })
})
