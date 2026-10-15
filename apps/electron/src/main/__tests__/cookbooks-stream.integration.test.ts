/**
 * Cookbooks sidecar — live streaming integration test (SPEC wave 15 §Решения 7,
 * §Контракт кадров).
 *
 * End-to-end proof that the wave-15 stream transport works through the REAL
 * vendored sidecar and the real runtime: `POST /run-stream` resolves `{runId}`
 * while the cell is still running, its NDJSON frames arrive live and ordered,
 * a cancelled run ends with `end.cancelled` and a partial stdout, a batch
 * streams per-cell frames, and a store secret never crosses a frame boundary
 * unmasked.
 *
 * The scenarios are GATED on the vendored snapshot actually exposing the routes
 * (`/run-stream`, `/run-all-stream` — added by the lab slices, then re-vendored
 * by slice V1): until then each scenario skips with a named reason rather than
 * failing. A missing interpreter skips locally but fails loudly in CI, so the
 * E2E can never disappear quietly from the gate. No mocks: the runtime drives a
 * real `serve_lab.py` child and the kernel runs in the copy's own venv.
 */
import { afterAll, expect, it } from 'bun:test'
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getToolchain } from '@rox/shared/toolchain-runtime'
import type { CookbooksRunStreamEvent } from '../../shared/cookbooks'
import { CookbooksRuntime, type CookbooksChild, type CookbooksSpawnFn } from '../cookbooks-runtime'

const COOKBOOKS_DIR = join(import.meta.dir, '..', '..', '..', 'resources', 'cookbooks')
const HOST_PY = join(COOKBOOKS_DIR, 'src', 'rox_cookbooks', 'host.py')

/** The lab key the redaction scenario arms, and the value that must never leak. */
const SECRET_KEY = 'openai.api_key'
const SECRET = 'sk-abcdef'

/**
 * The store the sidecar is fed. Empty for every scenario but the redaction one,
 * which arms it just before it runs: a registered secret makes the lab hold back
 * the tail of its output, and the live-timing scenarios must not be slowed by a
 * guard they are not testing.
 */
let storeSnapshot: Record<string, string> = {}

/** Two prints with a 0.6 s sleep between them: 'a' is live, 'b' is late. */
const LIVE_CODE = "print('a')\nimport time\ntime.sleep(0.6)\nprint('b')\n"

async function detectPython(): Promise<string | null> {
  try {
    const managed = await getToolchain().resolver.findExecutable('python3')
    if (managed && existsSync(managed)) return managed
  } catch {
    /* resolver unavailable — fall through to the explicit sources */
  }
  const uvPython = process.env.UV_PYTHON?.trim()
  if (uvPython && existsSync(uvPython)) return uvPython
  for (const segment of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(segment, 'python3')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const pythonPath = await detectPython()
// Wave 11 precedent: a missing interpreter skips on a dev machine but is a hard
// failure in CI, so the E2E can never vanish from the gate unnoticed.
if (!pythonPath && process.env.CI) {
  throw new Error('python3 required for the live-stream E2E in CI')
}

// Is the vendored snapshot carrying the wave-15 stream routes yet? A snapshot
// that predates them skips its scenarios with a named reason instead of
// failing, until `PROVENANCE.md` re-vendors the lab.
const hostSource = existsSync(HOST_PY) ? readFileSync(HOST_PY, 'utf8') : ''
const hasRunStream = hostSource.includes('/run-stream')
const hasRunAllStream = hostSource.includes('/run-all-stream')

const tempDirs: string[] = []
/** The one sidecar every scenario shares (a fresh venv per scenario is waste). */
let running: CookbooksRuntime | null = null

afterAll(async () => {
  await running?.stop()
  running = null
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Real wall-clock delay. These scenarios drive an actual Python subprocess: the
 * kernel needs genuine time to start and to be torn down, so deterministic fake
 * timers cannot stand in for the platform process scheduler here.
 */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Poll `check` with a real deadline (the sidecar answers from another process). */
async function waitFor(check: () => boolean, timeoutMs = 10_000, what = 'the sidecar'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
    await delay(50)
  }
}

interface StreamSink {
  events: CookbooksRunStreamEvent[]
  /** `performance.now()` at the moment each event arrived, index-aligned. */
  at: number[]
  /** Resolves on the stream's terminal frame (`end` or `error`). */
  settled: Promise<void>
  onEvent(event: CookbooksRunStreamEvent): void
}

/** Record the pushed frames, their arrival times and the terminal signal. */
function collect(): StreamSink {
  const events: CookbooksRunStreamEvent[] = []
  const at: number[] = []
  const settled = Promise.withResolvers<void>()
  const onEvent = (event: CookbooksRunStreamEvent) => {
    events.push(event)
    at.push(performance.now())
    if (event.t === 'end' || event.t === 'error') settled.resolve()
  }
  return { events, at, settled: settled.promise, onEvent }
}

interface Sidecar {
  runtime: CookbooksRuntime
  itemId: string
  /** Two distinct runnable cell indexes, in document order. */
  codeIndexes: number[]
}

/**
 * Start the real runtime on the vendored snapshot in its own temp workspace and
 * resume the personal copy, making sure the copy carries two runnable cells for
 * the batch scenario. The store carries one secret, which the redaction
 * scenario needs and no other scenario prints.
 */
async function startSidecar(): Promise<Sidecar> {
  const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-stream-it-'))
  tempDirs.push(workspace)
  if (!existsSync(COOKBOOKS_DIR)) throw new Error(`vendored snapshot missing: ${COOKBOOKS_DIR}`)

  const spawn: CookbooksSpawnFn = (command, args, options) =>
    nodeSpawn(command, args, options) as unknown as CookbooksChild

  const runtime = new CookbooksRuntime({
    spawn,
    resolvePython: async () => pythonPath,
    getCookbooksDir: () => COOKBOOKS_DIR,
    getWorkspaceDir: () => workspace,
    resolveStore: async () => storeSnapshot,
  })
  running = runtime
  const status = await runtime.ensure()
  if (status.state !== 'running') throw new Error(`sidecar did not start: ${status.state}/${status.reason}`)

  const cards = await runtime.apiCatalog()
  const notebook = cards.find((card) => card.kind === 'ipynb' && !card.disabled)
  if (!notebook) throw new Error('the vendored catalog exposes no runnable notebook')
  const itemId = notebook.id
  // Resume/create the personal copy — every run below persists into it.
  await runtime.apiOpen(itemId)
  // Guarantee two code cells whatever the vendored notebook starts with (the
  // batch route validates every submitted index against the document).
  await runtime.apiMutate({ itemId, op: 'add', cellType: 'code', index: 0, source: 'print("added")' })
  await runtime.apiMutate({ itemId, op: 'add', cellType: 'code', index: 0, source: 'print("added")' })
  const document = await runtime.apiDocument(itemId)
  const codeIndexes = document.cells.flatMap((cell, index) => (cell.cellType === 'code' ? [index] : []))
  if (codeIndexes.length < 2) throw new Error('the copy exposes fewer than two runnable cells')
  return { runtime, itemId, codeIndexes }
}

let shared: Promise<Sidecar> | null = null

/** The shared sidecar, started on first use and stopped by `afterAll`. */
async function sidecarFor(): Promise<Sidecar> {
  if (!shared) shared = startSidecar()
  return shared
}

const runStreamSkipReason = !pythonPath
  ? 'python-not-found'
  : !hasRunStream
    ? 'sidecar /run-stream route not vendored yet (waits on the wave-15 re-vendor)'
    : undefined
const runAllStreamSkipReason = !pythonPath
  ? 'python-not-found'
  : !hasRunAllStream
    ? 'sidecar /run-all-stream route not vendored yet (waits on the wave-15 re-vendor)'
    : undefined

const streamIt = runStreamSkipReason ? it.skip : it
const runAllIt = runAllStreamSkipReason ? it.skip : it

streamIt(
  runStreamSkipReason ?? 'answers {runId} before the run ends and streams its frames in order',
  async () => {
    const { runtime, itemId, codeIndexes } = await sidecarFor()
    const sink = collect()

    const handle = await runtime.apiRunStream(
      { runId: 'it-run-live', itemId, code: LIVE_CODE, index: codeIndexes[0] },
      sink.onEvent,
    )
    const resolvedAt = performance.now()
    expect(handle).toEqual({ runId: 'it-run-live' })
    // F5/F8: the invoke answers while the run is still in flight — the second
    // print is 0.6 s away, so no `end` can have arrived yet.
    expect(sink.events.some((event) => event.t === 'end')).toBe(false)

    await sink.settled

    // Order: `start` first, `end` last, one terminal frame, frames 1:1 with seq.
    const frames = sink.events.map((event) => event.t)
    expect(frames[0]).toBe('start')
    expect(frames[frames.length - 1]).toBe('end')
    expect(frames.filter((frame) => frame === 'end')).toHaveLength(1)
    expect(sink.events.map((event) => event.seq)).toEqual(sink.events.map((_, index) => index))
    expect(sink.events.every((event) => event.runId === 'it-run-live')).toBe(true)
    expect(sink.at[sink.at.length - 1]).toBeGreaterThan(resolvedAt)

    const start = sink.events[0]
    if (start.t !== 'start') throw new Error('first frame is not `start`')
    expect(start.itemId).toBe(itemId)
    // `/run-stream` is a single-cell run: no cell list on its start frame.
    expect(start.cells).toBeNull()

    const end = sink.events[sink.events.length - 1]
    if (end.t !== 'end') throw new Error('last frame is not `end`')
    expect(end.ok).toBe(true)
    expect(end.cancelled).toBe(false)
    expect(end.timedOut).toBe(false)
    // The host measures the cell, so a real run reports real time.
    expect(typeof end.durationMs).toBe('number')
    expect(end.durationMs ?? 0).toBeGreaterThan(0)
    // The authoritative final DTO carries the whole output, not just the frames.
    if (!('stdout' in end.result)) throw new Error('the run end frame carries no stdout')
    expect(end.result.stdout).toContain('a')
    expect(end.result.stdout).toContain('b')
  },
  30_000,
)

streamIt(
  runStreamSkipReason ?? 'delivers the first live fragment well before the run finishes',
  async () => {
    const { runtime, itemId, codeIndexes } = await sidecarFor()
    const sink = collect()

    await runtime.apiRunStream(
      { runId: 'it-run-split', itemId, code: LIVE_CODE, index: codeIndexes[0] },
      sink.onEvent,
    )
    await sink.settled

    const firstOutput = sink.events.findIndex((event) => event.t === 'stdout')
    expect(firstOutput).toBeGreaterThanOrEqual(0)
    const endIndex = sink.events.length - 1
    expect(sink.events[endIndex].t).toBe('end')

    const first = sink.events[firstOutput]
    if (first.t !== 'stdout') throw new Error('the first live fragment is not stdout')
    expect(first.data).toContain('a')
    // F1: the 0.6 s sleep sits between the two prints, so the first fragment
    // landed ≥300 ms before the run ended — it was not buffered until the end.
    expect(sink.at[endIndex] - sink.at[firstOutput]).toBeGreaterThanOrEqual(300)
  },
  30_000,
)

streamIt(
  runStreamSkipReason ?? 'ends a live stream with cancelled:true and keeps the partial output',
  async () => {
    const { runtime, itemId, codeIndexes } = await sidecarFor()
    const sink = collect()

    await runtime.apiRunStream(
      {
        runId: 'it-run-cancel',
        itemId,
        index: codeIndexes[0],
        code: "print('tick', flush=True)\nimport time\ntime.sleep(30)\n",
      },
      sink.onEvent,
    )
    // Cancel a run that is genuinely streaming, not one still starting up.
    await waitFor(() => sink.events.some((event) => event.t === 'stdout'), 10_000, 'the first live fragment')
    const cancelledAt = performance.now()

    const cancelled = await runtime.apiCancel(itemId)
    expect(cancelled.ok).toBe(true)
    expect(cancelled.cancelled).toBeGreaterThanOrEqual(1)

    await waitFor(() => sink.events.some((event) => event.t === 'end'), 10_000, '`end` after the cancel')
    const endIndex = sink.events.length - 1
    const end = sink.events[endIndex]
    if (end.t !== 'end') throw new Error('last frame is not `end`')
    expect(end.cancelled).toBe(true)
    // F4: the interrupt lands promptly, not on the 30 s sleep.
    expect(sink.at[endIndex] - cancelledAt).toBeLessThan(10_000)
    // The partial output survives both the frames and the final DTO.
    const streamed = sink.events
      .filter((event) => event.t === 'stdout')
      .map((event) => ('data' in event ? event.data : ''))
      .join('')
    expect(streamed).toContain('tick')
    if (!('stdout' in end.result)) throw new Error('the run end frame carries no stdout')
    expect(end.result.stdout).toContain('tick')

    // The run is over for real: /cancel reports nothing left to interrupt.
    // /run releases its handle in finally after the response flush, so poll
    // across that ordering window (step 75 ms, up to ~4 s).
    let probe = await runtime.apiCancel(itemId)
    for (let attempt = 0; attempt < 50 && probe.cancelled !== 0; attempt++) {
      await delay(75)
      probe = await runtime.apiCancel(itemId)
    }
    expect(probe.cancelled).toBe(0)
  },
  30_000,
)

runAllIt(
  runAllStreamSkipReason ?? 'streams per-cell frames for a batch and ends with every cell record',
  async () => {
    const { runtime, itemId, codeIndexes } = await sidecarFor()
    const [first, second] = codeIndexes
    const sink = collect()

    const handle = await runtime.apiRunAllStream(
      {
        runId: 'it-batch-live',
        itemId,
        cells: [
          { index: first, source: 'print("one")' },
          { index: second, source: 'print("two")' },
        ],
      },
      sink.onEvent,
    )
    expect(handle).toEqual({ runId: 'it-batch-live' })
    await sink.settled

    const frames = sink.events.map((event) => event.t)
    expect(frames[0]).toBe('start')
    expect(frames[frames.length - 1]).toBe('end')

    const start = sink.events[0]
    if (start.t !== 'start') throw new Error('first frame is not `start`')
    expect(start.cells).toEqual([first, second])

    // start → (cell-start, … stdout …, cell-end) × 2 → end
    expect(frames.filter((frame) => frame === 'cell-start')).toHaveLength(2)
    expect(frames.filter((frame) => frame === 'cell-end')).toHaveLength(2)
    const cellStarts = frames.flatMap((frame, index) => (frame === 'cell-start' ? [index] : []))
    const cellEnds = frames.flatMap((frame, index) => (frame === 'cell-end' ? [index] : []))
    expect(cellStarts[0]).toBeLessThan(cellEnds[0])
    expect(cellStarts[1]).toBeGreaterThan(cellEnds[0])
    expect(cellEnds[1]).toBeLessThan(frames.length - 1)

    const cellRecords = sink.events.filter(
      (event): event is Extract<CookbooksRunStreamEvent, { t: 'cell-end' }> => event.t === 'cell-end',
    )
    expect(cellRecords.map((record) => record.index)).toEqual([first, second])
    // F2: each cell's own output is streamed before its `cell-end`, and the
    // record repeats it as the authoritatively persisted value.
    for (const [position, record] of cellRecords.entries()) {
      expect(record.stdout).toContain(position === 0 ? 'one' : 'two')
      expect(record.ok).toBe(true)
      expect(typeof record.durationMs).toBe('number')
    }

    const end = sink.events[sink.events.length - 1]
    if (end.t !== 'end') throw new Error('last frame is not `end`')
    const result: unknown = end.result
    if (typeof result !== 'object' || result === null || !('cells' in result) || !Array.isArray(result.cells)) {
      throw new Error('the batch end frame carries no cell list')
    }
    const cells = result.cells
    expect(cells).toHaveLength(2)
    const records = cells.map((cell) => {
      if (typeof cell !== 'object' || cell === null || !('index' in cell) || !('stdout' in cell)) {
        throw new Error('malformed cell record in the batch end frame')
      }
      return { index: cell.index, stdout: cell.stdout }
    })
    expect(records.map((record) => record.index)).toEqual([first, second])
    expect(records[0].stdout).toContain('one')
    expect(records[1].stdout).toContain('two')
  },
  30_000,
)

streamIt(
  runStreamSkipReason ?? 'masks a store secret that the cell prints in two writes',
  async () => {
    const { runtime, itemId, codeIndexes } = await sidecarFor()
    const sink = collect()

    // Arm the one-shot store for THIS run: the value is registered with the lab
    // and must never reach a frame unmasked.
    storeSnapshot = { [SECRET_KEY]: SECRET }

    // Two writes with no newline between them: the cell's stdout is the secret
    // split across a child write boundary, the case the holdback must cover.
    await runtime.apiRunStream(
      {
        runId: 'it-run-redact',
        itemId,
        index: codeIndexes[0],
        code: "print('sk-abc', end='')\nprint('def')\n",
      },
      sink.onEvent,
    )
    await sink.settled

    const streamed = sink.events
      .filter(
        (event): event is Extract<CookbooksRunStreamEvent, { t: 'stdout' | 'stderr' }> =>
          event.t === 'stdout' || event.t === 'stderr',
      )
      .map((event) => event.data)
      .join('')
    // F3: no single frame and no run of frames may carry the secret — the tail
    // of a masked line is held back rather than emitted half-masked.
    expect(streamed).toContain('***')
    expect(streamed).not.toContain(SECRET)
    expect(streamed).not.toContain('sk-abc')
    expect(streamed).not.toContain('def')

    const end = sink.events[sink.events.length - 1]
    if (end.t !== 'end') throw new Error('last frame is not `end`')
    if (!('stdout' in end.result)) throw new Error('the run end frame carries no stdout')
    expect(end.result.stdout).toContain('***')
    expect(end.result.stdout).not.toContain(SECRET)
    expect(end.result.stdout).not.toContain('sk-abc')
    expect(end.result.stdout).not.toContain('def')
  },
  30_000,
)
