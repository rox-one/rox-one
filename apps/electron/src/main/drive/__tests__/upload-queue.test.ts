/**
 * Tests for the resumable multi-stream upload queue.
 *
 * Everything is driven by in-memory fakes and injected no-op timers, so the
 * suite is timing-independent: no wall-clock sleep, no real file unless a test
 * is specifically exercising the JSON store + node file source.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_PARALLEL_STREAMS,
  UploadQueue,
  createNodeFileSource,
  type CompletedPart,
  type FileSource,
  type OpenUploadSessionInput,
  type UploadQueueOptions,
  type UploadSessionHandle,
  type UploadTransport,
} from '../upload-queue'
import { createFileQueueStore, type PersistedUploadQueue, type QueueStore } from '../upload-store'

const transient = () => Object.assign(new Error('transient'), { code: 'ECONNRESET' })

interface FakeFile extends FileSource {
  bytes: Uint8Array
  reads: Array<[number, number]>
}

function fakeFile(size: number, seed = 1): FakeFile {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 7 + seed) % 251
  const reads: Array<[number, number]> = []
  return {
    path: `mem://file-${seed}-${size}`,
    size,
    bytes,
    reads,
    async read(start, end) {
      reads.push([start, end])
      return bytes.slice(start, end)
    },
  }
}

class MemoryStore implements QueueStore {
  state?: PersistedUploadQueue

  load(): PersistedUploadQueue | undefined {
    return this.state ? (JSON.parse(JSON.stringify(this.state)) as PersistedUploadQueue) : undefined
  }

  save(next: PersistedUploadQueue): void {
    this.state = JSON.parse(JSON.stringify(next)) as PersistedUploadQueue
  }
}

class FakeTransport implements UploadTransport {
  openCalls: OpenUploadSessionInput[] = []
  putCalls: Array<{ uploadId: string; partNumber: number; size: number }> = []
  completions: Array<{ uploadId: string; parts: CompletedPart[] }> = []
  aborts: string[] = []
  inFlight = 0
  maxInFlight = 0
  hold = false
  partSizeOverride?: number
  lastUploadId?: string

  private readonly sessions = new Map<string, Set<number>>()
  private readonly byPath = new Map<string, string>()
  private readonly failures = new Map<number, number>()
  private readonly held: Array<() => void> = []
  private generated = 0

  failPart(partNumber: number, times = Number.POSITIVE_INFINITY): void {
    this.failures.set(partNumber, times)
  }

  clearFailures(): void {
    this.failures.clear()
  }

  releaseHeld(): void {
    this.hold = false
    for (const resolve of this.held.splice(0)) resolve()
  }

  async openSession(file: OpenUploadSessionInput): Promise<UploadSessionHandle> {
    this.openCalls.push(file)
    let uploadId = this.byPath.get(file.path)
    if (!uploadId) {
      uploadId = `up-${++this.generated}`
      this.byPath.set(file.path, uploadId)
      this.sessions.set(uploadId, new Set())
    }
    this.lastUploadId = uploadId
    return {
      uploadId,
      partSize: this.partSizeOverride,
      existingParts: [...(this.sessions.get(uploadId) ?? [])].sort((a, b) => a - b),
    }
  }

  async putPart(uploadId: string, partNumber: number, chunk: Uint8Array): Promise<{ etag: string }> {
    this.putCalls.push({ uploadId, partNumber, size: chunk.length })
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      if (this.hold) {
        const { promise, resolve } = Promise.withResolvers<void>()
        this.held.push(resolve)
        await promise
      } else {
        await Promise.resolve()
      }
      const remaining = this.failures.get(partNumber) ?? 0
      if (remaining > 0) {
        this.failures.set(partNumber, remaining - 1)
        throw transient()
      }
      this.sessions.get(uploadId)?.add(partNumber)
      return { etag: `etag-${partNumber}` }
    } finally {
      this.inFlight -= 1
    }
  }

  async complete(uploadId: string, parts: CompletedPart[]): Promise<{ fileId: string }> {
    this.completions.push({ uploadId, parts: parts.map(part => ({ ...part })) })
    return { fileId: `file-${uploadId}` }
  }

  async abort(uploadId: string): Promise<void> {
    this.aborts.push(uploadId)
  }
}

const instantSleep = async (): Promise<void> => {}

/** Yield to the microtask queue so in-process async work can make progress. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

async function waitFor(condition: () => boolean, label: string, maxTicks = 2000): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (condition()) return
    await flushMicrotasks(1)
  }
  throw new Error(`condition not met: ${label}`)
}

function makeQueue(transport: UploadTransport, extra: Partial<UploadQueueOptions> = {}): UploadQueue {
  return new UploadQueue({
    transport,
    partSize: 1,
    sleep: instantSleep,
    ...extra,
  })
}

describe('upload queue', () => {
  let transport: FakeTransport

  beforeEach(() => {
    transport = new FakeTransport()
  })

  test('uploads every part across 8 concurrent streams', async () => {
    const file = fakeFile(40, 1)
    const queue = makeQueue(transport)
    queue.enqueue(file)
    transport.hold = true

    await queue.start()
    const drained = queue.drain()
    await waitFor(() => transport.inFlight === MAX_PARALLEL_STREAMS, '8 in flight')
    expect(transport.maxInFlight).toBe(MAX_PARALLEL_STREAMS)
    transport.releaseHeld()
    await drained

    expect(transport.putCalls.map(call => call.partNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(transport.completions).toHaveLength(1)
    const parts = transport.completions[0]!.parts
    expect(parts.map(part => part.partNumber)).toEqual(Array.from({ length: 40 }, (_, i) => i))
  })

  test('never exceeds the concurrency cap across multiple files', async () => {
    const files = [fakeFile(15, 1), fakeFile(15, 2), fakeFile(15, 3)]
    const queue = makeQueue(transport)
    for (const file of files) queue.enqueue(file)
    transport.hold = true

    await queue.start()
    const drained = queue.drain()
    await waitFor(() => transport.inFlight === MAX_PARALLEL_STREAMS, 'cap reached')
    await flushMicrotasks()
    expect(transport.maxInFlight).toBeLessThanOrEqual(MAX_PARALLEL_STREAMS)
    transport.releaseHeld()
    await drained

    expect(transport.completions).toHaveLength(3)
    expect(transport.maxInFlight).toBeLessThanOrEqual(MAX_PARALLEL_STREAMS)
  })

  test('retries transient part failures with exponential backoff', async () => {
    const delays: number[] = []
    const file = fakeFile(6, 1)
    const queue = new UploadQueue({
      transport,
      partSize: 1,
      backoffMs: attempt => attempt * 100,
      sleep: async ms => {
        delays.push(ms)
      },
    })
    transport.failPart(3, 5) // fails 5 times, succeeds on the 6th try
    queue.enqueue(file)
    await queue.start()
    await queue.drain()

    expect(transport.completions).toHaveLength(1)
    expect(transport.putCalls.filter(call => call.partNumber === 3)).toHaveLength(6)
    expect(delays).toEqual([100, 200, 300, 400, 500])
  })

  test('resumes only the missing parts after a mid-flight failure', async () => {
    const store = new MemoryStore()
    const file = fakeFile(8, 1)
    const queue = makeQueue(transport, { store })
    transport.failPart(5, Number.POSITIVE_INFINITY)
    queue.enqueue(file)
    await queue.start()
    await queue.drain()

    expect(transport.completions).toHaveLength(0)
    const persisted = store.state!.files
    expect(persisted).toHaveLength(1)
    const storedParts = persisted[0]!.parts.map(part => part.number).sort((a, b) => a - b)
    expect(storedParts).toEqual([0, 1, 2, 3, 4, 6, 7])

    // Restart: same store, transport recovered. Only part 5 is re-sent.
    const second = makeQueue(transport, { store, resolveSource: async () => file })
    transport.clearFailures()
    transport.putCalls = []
    transport.aborts = []
    await second.start()
    await second.drain()

    expect(transport.putCalls.map(call => call.partNumber)).toEqual([5])
    expect(transport.completions).toHaveLength(1)
    expect(transport.completions[0]!.parts.map(part => part.partNumber)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(store.state!.files).toHaveLength(0)
  })

  test('cancels a file during flight and aborts its session', async () => {
    const store = new MemoryStore()
    const file = fakeFile(10, 1)
    const queue = makeQueue(transport, { store })
    transport.hold = true
    const id = queue.enqueue(file)

    await queue.start()
    const drained = queue.drain()
    await waitFor(() => transport.inFlight >= 1, 'in flight')
    const uploadId = transport.lastUploadId
    await queue.cancelFile(id)
    expect(transport.aborts).toContain(uploadId as string)

    transport.releaseHeld()
    await drained

    expect(transport.completions).toHaveLength(0)
    expect(queue.getFiles()).toHaveLength(0)
    expect(store.state!.files).toHaveLength(0)
  })

  test('orders parts by number and keeps the last part smaller', async () => {
    const file = fakeFile(10, 9)
    const queue = new UploadQueue({ transport, partSize: 4, sleep: instantSleep })
    queue.enqueue(file)
    await queue.start()
    await queue.drain()

    expect(
      transport.putCalls.map(call => [call.partNumber, call.size]).sort((a, b) => a[0]! - b[0]!),
    ).toEqual([
      [0, 4],
      [1, 4],
      [2, 2],
    ])
    expect([...file.reads].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ])
    expect(transport.completions[0]!.parts.map(part => part.partNumber)).toEqual([0, 1, 2])
  })

  test('honours a transport-provided part size override', async () => {
    const file = fakeFile(5, 4)
    transport.partSizeOverride = 2
    const queue = new UploadQueue({ transport, partSize: 6, sleep: instantSleep })
    queue.enqueue(file)
    await queue.start()
    await queue.drain()

    expect(
      transport.putCalls.map(call => [call.partNumber, call.size]).sort((a, b) => a[0]! - b[0]!),
    ).toEqual([
      [0, 2],
      [1, 2],
      [2, 1],
    ])
    expect(transport.completions[0]!.parts).toHaveLength(3)
  })

  test('pauses without launching parts and resumes on demand', async () => {
    const file = fakeFile(10, 1)
    const queue = makeQueue(transport)
    queue.enqueue(file)
    queue.pause()
    await queue.start()
    await flushMicrotasks()
    expect(transport.putCalls).toHaveLength(0)

    queue.resume()
    await queue.drain()
    expect(transport.putCalls).toHaveLength(10)
    expect(transport.completions).toHaveLength(1)
  })

  test('emits per-file and overall progress', async () => {
    const events: Array<{ doneBytes: number; status: string }> = []
    const file = fakeFile(3, 1)
    const queue = new UploadQueue({
      transport,
      partSize: 1,
      sleep: instantSleep,
      onProgress: event => events.push({ doneBytes: event.overall.doneBytes, status: event.file.status }),
    })
    queue.enqueue(file)
    await queue.start()
    await queue.drain()

    expect(events.some(event => event.status === 'completed' && event.doneBytes === 3)).toBe(true)
  })
})

describe('upload queue JSON store', () => {
  let dir: string
  let transport: FakeTransport

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rox-upload-queue-'))
    transport = new FakeTransport()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('persists state to disk and restores it on the next run', async () => {
    const path = join(dir, 'payload.bin')
    await writeFile(path, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    const storePath = join(dir, 'queue.json')

    transport.failPart(2, Number.POSITIVE_INFINITY)
    const first = new UploadQueue({
      transport,
      partSize: 4,
      sleep: instantSleep,
      store: createFileQueueStore(storePath),
    })
    const source = await createNodeFileSource(path)
    first.enqueue(source)
    await first.start()
    await first.drain()

    expect(transport.completions).toHaveLength(0)
    const restored = await createFileQueueStore(storePath).load()
    expect(restored?.files).toHaveLength(1)
    expect(restored!.files[0]!.parts.map(part => part.number).sort((a, b) => a - b)).toEqual([0, 1])

    transport.clearFailures()
    transport.putCalls = []
    const second = new UploadQueue({
      transport,
      partSize: 4,
      sleep: instantSleep,
      store: createFileQueueStore(storePath),
      resolveSource: async file => createNodeFileSource(file.path),
    })
    await second.start()
    await second.drain()

    expect(transport.putCalls.map(call => call.partNumber)).toEqual([2])
    // Parts are handed to `complete` in numeric order, last part smaller.
    const completed = transport.completions[0]!.parts
    expect(completed.map(part => part.partNumber)).toEqual([0, 1, 2])
    expect(await createFileQueueStore(storePath).load()).toEqual({ version: 1, files: [] })
  })
})