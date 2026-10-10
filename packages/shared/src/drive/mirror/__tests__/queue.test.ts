import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DriveUploadTarget } from '../../importers/types'
import { createMirrorJournal } from '../journal'
import { planMirrorDiff } from '../plan'
import { createMirrorQueue } from '../queue'
import type { DriveMirrorSliceId, MirrorSourceEntry } from '../types'

interface PutRecord {
  key: string
  bytes: number[]
  sizeBytes?: number
}

interface FakeTarget extends DriveUploadTarget {
  puts: PutRecord[]
}

function createFakeTarget(failKeys: readonly string[] = []): FakeTarget {
  const puts: PutRecord[] = []
  return {
    puts,
    async put(key, body, opts) {
      if (failKeys.includes(key)) throw new Error(`put failed: ${key}`)
      puts.push({
        key,
        bytes: body instanceof Uint8Array ? [...body] : [],
        sizeBytes: opts?.sizeBytes,
      })
    },
  }
}

/** A target whose first `put` blocks until `release()`; used to pause/cancel mid-run. */
function createGatedTarget(): { target: FakeTarget; firstPutStarted: Promise<void>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let markStarted!: () => void
  const firstPutStarted = new Promise<void>(resolve => {
    markStarted = resolve
  })
  const puts: PutRecord[] = []
  const target: FakeTarget = {
    puts,
    async put(key, body, opts) {
      if (puts.length === 0) {
        markStarted()
        await gate
      }
      puts.push({ key, bytes: body instanceof Uint8Array ? [...body] : [], sizeBytes: opts?.sizeBytes })
    },
  }
  return { target, firstPutStarted, release: () => release() }
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(root, relativePath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

function entryFor(root: string, relativePath: string, sliceId: DriveMirrorSliceId = 'settings'): MirrorSourceEntry {
  const absPath = join(root, relativePath)
  const bytes = readFileSync(absPath)
  return {
    sliceId,
    relativePath,
    absPath,
    sizeBytes: statSync(absPath).size,
    mtimeMs: statSync(absPath).mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

describe('createMirrorQueue', () => {
  let root: string
  let stateDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mirror-queue-'))
    stateDir = join(root, 'mirror-state')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('uploads add + changed files, commits them and namespaces the keys', async () => {
    writeFiles(root, { 'a.json': 'aaa', 'b.json': 'bbb' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm', now: () => 7 })
    const target = createFakeTarget()
    const queue = createMirrorQueue({ journal, uploadTarget: target, now: () => 7 })

    const plan = planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await journal.load())
    expect(plan.add).toHaveLength(2)
    queue.enqueue(plan)
    expect(queue.status()).toMatchObject({ state: 'idle', filesDone: 0, filesTotal: 2, bytesTotal: 6 })

    const result = await queue.run()
    expect(result.added).toBe(2)
    expect(result.changed).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.bytesUploaded).toBe(6)
    expect(target.puts.map(put => put.key)).toEqual(['app-mirror/a.json', 'app-mirror/b.json'])
    expect(target.puts[0]?.bytes).toEqual([...Buffer.from('aaa')])
    expect(target.puts[0]?.sizeBytes).toBe(3)

    const record = await journal.load()
    expect(record.entries['a.json']?.sha256).toBe(entryFor(root, 'a.json').sha256)
    expect(record.entries['a.json']?.committedAtMs).toBe(7)
    expect(queue.status()).toMatchObject({ state: 'idle', filesDone: 2, bytesDone: 6, lastCommittedAtMs: 7 })
  })

  test('a fresh engine over the same state dir sends nothing (resume after a crash)', async () => {
    writeFiles(root, { 'a.json': 'aaa', 'b.json': 'bbb' })
    const firstJournal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const firstQueue = createMirrorQueue({ journal: firstJournal, uploadTarget: createFakeTarget() })
    firstQueue.enqueue(planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await firstJournal.load()))
    expect((await firstQueue.run()).added).toBe(2)

    // Simulate a process restart: new journal + queue, same state dir and catalog.
    const secondJournal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const secondTarget = createFakeTarget()
    const secondQueue = createMirrorQueue({ journal: secondJournal, uploadTarget: secondTarget })
    const plan = planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await secondJournal.load())
    expect(plan.add).toHaveLength(0)
    expect(plan.changed).toHaveLength(0)
    expect(plan.unchanged).toHaveLength(2)

    secondQueue.enqueue(plan)
    const result = await secondQueue.run()
    expect(result.added).toBe(0)
    expect(result.changed).toBe(0)
    expect(secondTarget.puts).toEqual([])
  })

  test('re-uploads only the file that changed', async () => {
    writeFiles(root, { 'a.json': 'aaa', 'b.json': 'bbb' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const queue = createMirrorQueue({ journal, uploadTarget: createFakeTarget() })
    queue.enqueue(planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await journal.load()))
    await queue.run()

    writeFileSync(join(root, 'b.json'), 'bbb-changed')
    const target = createFakeTarget()
    const next = createMirrorQueue({ journal, uploadTarget: target })
    const plan = planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await journal.load())
    expect(plan.changed.map(entry => entry.relativePath)).toEqual(['b.json'])
    next.enqueue(plan)
    const result = await next.run()
    expect(result.changed).toBe(1)
    expect(target.puts.map(put => put.key)).toEqual(['app-mirror/b.json'])
  })

  test('a deleted file becomes a journal tombstone and is not re-uploaded', async () => {
    writeFiles(root, { 'a.json': 'aaa', 'b.json': 'bbb' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const queue = createMirrorQueue({ journal, uploadTarget: createFakeTarget() })
    queue.enqueue(planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await journal.load()))
    await queue.run()

    unlinkSync(join(root, 'b.json'))
    const target = createFakeTarget()
    const next = createMirrorQueue({ journal, uploadTarget: target })
    const plan = planMirrorDiff([entryFor(root, 'a.json')], await journal.load())
    expect(plan.tombstones).toEqual(['b.json'])
    next.enqueue(plan)
    const result = await next.run()

    expect(result.removed).toBe(1)
    expect(target.puts).toEqual([])
    const record = await journal.load()
    expect(record.entries['b.json']).toBeUndefined()
    expect(record.tombstones).toContain('b.json')
    expect(record.entries['a.json']).toBeDefined()
  })

  test('pause stops between files and a later run resumes the remainder', async () => {
    writeFiles(root, { 'a.json': 'a', 'b.json': 'b', 'c.json': 'c' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const { target, firstPutStarted, release } = createGatedTarget()
    const queue = createMirrorQueue({ journal, uploadTarget: target, maxParallel: 1 })

    const entries = [entryFor(root, 'a.json'), entryFor(root, 'b.json'), entryFor(root, 'c.json')]
    queue.enqueue(planMirrorDiff(entries, await journal.load()))
    const running = queue.run()
    await firstPutStarted
    queue.pause()
    release()
    const first = await running

    expect(first.paused).toBe(true)
    expect(first.added).toBe(1)
    expect(queue.status().state).toBe('paused')

    const second = await queue.run()
    expect(second.paused).toBe(false)
    expect(second.added).toBe(3)
    expect(queue.status()).toMatchObject({ state: 'idle', filesDone: 3 })
    expect(target.puts).toHaveLength(3)
  })

  test('cancel interrupts the run, marks it cancelled, and a later run finishes', async () => {
    writeFiles(root, { 'a.json': 'a', 'b.json': 'b', 'c.json': 'c' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const { target, firstPutStarted, release } = createGatedTarget()
    const queue = createMirrorQueue({ journal, uploadTarget: target, maxParallel: 1 })

    const entries = [entryFor(root, 'a.json'), entryFor(root, 'b.json'), entryFor(root, 'c.json')]
    queue.enqueue(planMirrorDiff(entries, await journal.load()))
    const running = queue.run()
    await firstPutStarted
    queue.cancel()
    expect(queue.status().state).toBe('cancelled')
    release()
    const first = await running

    expect(first.cancelled).toBe(true)
    expect(queue.status().state).toBe('cancelled')

    const second = await queue.run()
    expect(second.cancelled).toBe(false)
    expect(second.added).toBe(3)
    expect(target.puts).toHaveLength(3)
  })

  test('per-file errors are collected without aborting the run (mixed → idle)', async () => {
    writeFiles(root, { 'a.json': 'a', 'b.json': 'b', 'c.json': 'c' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const target = createFakeTarget(['app-mirror/b.json'])
    const queue = createMirrorQueue({
      journal,
      uploadTarget: target,
      sleep: async () => {},
      maxParallel: 1,
    })

    const entries = [entryFor(root, 'a.json'), entryFor(root, 'b.json'), entryFor(root, 'c.json')]
    queue.enqueue(planMirrorDiff(entries, await journal.load()))
    const result = await queue.run()

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.relativePath).toBe('b.json')
    expect(result.added).toBe(2)
    expect(queue.status().state).toBe('idle')
    const record = await journal.load()
    expect(record.entries['a.json']).toBeDefined()
    expect(record.entries['c.json']).toBeDefined()
    expect(record.entries['b.json']).toBeUndefined()
  })

  test('when every file fails the state is error', async () => {
    writeFiles(root, { 'a.json': 'a', 'b.json': 'b' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const target = createFakeTarget(['app-mirror/a.json', 'app-mirror/b.json'])
    const queue = createMirrorQueue({ journal, uploadTarget: target, sleep: async () => {}, maxParallel: 1 })

    queue.enqueue(planMirrorDiff([entryFor(root, 'a.json'), entryFor(root, 'b.json')], await journal.load()))
    const result = await queue.run()

    expect(result.errors).toHaveLength(2)
    expect(result.added).toBe(0)
    expect(queue.status().state).toBe('error')
  })

  test('enqueue is rejected while a run is in flight', async () => {
    writeFiles(root, { 'a.json': 'a' })
    const journal = createMirrorJournal({ stateDir, mirrorId: 'm' })
    const { target, firstPutStarted, release } = createGatedTarget()
    const queue = createMirrorQueue({ journal, uploadTarget: target })

    queue.enqueue(planMirrorDiff([entryFor(root, 'a.json')], await journal.load()))
    const running = queue.run()
    await firstPutStarted
    expect(() => queue.enqueue({ add: [], changed: [], unchanged: [], tombstones: [] })).toThrow()
    release()
    await running
  })
})