import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImportJobRunner } from '../job-runner'
import type {
  DriveUploadTarget,
  ImportEvent,
  ImportProvider,
  ImportProviderId,
  ImportSourceEntry,
} from '../types'

const ROOT = 'root'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

class FakeProvider implements ImportProvider {
  readonly id: ImportProviderId = 'google-drive'
  readonly tree: Record<string, ImportSourceEntry[]>
  readonly streams = new Map<string, Uint8Array>()
  /** Remaining failures per source id before the stream succeeds; Infinity = always. */
  readonly failures = new Map<string, number>()

  constructor(tree: Record<string, ImportSourceEntry[]>) {
    this.tree = tree
  }

  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    return this.tree[folderId ?? ROOT] ?? []
  }

  async stream(sourceId: string): Promise<ReadableStream<Uint8Array>> {
    const remaining = this.failures.get(sourceId) ?? 0
    if (remaining > 0) {
      this.failures.set(sourceId, remaining - 1)
      throw new Error(`stream failed: ${sourceId}`)
    }
    const bytes = this.streams.get(sourceId)
    if (!bytes) throw new Error(`no bytes for: ${sourceId}`)
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }
}

interface PutRecord {
  key: string
  bytes: number[]
}

function recordingTarget(record: PutRecord[], gate?: Map<string, Promise<void>>): DriveUploadTarget {
  return {
    async put(key, body) {
      const hold = gate?.get(key)
      if (hold) await hold
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
      record.push({ key, bytes: [...bytes] })
    },
  }
}

/** a.txt, Folder/b.txt, c.txt — DFS order is stable across runs. */
function sampleTree(): FakeProvider {
  const provider = new FakeProvider({
    [ROOT]: [
      { id: 'a', name: 'a.txt', kind: 'file', sizeBytes: 3 },
      { id: 'F', name: 'Folder', kind: 'folder' },
      { id: 'c', name: 'c.txt', kind: 'file', sizeBytes: 5 },
    ],
    F: [{ id: 'b', name: 'b.txt', kind: 'file', sizeBytes: 4 }],
  })
  provider.streams.set('a', new Uint8Array([1, 1, 1]))
  provider.streams.set('b', new Uint8Array([2, 2, 2, 2]))
  provider.streams.set('c', new Uint8Array([3, 3, 3, 3, 3]))
  return provider
}

describe('import job runner', () => {
  let stateDir: string

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'rox-drive-imports-'))
  })

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true })
  })

  test('plans a provider tree into DFS file order', async () => {
    const provider = sampleTree()
    const runner = createImportJobRunner({
      target: recordingTarget([]),
      stateDir,
      providers: [provider],
      generateId: () => 'job-order',
    })
    const job = await runner.plan('google-drive')
    expect(job.status).toBe('idle')
    expect(job.provider).toBe('google-drive')
    expect(job.plan.map(node => node.path)).toEqual(['a.txt', 'Folder/b.txt', 'c.txt'])
    expect(job.progress).toMatchObject({ filesTotal: 3, filesDone: 0, bytesTotal: 12, bytesDone: 0 })
  })

  test('uploads every planned file in order and reports totals', async () => {
    const provider = sampleTree()
    const record: PutRecord[] = []
    const runner = createImportJobRunner({
      target: recordingTarget(record),
      stateDir,
      providers: [provider],
      concurrency: 1,
    })
    const job = await runner.plan('google-drive')
    const done = await runner.start(job.id)
    expect(done.status).toBe('done')
    expect(done.progress).toMatchObject({ filesDone: 3, filesTotal: 3, bytesDone: 12, bytesTotal: 12 })
    expect(record.map(entry => entry.key)).toEqual([`${job.id}/a.txt`, `${job.id}/Folder/b.txt`, `${job.id}/c.txt`])
    expect(record.map(entry => entry.bytes.length)).toEqual([3, 4, 5])
  })

  test('retries a file with backoff and succeeds within the attempt budget', async () => {
    const provider = sampleTree()
    provider.failures.set('b', 2)
    const record: PutRecord[] = []
    const events: ImportEvent[] = []
    const runner = createImportJobRunner({
      target: recordingTarget(record),
      stateDir,
      providers: [provider],
      concurrency: 1,
      sleep: async () => {},
    })
    runner.subscribe(event => events.push(event))
    const job = await runner.plan('google-drive')
    const done = await runner.start(job.id)

    expect(done.status).toBe('done')
    const retryAttempts = events
      .filter((event): event is Extract<ImportEvent, { type: 'retry' }> => event.type === 'retry')
      .map(event => event.attempt)
    expect(retryAttempts).toEqual([1, 2])
    expect(record.map(entry => entry.key)).toEqual([`${job.id}/a.txt`, `${job.id}/Folder/b.txt`, `${job.id}/c.txt`])
  })

  test('marks the job errored after exhausting attempts and stops scheduling', async () => {
    const provider = sampleTree()
    provider.failures.set('b', Number.POSITIVE_INFINITY)
    const record: PutRecord[] = []
    const runner = createImportJobRunner({
      target: recordingTarget(record),
      stateDir,
      providers: [provider],
      concurrency: 1,
      maxAttempts: 3,
      sleep: async () => {},
    })
    const job = await runner.plan('google-drive')
    const failed = await runner.start(job.id)

    expect(failed.status).toBe('error')
    expect(failed.error).toContain('Folder/b.txt')
    // a.txt committed before b failed; c.txt was never attempted.
    expect(record.map(entry => entry.key)).toEqual([`${job.id}/a.txt`])
    expect(failed.progress.filesDone).toBe(1)
  })

  test('resumes a fresh runner from the last committed file', async () => {
    const provider = sampleTree()
    provider.failures.set('b', Number.POSITIVE_INFINITY)
    const record: PutRecord[] = []
    const first = createImportJobRunner({
      target: recordingTarget(record),
      stateDir,
      providers: [provider],
      concurrency: 1,
      sleep: async () => {},
    })
    const job = await first.plan('google-drive')
    await first.start(job.id)
    expect(record.map(entry => entry.key)).toEqual([`${job.id}/a.txt`])

    // A brand-new process (fresh runner) reads the persisted job back.
    provider.failures.delete('b')
    const second = createImportJobRunner({
      target: recordingTarget(record),
      stateDir,
      providers: [provider],
      concurrency: 1,
      sleep: async () => {},
    })
    const resumed = await second.resume(job.id)
    expect(resumed.status).toBe('done')
    // a.txt was committed before the crash and must not be re-sent.
    expect(record.map(entry => entry.key)).toEqual([
      `${job.id}/a.txt`,
      `${job.id}/Folder/b.txt`,
      `${job.id}/c.txt`,
    ])
  })

  test('pauses after the in-flight file and resumes the remainder', async () => {
    const provider = sampleTree()
    const gate = deferred()
    const record: PutRecord[] = []
    const target: DriveUploadTarget = {
      async put(key, body) {
        if (key.endsWith('a.txt')) await gate.promise
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
        record.push({ key, bytes: [...bytes] })
      },
    }
    const runner = createImportJobRunner({
      target,
      stateDir,
      providers: [provider],
      concurrency: 1,
      sleep: async () => {},
    })
    const job = await runner.plan('google-drive')
    const running = runner.start(job.id)
    const pausing = runner.pause(job.id)
    gate.resolve()
    await pausing
    await running

    const paused = await runner.status(job.id)
    expect(paused && !Array.isArray(paused) ? paused.status : null).toBe('paused')
    expect(record.map(entry => entry.key)).toEqual([`${job.id}/a.txt`])

    const resumed = await runner.resume(job.id)
    expect(resumed.status).toBe('done')
    expect(record).toHaveLength(3)
  })

  test('lists known jobs and returns null for an unknown id', async () => {
    const provider = sampleTree()
    const runner = createImportJobRunner({
      target: recordingTarget([]),
      stateDir,
      providers: [provider],
    })
    const job = await runner.plan('google-drive')
    expect(await runner.status('missing')).toBeNull()
    const list = await runner.status()
    expect(Array.isArray(list) && list.map(entry => entry.id)).toEqual([job.id])
  })

  test('rejects a provider whose folder graph is cyclic instead of looping', async () => {
    const selfReferencing = new FakeProvider({
      [ROOT]: [{ id: 'loop', name: 'loop', kind: 'folder' }],
      loop: [{ id: 'loop', name: 'loop', kind: 'folder' }],
    })
    const runner = createImportJobRunner({
      target: recordingTarget([]),
      stateDir,
      providers: [selfReferencing],
      generateId: () => 'job-cycle',
    })
    await expect(runner.plan('google-drive')).rejects.toMatchObject({ code: 'DRIVE_IMPORT_CYCLE', folderId: 'loop' })
    // The unusable plan left no job behind: not in memory, not on disk.
    expect(await runner.status()).toEqual([])
    expect(existsSync(join(stateDir, 'job-cycle.json'))).toBe(false)

    // A ring (A -> B -> A) is the same defect one level deeper.
    const ring = new FakeProvider({
      [ROOT]: [{ id: 'A', name: 'A', kind: 'folder' }],
      A: [{ id: 'B', name: 'B', kind: 'folder' }],
      B: [{ id: 'A', name: 'A', kind: 'folder' }],
    })
    const ringRunner = createImportJobRunner({ target: recordingTarget([]), stateDir, providers: [ring] })
    await expect(ringRunner.plan('google-drive')).rejects.toMatchObject({ code: 'DRIVE_IMPORT_CYCLE', folderId: 'A' })
  })

  test('allows the same folder id under two sibling branches', async () => {
    // Reachable twice but not through itself: a visited-set keyed on the whole
    // run would wrongly reject this, so it stays legal and plans both copies.
    const provider = new FakeProvider({
      [ROOT]: [
        { id: 'one', name: 'one', kind: 'folder' },
        { id: 'two', name: 'two', kind: 'folder' },
      ],
      one: [{ id: 'shared', name: 'shared', kind: 'folder' }],
      two: [{ id: 'shared', name: 'shared', kind: 'folder' }],
      shared: [{ id: 'x', name: 'x.txt', kind: 'file', sizeBytes: 1 }],
    })
    const runner = createImportJobRunner({ target: recordingTarget([]), stateDir, providers: [provider] })
    const job = await runner.plan('google-drive')
    expect(job.status).toBe('idle')
    expect(job.plan.map(node => node.path)).toEqual(['one/shared/x.txt', 'two/shared/x.txt'])
  })

  test('rejects a provider that was never registered', async () => {
    const runner = createImportJobRunner({ target: recordingTarget([]), stateDir })
    await expect(runner.plan('onedrive')).rejects.toMatchObject({ code: 'DRIVE_IMPORT_PROVIDER_UNKNOWN' })
  })
})