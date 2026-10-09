import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import {
  defaultSelectedIds,
  enumerateStandardFolders,
  measure,
  walkTree,
  type BackupSourceId,
  type MeasureResult,
} from '../backup-sources'

const CANONICAL_IDS: BackupSourceId[] = ['downloads', 'documents', 'pictures', 'desktop', 'screenshots']

describe('enumerateStandardFolders', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'rox-backup-home-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  test('macOS lists the five standard folders in canonical order and marks existence', async () => {
    await mkdir(join(home, 'Downloads'))
    await mkdir(join(home, 'Pictures', 'Screenshots'), { recursive: true })

    const sources = enumerateStandardFolders('darwin', home)

    expect(sources.map(source => source.id)).toEqual(CANONICAL_IDS)
    const byId = Object.fromEntries(sources.map(source => [source.id, source]))
    expect(byId.downloads).toMatchObject({ exists: true, path: posix.join(home, 'Downloads') })
    expect(byId.pictures.exists).toBe(true)
    expect(byId.screenshots).toMatchObject({ exists: true, path: posix.join(home, 'Pictures', 'Screenshots') })
    expect(byId.documents.exists).toBe(false)
    expect(byId.desktop.exists).toBe(false)
  })

  test('enumeration is lazy — no counts are computed', async () => {
    await mkdir(join(home, 'Documents'))
    await writeFile(join(home, 'Documents', 'a.txt'), 'hello')
    const sources = enumerateStandardFolders('darwin', home)
    const documents = sources.find(source => source.id === 'documents')
    expect(documents?.fileCount).toBeUndefined()
    expect(documents?.totalBytes).toBeUndefined()
  })

  test('defaultSelectedIds picks only folders that exist', async () => {
    await mkdir(join(home, 'Documents'))
    await mkdir(join(home, 'Pictures'), { recursive: true })
    const sources = enumerateStandardFolders('darwin', home)
    expect(defaultSelectedIds(sources)).toEqual(['documents', 'pictures'])
  })

  test('unknown platforms produce an empty list', () => {
    expect(enumerateStandardFolders('freebsd', home)).toEqual([])
    expect(enumerateStandardFolders('linux', home)).toEqual([])
  })

  test('windows paths derive from injected USERPROFILE with win32 separators', () => {
    const sources = enumerateStandardFolders('win32', 'C:\\fallback', { USERPROFILE: 'C:\\Users\\ada' })
    const byId = Object.fromEntries(sources.map(source => [source.id, source]))
    expect(byId.downloads.path).toBe(win32.join('C:\\Users\\ada', 'Downloads'))
    expect(byId.documents.path).toBe(win32.join('C:\\Users\\ada', 'Documents'))
    expect(byId.pictures.path).toBe(win32.join('C:\\Users\\ada', 'Pictures'))
    expect(byId.desktop.path).toBe(win32.join('C:\\Users\\ada', 'Desktop'))
    expect(byId.screenshots.path).toBe(win32.join('C:\\Users\\ada', 'Pictures', 'Screenshots'))
    // Non-existent Windows paths still enumerate (exists = false) without throwing.
    expect(byId.downloads.exists).toBe(false)
  })

  test('windows falls back to the supplied home when USERPROFILE is absent', () => {
    const sources = enumerateStandardFolders('win32', 'D:\\home', {})
    expect(sources.find(source => source.id === 'downloads')?.path).toBe(win32.join('D:\\home', 'Downloads'))
  })
})

describe('measure', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rox-backup-measure-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('counts nested files and bytes with a concurrency cap', async () => {
    await mkdir(join(root, 'sub', 'deep'), { recursive: true })
    await writeFile(join(root, 'a.txt'), 'aaaaa')
    await writeFile(join(root, 'sub', 'b.txt'), 'bbbbbbb')
    await writeFile(join(root, 'sub', 'deep', 'c.txt'), 'ccccccccccc')

    const result = await measure(root, { concurrency: 2 })

    expect(result).toMatchObject({ files: 3, bytes: 5 + 7 + 11, overflow: false, symlinks: 0 })
    expect(result.errors).toEqual([])
  })

  test('stops at the cap and flags overflow', async () => {
    for (let i = 0; i < 10; i += 1) {
      await writeFile(join(root, `file-${i}.txt`), 'x')
    }

    const result = await measure(root, { limit: 3 })

    expect(result.files).toBe(3)
    expect(result.overflow).toBe(true)
  })

  test('a missing folder yields a partial (empty) result plus an error, never a throw', async () => {
    const result = await measure(join(root, 'does-not-exist'))
    expect(result).toMatchObject({ files: 0, bytes: 0, overflow: false })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('ENOENT')
    expect(result.errors[0].path).toBe(join(root, 'does-not-exist'))
  })

  test('a file passed as the root reports ENOTDIR without throwing', async () => {
    const file = join(root, 'plain.txt')
    await writeFile(file, 'x')
    const result = await measure(file)
    expect(result.files).toBe(0)
    expect(result.errors[0].code).toBe('ENOTDIR')
  })

  test('skips symlinks instead of following them', async () => {
    await writeFile(join(root, 'real.txt'), 'data')
    await symlink(join(root, 'real.txt'), join(root, 'link.txt'))

    const result = await measure(root)

    expect(result.files).toBe(1)
    expect(result.symlinks).toBe(1)
    expect(result.bytes).toBe(4)
  })

  test('unreadable folders return a partial result with an EACCES error', async () => {
    const locked = join(root, 'locked')
    await mkdir(locked)
    await writeFile(join(locked, 'secret.txt'), 'x')
    await chmod(locked, 0o000)

    let result: MeasureResult = { files: 0, bytes: 0, overflow: false, symlinks: 0, errors: [] }
    try {
      result = await measure(locked)
    } finally {
      await chmod(locked, 0o700)
    }

    if (typeof process.getuid === 'function' && process.getuid() === 0) return // root bypasses mode bits
    expect(result.files).toBe(0)
    expect(result.errors.some(error => error.code === 'EACCES')).toBe(true)
  })

  test('measure honours an enumerate entry and short-circuits known-missing folders', async () => {
    await writeFile(join(root, 'present.txt'), 'abcd')
    const present = await measure({ id: 'downloads', path: root, exists: true })
    expect(present).toMatchObject({ files: 1, bytes: 4 })

    const missing = await measure({ id: 'documents', path: join(root, 'nope'), exists: false })
    expect(missing).toEqual({ files: 0, bytes: 0, overflow: false, symlinks: 0, errors: [] })
  })

  test('walkTree returns files sorted by relative path', async () => {
    await mkdir(join(root, 'zdir'))
    await writeFile(join(root, 'b.txt'), 'b')
    await writeFile(join(root, 'a.txt'), 'a')
    await writeFile(join(root, 'zdir', 'c.txt'), 'c')

    const walked = await walkTree(root)

    expect(walked.files.map(file => file.relativePath)).toEqual(['a.txt', 'b.txt', 'zdir/c.txt'])
  })

  test('walkTree maxDepth limits descent', async () => {
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'top.txt'), 'x')
    await writeFile(join(root, 'sub', 'nested.txt'), 'y')

    const walked = await walkTree(root, { maxDepth: 1 })
    expect(walked.files.map(file => file.relativePath)).toEqual(['top.txt'])
  })
})