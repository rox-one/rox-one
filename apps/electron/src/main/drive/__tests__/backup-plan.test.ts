import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackupSource, BackupSourceId } from '../backup-sources'
import {
  BACKUP_OVERSIZED_FILE_BYTES,
  buildPlan,
  createBackupSelection,
  DEFAULT_EXCLUDE_GLOBS,
  globToRegExp,
  type BackupPlanSelection,
} from '../backup-plan'

function source(id: BackupSourceId, path: string, exists = true): BackupSource {
  return { id, path, exists }
}

function select(ids: BackupSourceId[], overrides: Partial<BackupPlanSelection> = {}): BackupPlanSelection {
  return { ...createBackupSelection(ids), ...overrides }
}

describe('globToRegExp', () => {
  test('**/ matches zero or more leading directories', () => {
    const pattern = globToRegExp('**/node_modules/**')
    expect(pattern.test('node_modules/pkg/index.js')).toBe(true)
    expect(pattern.test('a/b/node_modules/index.js')).toBe(true)
    expect(pattern.test('src/node-modules/x.js')).toBe(false)
  })

  test('* stays within a segment, ? matches one character', () => {
    expect(globToRegExp('*.log').test('debug.log')).toBe(true)
    expect(globToRegExp('*.log').test('nested/debug.log')).toBe(false)
    expect(globToRegExp('file-?.txt').test('file-1.txt')).toBe(true)
    expect(globToRegExp('file-?.txt').test('file-12.txt')).toBe(false)
  })

  test('default globs cover VCS and cache directories', () => {
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/node_modules/**')
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/.git/**')
  })
})

describe('buildPlan', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'rox-backup-plan-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  test('orders items by source, then relative path, and sums bytes', async () => {
    const downloads = join(home, 'Downloads')
    const documents = join(home, 'Documents')
    await mkdir(downloads)
    await mkdir(documents)
    await writeFile(join(downloads, 'b.txt'), 'bb')
    await writeFile(join(downloads, 'a.txt'), 'a')
    await writeFile(join(documents, 'c.txt'), 'ccc')

    const plan = await buildPlan(
      [source('downloads', downloads), source('documents', documents)],
      select(['documents', 'downloads']),
    )

    expect(plan.items.map(item => item.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(plan.items.map(item => item.sourceId)).toEqual(['downloads', 'downloads', 'documents'])
    expect(plan.items.map(item => item.path)).toEqual([
      join(downloads, 'a.txt'),
      join(downloads, 'b.txt'),
      join(documents, 'c.txt'),
    ])
    expect(plan.summary).toMatchObject({ files: 3, bytes: 6 })
  })

  test('includeSubfolders=false plans only the folder\'s direct files', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(join(downloads, 'sub'), { recursive: true })
    await writeFile(join(downloads, 'top.txt'), 'x')
    await writeFile(join(downloads, 'sub', 'nested.txt'), 'yy')

    const plan = await buildPlan([source('downloads', downloads)], select(['downloads'], { includeSubfolders: false }))

    expect(plan.items.map(item => item.relativePath)).toEqual(['top.txt'])
    expect(plan.summary).toMatchObject({ files: 1, bytes: 1 })
  })

  test('skips hidden, excluded, symlinked and oversized entries', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(join(downloads, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(downloads, 'normal.txt'), 'ok')
    await writeFile(join(downloads, '.hidden'), 'secret')
    await writeFile(join(downloads, 'node_modules', 'pkg', 'index.js'), 'module')
    await writeFile(join(downloads, 'big.bin'), 'longerthanfour')
    await symlink(join(downloads, 'normal.txt'), join(downloads, 'link.txt'))

    const plan = await buildPlan([source('downloads', downloads)], select(['downloads']), { maxFileBytes: 4 })

    expect(plan.items.map(item => item.relativePath)).toEqual(['normal.txt'])
    expect(plan.summary.skipped).toEqual({ hidden: 1, symlink: 1, excluded: 1, oversized: 1, duplicate: 0 })
    expect(plan.oversized).toHaveLength(1)
    expect(plan.oversized[0]).toMatchObject({ path: join(downloads, 'big.bin'), size: 14, sourceId: 'downloads' })
  })

  test('dedupes overlapping sources by realpath', async () => {
    const pictures = join(home, 'Pictures')
    const screenshots = join(pictures, 'Screenshots')
    await mkdir(screenshots, { recursive: true })
    await writeFile(join(pictures, 'own.txt'), 'own')
    await writeFile(join(screenshots, 'shared.txt'), 'shared')

    const plan = await buildPlan(
      [source('pictures', pictures), source('screenshots', screenshots)],
      select(['pictures', 'screenshots']),
    )

    expect(plan.items.map(item => item.relativePath)).toEqual(['Screenshots/shared.txt', 'own.txt'])
    expect(plan.summary.files).toBe(2)
    expect(plan.summary.skipped.duplicate).toBe(1)
    expect(plan.summary.bytes).toBe('shared'.length + 'own'.length)
  })

  test('merges user excludeGlobs with the defaults', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(downloads)
    await writeFile(join(downloads, 'keep.txt'), 'k')
    await writeFile(join(downloads, 'noise.log'), 'log')
    await mkdir(join(downloads, '.git'))
    await writeFile(join(downloads, '.git', 'HEAD'), 'ref')

    const plan = await buildPlan(
      [source('downloads', downloads)],
      select(['downloads'], { excludeGlobs: ['**/*.log'] }),
    )

    expect(plan.items.map(item => item.relativePath)).toEqual(['keep.txt'])
    // `.git/HEAD` is hidden; `noise.log` is excluded by the user glob.
    expect(plan.summary.skipped).toMatchObject({ hidden: 1, excluded: 1 })
  })

  test('ignores unselected and non-existent sources', async () => {
    const downloads = join(home, 'Downloads')
    const documents = join(home, 'Documents')
    await mkdir(downloads)
    await mkdir(documents)
    await writeFile(join(downloads, 'a.txt'), 'a')
    await writeFile(join(documents, 'b.txt'), 'b')

    const plan = await buildPlan(
      [source('downloads', downloads), source('documents', documents), source('pictures', join(home, 'Pictures'), false)],
      select(['pictures']),
    )

    expect(plan.items).toEqual([])
    expect(plan.summary.files).toBe(0)
    expect(plan.errors).toEqual([])
  })

  test('reports unreadable folders in errors[] without failing the plan', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(downloads)
    await writeFile(join(downloads, 'ok.txt'), 'ok')

    const plan = await buildPlan(
      [source('downloads', downloads), source('documents', join(home, 'missing'))],
      select(['downloads', 'documents']),
    )

    expect(plan.items.map(item => item.relativePath)).toEqual(['ok.txt'])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0].code).toBe('ENOENT')
  })

  test('is deterministic across repeated runs', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(join(downloads, 'sub'), { recursive: true })
    await writeFile(join(downloads, 'a.txt'), 'a')
    await writeFile(join(downloads, 'sub', 'b.txt'), 'b')
    await writeFile(join(downloads, '.secret'), 's')

    const sources = [source('downloads', downloads)]
    const first = await buildPlan(sources, select(['downloads']))
    const second = await buildPlan(sources, select(['downloads']))

    expect(second).toEqual(first)
  })

  test('the oversized threshold defaults to 5 GiB', () => {
    expect(BACKUP_OVERSIZED_FILE_BYTES).toBe(5 * 1024 ** 3)
  })

  test('createBackupSelection starts from the documented defaults', () => {
    expect(createBackupSelection(['downloads'])).toEqual({
      selectedIds: ['downloads'],
      includeSubfolders: true,
      excludeGlobs: [],
    })
  })
})