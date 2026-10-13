import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMirrorJournal } from '../journal'

const MIRROR_ID = 'test-mirror'

interface WarnSpy {
  mockRestore(): void
  mock: { calls: unknown[][] }
}

describe('mirror journal', () => {
  let stateDir: string
  let warnSpy: WarnSpy

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'mirror-journal-'))
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    rmSync(stateDir, { recursive: true, force: true })
  })

  test('commit writes an atomic record and load returns it', async () => {
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID, now: () => 1234 })
    await journal.commit({ relativePath: 'config.json', sha256: 'a'.repeat(64), sizeBytes: 10 })

    const file = join(stateDir, `${MIRROR_ID}.json`)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(join(stateDir, `.${MIRROR_ID}.json.tmp`))).toBe(false)

    const record = await journal.load()
    expect(record.version).toBe(1)
    expect(record.entries['config.json']).toEqual({ sha256: 'a'.repeat(64), sizeBytes: 10, committedAtMs: 1234 })
    expect(record.tombstones).toEqual([])
    // The persisted file is valid JSON with the same payload.
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record)
  })

  test('a fresh journal instance sees committed entries (durable)', async () => {
    const first = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    await first.commit({ relativePath: 'a/b.txt', sha256: 'b'.repeat(64), sizeBytes: 3 })

    const second = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    const record = await second.load()
    expect(record.entries['a/b.txt']?.sha256).toBe('b'.repeat(64))
  })

  test('load does not expose internal state to caller mutation', async () => {
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    await journal.commit({ relativePath: 'x', sha256: 'c'.repeat(64), sizeBytes: 1 })
    const record = await journal.load()
    record.entries['x']!.sha256 = 'mutated'
    const again = await journal.load()
    expect(again.entries['x']?.sha256).toBe('c'.repeat(64))
  })

  test('addTombstones removes entries and records deletions', async () => {
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    await journal.commit({ relativePath: 'keep.json', sha256: 'd'.repeat(64), sizeBytes: 2 })
    await journal.commit({ relativePath: 'gone.json', sha256: 'e'.repeat(64), sizeBytes: 4 })
    await journal.addTombstones(['gone.json'])

    const record = await journal.load()
    expect(record.entries['gone.json']).toBeUndefined()
    expect(record.entries['keep.json']).toBeDefined()
    expect(record.tombstones).toEqual(['gone.json'])
  })

  test('re-committing a tombstoned path clears the tombstone', async () => {
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    await journal.addTombstones(['back.json'])
    await journal.commit({ relativePath: 'back.json', sha256: 'f'.repeat(64), sizeBytes: 5 })
    const record = await journal.load()
    expect(record.tombstones).toEqual([])
    expect(record.entries['back.json']?.sizeBytes).toBe(5)
  })

  test('a broken journal resolves to an empty record with one warning', async () => {
    writeFileSync(join(stateDir, `${MIRROR_ID}.json`), '{ not json')
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    const record = await journal.load()
    expect(record).toEqual({ version: 1, entries: {}, tombstones: [] })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  test('an unsupported version resolves to an empty record', async () => {
    writeFileSync(
      join(stateDir, `${MIRROR_ID}.json`),
      JSON.stringify({ version: 99, entries: { a: { sha256: 'a', sizeBytes: 1, committedAtMs: 1 } }, tombstones: [] }),
    )
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    const record = await journal.load()
    expect(record.entries).toEqual({})
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  test('entries with a malformed shape are dropped, not fatal', async () => {
    writeFileSync(
      join(stateDir, `${MIRROR_ID}.json`),
      JSON.stringify({ version: 1, entries: { good: { sha256: 'a', sizeBytes: 1, committedAtMs: 1 }, bad: { sha256: 3 } }, tombstones: ['t'] }),
    )
    const journal = createMirrorJournal({ stateDir, mirrorId: MIRROR_ID })
    const record = await journal.load()
    expect(Object.keys(record.entries)).toEqual(['good'])
    expect(record.tombstones).toEqual(['t'])
  })

  test('an unsafe mirror id is rejected', () => {
    expect(() => createMirrorJournal({ stateDir, mirrorId: '../escape' })).toThrow()
  })
})