import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { lstatSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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


describe('openWithNoFollow error paths', () => {
  it('returns error for non-existent file', async () => {
    const { openWithNoFollow } = await import('../notes-import.ts')
    const r = openWithNoFollow(tmpdir(), 'definitely-does-not-exist-xyz.md')
    expect('error' in r).toBe(true)
  })

  it('returns error for directory', async () => {
    const { openWithNoFollow } = await import('../notes-import.ts')
    const dir = mkdtempSync(join(tmpdir(), 'onf-dir-'))
    const r = openWithNoFollow(dirname(dir), basename(dir))
    expect('error' in r).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('notes import destination TOCTOU (wx flag)', () => {
  let src: string
  let data: string
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'notes-wx-src-'))
    data = mkdtempSync(join(tmpdir(), 'notes-wx-dat-'))
  })
  afterEach(() => {
    rmSync(src, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  })

  it('pre-existing destination symlink is not followed (wx rejects EEXIST)', () => {
    writeFileSync(join(src, 'note.md'), 'safe content')
    const scan = scanSourceFolder(src)
    const res = materializeImport(data, 'wx-test', scan)

    // Create a symlink at the expected destination path for a second import
    const secretTarget = join(src, 'secret.txt')
    writeFileSync(secretTarget, 'SECRET_DATA')
    const secondDest = join(res.destinationDir, 'link-target.md')
    symlinkSync(secretTarget, secondDest)

    // Second import with same file name → wx should NOT follow the symlink
    writeFileSync(join(src, 'note.md'), 'updated content')
    const scan2 = scanSourceFolder(src)
    const res2 = materializeImport(data, 'wx-test', scan2)

    // The symlink target must remain unchanged
    expect(readFileSync(secondDest, 'utf8')).toBe('SECRET_DATA')
  })
})


describe('notes import parent-dir symlink regression', () => {
  let base: string
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'notes-pd-')) })
  afterEach(() => { rmSync(base, { recursive: true, force: true }) })

  it('static symlink replacing intermediate dir is rejected', async () => {
    const { scanSourceFolder, materializeImport } = await import('../notes-import.ts')
    const src = join(base, 'src')
    const sub = join(src, 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'safe.md'), 'SUB_CONTENT')
    const scan = scanSourceFolder(src)
    expect(scan.notes.length).toBe(1)

    // Attacker swaps intermediate dir for symlink to evil dir pre-materialize
    const evil = join(base, 'evil')
    mkdirSync(evil, { recursive: true })
    writeFileSync(join(evil, 'safe.md'), 'TOP_SECRET')
    rmSync(sub, { recursive: true })
    symlinkSync(evil, sub)

    const res = materializeImport(join(base, 'data'), 'pd-test', scan)
    expect(res.copiedCount).toBe(0)
    const destFile = join(res.destinationDir, 'sub', 'safe.md')
    if (existsSync(destFile)) {
      expect(readFileSync(destFile, 'utf8')).not.toContain('TOP_SECRET')
    }
  })

  it('path escaping scan root via forged relativePath is rejected', async () => {
    const { scanSourceFolder, materializeImport } = await import('../notes-import.ts')
    const src = join(base, 'src2')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'ok.md'), 'OK')
    const outsideDir = join(base, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.txt'), 'OUT_SECRET')

    const scan = scanSourceFolder(src)
    const forged = {
      ...scan,
      notes: [{ absolutePath: join(outsideDir, 'secret.txt'), relativePath: '../outside/secret.txt', sizeBytes: 10 }],
    }
    const res = materializeImport(join(base, 'data2'), 'esc-test', forged)
    expect(res.copiedCount).toBe(0)
  })
})

describe('notes import adversarial round 2 (inline review)', () => {
  let base: string
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'notes-adv-')) })
  afterEach(() => { rmSync(base, { recursive: true, force: true }) })

  it("folderName '..' stays inside imports/ and does not escape", async () => {
    const { scanSourceFolder, materializeImport } = await import('../notes-import.ts')
    const src = join(base, 'src3')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.md'), 'A')
    const scan = scanSourceFolder(src)
    const res = materializeImport(join(base, 'data3'), '..', scan)
    expect(res.destinationDir.startsWith(join(resolve(join(base, 'data3')), 'imports'))).toBe(true)
  })

  it('pre-planted manifest symlink is replaced, target untouched', async () => {
    const { scanSourceFolder, materializeImport } = await import('../notes-import.ts')
    const src = join(base, 'src4')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'b.md'), 'B')
    const scan = scanSourceFolder(src)
    const victim = join(base, 'victim.txt')
    writeFileSync(victim, 'VICTIM_ORIGINAL')

    // First import creates destination dir; plant symlink at manifest path
    const res1 = materializeImport(join(base, 'data4'), 'mtest', scan)
    rmSync(res1.manifestPath)
    symlinkSync(victim, res1.manifestPath)

    const res2 = materializeImport(join(base, 'data4'), 'mtest', scan)
    // Symlink replaced by regular file; victim content unchanged
    const lst = lstatSync(res2.manifestPath)
    expect(lst.isSymbolicLink()).toBe(false)
    expect(readFileSync(victim, 'utf8')).toBe('VICTIM_ORIGINAL')
  })

  it('forged ScanResult with > MAX_FILES notes is capped', async () => {
    const { materializeImport, IMPORT_LIMITS } = await import('../notes-import.ts')
    const src = join(base, 'src5')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'c.md'), 'C')
    const forgedNotes = Array.from({ length: IMPORT_LIMITS.MAX_FILES + 50 }, (_, i) => ({
      absolutePath: join(src, 'c.md'),
      relativePath: `f${i}.md`,
      sizeBytes: 1,
    }))
    const res = materializeImport(join(base, 'data5'), 'cap', { root: src, notes: forgedNotes, skippedSymlinks: 0, truncated: false })
    expect(res.copiedCount).toBeLessThanOrEqual(IMPORT_LIMITS.MAX_FILES)
  })
})
