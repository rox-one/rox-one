import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectLegacyMarkdownMigration } from '../../packages/server-core/src/docs/legacy-markdown-migration-fence.ts'

const record = (phase: string) => {
  const command = { operationId: 'historical-operation', content: 'retained bytes' }
  return JSON.stringify({ schemaVersion: 1, phase, command, receipt: { historical: true }, applied: 1,
    fingerprint: createHash('sha256').update(JSON.stringify(command)).digest('hex') })
}
async function fixture(run: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'rox-legacy-fence-'))
  const directory = join(root, '.rox-docs', 'commits', 'a'.repeat(64))
  await mkdir(directory, { recursive: true })
  try { await run(root, directory) } finally { await rm(root, { recursive: true, force: true }) }
}

test('completed history stays byte-identical and cannot authorize native activation', async () => fixture(async (root, directory) => {
  const files = ['b'.repeat(64) + '.json', 'native-' + 'c'.repeat(64) + '.json']
  await writeFile(join(directory, files[0]!), record('committed'))
  await writeFile(join(directory, files[1]!), record('aborted'))
  const before = await Promise.all(files.map(file => readFile(join(directory, file))))
  const inventory = await inspectLegacyMarkdownMigration(root)
  expect(inventory.nativeActivationAllowed).toBe(false)
  expect(inventory.recoveryClear).toBe(true)
  expect(inventory.historical.map(item => item.phase).sort()).toEqual(['aborted', 'committed'])
  expect(inventory.historical.every(item => !('receipt' in item))).toBe(true)
  expect(await readdir(directory)).toEqual(files)
  expect(await Promise.all(files.map(file => readFile(join(directory, file))))).toEqual(before)
}))

test('partially applied prepared WAL blocks mixed history without recovery writes', async () => fixture(async (root, directory) => {
  const pending = join(directory, 'native-' + 'b'.repeat(64) + '.json')
  await writeFile(pending, record('prepared'))
  await writeFile(join(directory, 'c'.repeat(64) + '.json'), record('committed'))
  const before = await readFile(pending)
  const inventory = await inspectLegacyMarkdownMigration(root)
  expect(inventory.recoveryClear).toBe(false)
  expect(inventory.nativeActivationAllowed).toBe(false)
  expect(inventory.blockers).toEqual([{ path: pending, reason: 'prepared' }])
  expect(await readFile(pending)).toEqual(before)
  expect(await readdir(directory)).toHaveLength(2)
}))

test('malformed, unreadable and symlink records fail closed and preserve targets', async () => fixture(async (root, directory) => {
  const malformed = join(directory, 'b'.repeat(64) + '.json')
  const unreadable = join(directory, 'c'.repeat(64) + '.json')
  const target = join(root, 'unrelated.txt')
  await writeFile(malformed, '{truncated')
  await writeFile(unreadable, record('committed'))
  await chmod(unreadable, 0)
  await writeFile(target, 'private unrelated bytes')
  await symlink(target, join(directory, 'd'.repeat(64) + '.json'))
  const inventory = await inspectLegacyMarkdownMigration(root)
  expect(inventory.recoveryClear).toBe(false)
  expect(inventory.blockers).toHaveLength(3)
  expect(inventory.nativeActivationAllowed).toBe(false)
  expect(await readFile(malformed, 'utf8')).toBe('{truncated')
  expect(await readFile(target, 'utf8')).toBe('private unrelated bytes')
  await chmod(unreadable, 0o600)
  expect(await readFile(unreadable, 'utf8')).toBe(record('committed'))
}))

test('absent history and linked state directory never grant adoption', async () => fixture(async (root) => {
  await rm(join(root, '.rox-docs'), { recursive: true })
  expect(await inspectLegacyMarkdownMigration(root)).toEqual({ nativeActivationAllowed: false, recoveryClear: true, historical: [], blockers: [] })
  await mkdir(join(root, 'other'))
  await symlink(join(root, 'other'), join(root, '.rox-docs'))
  const inventory = await inspectLegacyMarkdownMigration(root)
  expect(inventory.recoveryClear).toBe(false)
  expect(inventory.blockers[0]?.reason).toBe('unsafe-path')
}))

test('replacement at open seam cannot consume an unrelated symlink target', async () => fixture(async (root, directory) => {
  const path = join(directory, 'b'.repeat(64) + '.json')
  const target = join(root, 'unrelated.json')
  await writeFile(path, record('aborted'))
  await writeFile(target, record('committed'))
  const inventory = await inspectLegacyMarkdownMigration(root, { beforeOpen: async entry => {
    expect(entry).toBe(path)
    await rm(path)
    await symlink(target, path)
  } })
  expect(inventory.nativeActivationAllowed).toBe(false)
  expect(inventory.recoveryClear).toBe(false)
  expect(inventory.historical).toEqual([])
  expect(inventory.blockers).toHaveLength(1)
  expect(await readFile(target, 'utf8')).toBe(record('committed'))
}))

test('replacement regular record is rejected before read', async () => fixture(async (root, directory) => {
  const path = join(directory, 'b'.repeat(64) + '.json')
  await writeFile(path, record('aborted'))
  const replacement = await inspectLegacyMarkdownMigration(root, { beforeOpen: async entry => {
    await rename(entry, join(root, 'original.json')); await writeFile(entry, record('committed'))
  } })
  expect(replacement.historical).toEqual([])
  expect(replacement.recoveryClear).toBe(false)
  expect(replacement.nativeActivationAllowed).toBe(false)
}))

test('replaced parent directory cannot contribute historical metadata', async () => fixture(async (root, directory) => {
  const path = join(directory, 'b'.repeat(64) + '.json')
  await writeFile(path, record('aborted'))
  const inventory = await inspectLegacyMarkdownMigration(root, { beforeOpen: async () => {
    await rename(directory, join(root, 'original-directory'))
    await mkdir(directory)
    await writeFile(path, record('committed'))
  } })
  expect(inventory.historical).toEqual([])
  expect(inventory.recoveryClear).toBe(false)
  expect(inventory.nativeActivationAllowed).toBe(false)
  expect(await readFile(join(root, 'original-directory', 'b'.repeat(64) + '.json'), 'utf8')).toBe(record('aborted'))
}))
