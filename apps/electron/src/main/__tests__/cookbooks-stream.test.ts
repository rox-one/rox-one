/**
 * Cookbooks live streaming — the main-side NDJSON client (SPEC wave 15
 * §Решения 7 + §Контракт кадров).
 *
 * Three layers are exercised here:
 *  - the incremental NDJSON parser (chunk boundaries, an incomplete tail, CRLF,
 *    blank lines);
 *  - the sidecar's snake_case → DTO camelCase frame conversion with its
 *    monotonic `seq`;
 *  - a real loopback `Bun.serve` stub that streams NDJSON with delays, driven
 *    through the runtime's injected fake spawn, so the fast `{runId}` answer,
 *    the abort paths and the 4xx-before-start rejection are the real client's
 *    rather than a mock of it.
 *
 * The stub streams across a real socket, so its per-frame gaps are genuine
 * delays: "frames arrive BEFORE the run ends" is the behaviour under test and
 * fake timers cannot express it across a socket. They are kept to a few
 * milliseconds, and every assertion waits on the stream's own terminal event
 * (never on a guessed duration).
 */
import { describe, expect, it } from 'bun:test'
import {
  CookbooksRuntime,
  createCookbooksNdjsonParser,
  mapRunStreamFrame,
  type CookbooksChild,
  type CookbooksRuntimeOptions,
} from '../cookbooks-runtime'
import { CookbooksApiError, type CookbooksRunStreamEvent } from '../../shared/cookbooks'

const TOKEN = 'A'.repeat(32)
const NDJSON_HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
const line = (port: number) => `http://127.0.0.1:${port}/lab.html?token=${TOKEN}\n`

const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

/** Minimal child stand-in — the same fake the other cookbooks suites use. */
class FakeChild implements CookbooksChild {
  pid = Math.floor(Math.random() * 1e5)
  private out: Array<(chunk: Buffer | string) => void> = []
  private exits: Array<(code: number | null) => void> = []
  stdout = { on: (_event: 'data', cb: (chunk: Buffer | string) => void) => { this.out.push(cb) } }
  stderr = { on: (_event: 'data', _cb: (chunk: Buffer | string) => void) => {} }
  on(_event: 'exit', cb: (code: number | null) => void) { this.exits.push(cb) }
  kill() { this.exit(137); return true }
  emit(chunk: string) { for (const cb of this.out) cb(chunk) }
  exit(code: number | null) {
    const exits = this.exits
    this.exits = []
    for (const cb of exits) cb(code)
  }
}

/** Build a runtime on the fake spawn and drive it to `running` on `port`. */
async function runtimeOnPort(
  port: number,
  options: CookbooksRuntimeOptions = {},
): Promise<CookbooksRuntime> {
  const children: FakeChild[] = []
  const runtime = new CookbooksRuntime({
    spawn: () => { const child = new FakeChild(); children.push(child); return child },
    resolvePython: async () => '/usr/bin/python3',
    getCookbooksDir: () => '/res/cookbooks',
    getWorkspaceDir: () => '/ws',
    buildEnv: async () => ({ PATH: '/bin' }),
    resolveStore: async () => ({}),
    checkHealth: async () => true,
    ...options,
  })
  const ready = runtime.ensure()
  await tick()
  children[0].emit(line(port))
  await ready
  return runtime
}

/**
 * Record the pushed events and expose a promise that settles on the stream's
 * terminal frame — the tests await that signal instead of sleeping.
 */
function collectEvents() {
  const events: CookbooksRunStreamEvent[] = []
  const settled = Promise.withResolvers<void>()
  const onEvent = (event: CookbooksRunStreamEvent) => {
    events.push(event)
    if (event.t === 'end' || event.t === 'error') settled.resolve()
  }
  return { events, settled: settled.promise, onEvent }
}

/**
 * A body that writes one frame per `gapMs`. The `stopped` flag makes a client
 * abort terminal: the pending tick returns without enqueueing or rescheduling,
 * so nothing is ever written into a torn-down controller.
 */
function ndjsonStream(frames: string[], gapMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let stopped = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let next = 0
      const pump = () => {
        if (stopped) return
        if (next >= frames.length) {
          try { controller.close() } catch { /* already closed */ }
          return
        }
        try {
          controller.enqueue(encoder.encode(frames[next++]))
        } catch {
          stopped = true
          return
        }
        setTimeout(pump, gapMs)
      }
      pump()
    },
    cancel() {
      stopped = true
    },
  })
}

interface StubCall {
  path: string
  body: Record<string, unknown>
  authorization: string | null
}

/** Loopback stub for the stream routes, with the same bearer contract. */
function startStub(
  handler: (path: string, body: Record<string, unknown>) => Response | Promise<Response>,
) {
  const calls: StubCall[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const authorization = request.headers.get('authorization')
      if (authorization !== `Bearer ${TOKEN}`) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ path: url.pathname, body, authorization })
      return handler(url.pathname, body)
    },
  })
  const port = server.port
  if (port === undefined) throw new Error('stub sidecar did not bind a port')
  return { port, calls, stop: () => server.stop(true) }
}

// ---------------------------------------------------------------------------
// NDJSON parser
// ---------------------------------------------------------------------------

describe('createCookbooksNdjsonParser', () => {
  it('joins a frame split across chunks and holds an incomplete tail', () => {
    const parser = createCookbooksNdjsonParser()
    // Nothing is emitted until the terminating newline arrives.
    expect(parser.push('{"t":"start","ite')).toEqual([])
    expect(parser.push('mId":"probe"}')).toEqual([])
    expect(parser.push('\n{"t":"sta')).toEqual([{ t: 'start', itemId: 'probe' }])
    expect(parser.push('rt"}\n')).toEqual([{ t: 'start' }])
  })

  it('emits every complete frame of a single chunk and drops blank lines', () => {
    const parser = createCookbooksNdjsonParser()
    expect(parser.push('{"t":"end"}\n\n  \n{"t":"end"}\n')).toEqual([{ t: 'end' }, { t: 'end' }])
  })

  it('accepts CRLF line endings', () => {
    const parser = createCookbooksNdjsonParser()
    expect(parser.push('{"t":"stdout","data":"a"}\r\n{"t":"end"}\r\n')).toEqual([
      { t: 'stdout', data: 'a' },
      { t: 'end' },
    ])
  })

  it('never emits the trailing line before its newline', () => {
    const parser = createCookbooksNdjsonParser()
    expect(parser.push('{"t":"stdout","data":"a"}\n{"t":"stdout","data":"b"}')).toEqual([
      { t: 'stdout', data: 'a' },
    ])
  })

  it('rejects a line that is not a JSON object', () => {
    expect(() => createCookbooksNdjsonParser().push('not json\n')).toThrow()
    expect(() => createCookbooksNdjsonParser().push('[1,2]\n')).toThrow()
    expect(() => createCookbooksNdjsonParser().push('42\n')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Frame conversion
// ---------------------------------------------------------------------------

describe('mapRunStreamFrame', () => {
  it('converts the start frame', () => {
    expect(
      mapRunStreamFrame(
        { t: 'start', itemId: 'probe', index: null, cells: null, timeout: 90.0 },
        'run-1',
        0,
      ),
    ).toEqual({ t: 'start', runId: 'run-1', seq: 0, itemId: 'probe', index: null, cells: null, timeout: 90 })
  })

  it('converts a run-all start frame with its cell indexes', () => {
    expect(
      mapRunStreamFrame({ t: 'start', itemId: 'probe', index: null, cells: [0, 2], timeout: 150 }, 'run-2', 0),
    ).toMatchObject({ t: 'start', cells: [0, 2] })
  })

  it('converts cell-start / stdout / stderr / display', () => {
    expect(mapRunStreamFrame({ t: 'cell-start', index: 2 }, 'r', 1)).toEqual({
      t: 'cell-start',
      runId: 'r',
      seq: 1,
      index: 2,
    })
    expect(mapRunStreamFrame({ t: 'stdout', index: null, data: 'hi\n' }, 'r', 2)).toEqual({
      t: 'stdout',
      runId: 'r',
      seq: 2,
      index: null,
      data: 'hi\n',
    })
    expect(mapRunStreamFrame({ t: 'stderr', index: 0, data: 'boom\n' }, 'r', 3)).toEqual({
      t: 'stderr',
      runId: 'r',
      seq: 3,
      index: 0,
      data: 'boom\n',
    })
    expect(mapRunStreamFrame({ t: 'display', index: null, mime: 'text/plain', data: 'd' }, 'r', 4)).toEqual({
      t: 'display',
      runId: 'r',
      seq: 4,
      index: null,
      mime: 'text/plain',
      data: 'd',
    })
  })

  it('converts cell-end, camelCasing timed_out/duration_ms', () => {
    expect(
      mapRunStreamFrame(
        {
          t: 'cell-end',
          index: 1,
          status: 'ok',
          ok: true,
          timed_out: false,
          duration_ms: 12.6,
          returncode: 0,
          error: null,
          stdout: 'a\n',
          stderr: '',
          displays: [{ mime: 'text/plain', data: 'x' }],
        },
        'r',
        5,
      ),
    ).toEqual({
      t: 'cell-end',
      runId: 'r',
      seq: 5,
      index: 1,
      status: 'ok',
      ok: true,
      timedOut: false,
      durationMs: 13,
      returncode: 0,
      error: null,
      stdout: 'a\n',
      stderr: '',
      displays: [{ mime: 'text/plain', data: 'x' }],
    })
  })

  it('converts end into the full /run result DTO', () => {
    expect(
      mapRunStreamFrame(
        {
          t: 'end',
          ok: true,
          returncode: 0,
          timed_out: false,
          cancelled: false,
          missing: [],
          duration_ms: 42,
          result: { ok: true, stdout: 'a\n', duration_ms: 40 },
        },
        'r',
        6,
      ),
    ).toEqual({
      t: 'end',
      runId: 'r',
      seq: 6,
      ok: true,
      returncode: 0,
      timedOut: false,
      cancelled: false,
      missing: [],
      durationMs: 42,
      result: {
        ok: true,
        stdout: 'a\n',
        error: null,
        timedOut: false,
        missing: [],
        displays: [],
        durationMs: 40,
      },
    })
  })

  it('routes a run-all end.result through the batch mapper', () => {
    expect(
      mapRunStreamFrame(
        {
          t: 'end',
          ok: false,
          returncode: 1,
          timed_out: false,
          cancelled: false,
          missing: ['OPENAI_API_KEY'],
          duration_ms: null,
          result: { cells: [{ index: 0, status: 'error', stdout: '', error: 'boom', duration_ms: 3 }] },
        },
        'r',
        7,
      ),
    ).toEqual({
      t: 'end',
      runId: 'r',
      seq: 7,
      ok: false,
      returncode: 1,
      timedOut: false,
      cancelled: false,
      missing: ['OPENAI_API_KEY'],
      durationMs: null,
      result: {
        cells: [{ index: 0, status: 'error', stdout: '', error: 'boom', displays: [], durationMs: 3 }],
      },
    })
  })

  it('converts the per-frame error and ignores an unknown frame type', () => {
    expect(mapRunStreamFrame({ t: 'error', status: 400, error: 'bad cell' }, 'r', 8)).toEqual({
      t: 'error',
      runId: 'r',
      seq: 8,
      status: 400,
      error: 'bad cell',
    })
    expect(mapRunStreamFrame({ t: 'future' }, 'r', 9)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Runtime streaming
// ---------------------------------------------------------------------------

/** The frames of a single-cell `/run-stream`. */
const RUN_FRAMES = [
  '{"t":"start","itemId":"probe","index":0,"cells":null,"timeout":90.0}\n',
  '{"t":"stdout","index":null,"data":"one\\n"}\n',
  '{"t":"stderr","index":null,"data":"warn\\n"}\n',
  '{"t":"display","index":null,"mime":"text/plain","data":"d"}\n',
  '{"t":"end","ok":true,"returncode":0,"timed_out":false,"cancelled":false,"missing":[],"duration_ms":42,"result":{"ok":true,"stdout":"one\\n"}}\n',
]

/** A stream that never reaches `end` — used by the abort paths. */
const OPEN_FRAMES = [
  '{"t":"start","itemId":"probe","index":null,"cells":[0],"timeout":150.0}\n',
  ...Array.from({ length: 40 }, (_, index) => `{"t":"stdout","index":0,"data":"${index}\\n"}\n`),
]

describe('CookbooksRuntime.apiRunStream', () => {
  it('answers {runId} before the run ends and pushes every frame in order', async () => {
    const stub = startStub(() => new Response(ndjsonStream(RUN_FRAMES, 20), { headers: NDJSON_HEADERS }))
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      const handle = await runtime.apiRunStream(
        { runId: 'run-1', itemId: 'probe', code: 'print(1)', index: 0 },
        sink.onEvent,
      )
      expect(handle).toEqual({ runId: 'run-1' })
      // F5: the invoke answers while the run is still in flight — no `end` yet.
      expect(sink.events.some((event) => event.t === 'end')).toBe(false)

      await sink.settled
      expect(sink.events.map((event) => event.t)).toEqual(['start', 'stdout', 'stderr', 'display', 'end'])
      expect(sink.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
      expect(sink.events.every((event) => event.runId === 'run-1')).toBe(true)
      expect(sink.events[4]).toMatchObject({
        t: 'end',
        durationMs: 42,
        result: { ok: true, stdout: 'one\n', displays: [] },
      })
      // The one-shot store rides along, exactly like the synchronous routes.
      expect(stub.calls).toEqual([
        {
          path: '/run-stream',
          body: { itemId: 'probe', code: 'print(1)', index: 0, store: {} },
          authorization: `Bearer ${TOKEN}`,
        },
      ])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('omits an absent index from the request body', async () => {
    const stub = startStub(() =>
      new Response(ndjsonStream(['{"t":"end","ok":true}\n'], 0), { headers: NDJSON_HEADERS }),
    )
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      await runtime.apiRunStream({ runId: 'run-2', itemId: 'probe', code: 'x' }, sink.onEvent)
      await sink.settled
      expect(stub.calls[0].body).toEqual({ itemId: 'probe', code: 'x', store: {} })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('rejects with the sidecar 4xx body when the run is refused before the stream starts', async () => {
    const stub = startStub(() => Response.json({ error: 'missing secrets: OPENAI_API_KEY' }, { status: 400 }))
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      const err = await runtime
        .apiRunStream({ runId: 'run-3', itemId: 'mystery', code: 'x' }, sink.onEvent)
        .catch((error: unknown) => error)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(400)
      expect((err as CookbooksApiError).message).toBe('missing secrets: OPENAI_API_KEY')
      expect(sink.events).toEqual([])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('aborts the read on its budget and reports a terminal error frame (status 0)', async () => {
    const stub = startStub(() => new Response(ndjsonStream(OPEN_FRAMES, 20), { headers: NDJSON_HEADERS }))
    const runtime = await runtimeOnPort(stub.port, { runApiTimeoutMs: 80 })
    const sink = collectEvents()
    try {
      await runtime.apiRunStream({ runId: 'run-4', itemId: 'probe', code: 'x' }, sink.onEvent)
      await sink.settled
      const last = sink.events[sink.events.length - 1]
      expect(last).toMatchObject({ t: 'error', runId: 'run-4', status: 0 })
      expect(sink.events.some((event) => event.t === 'end')).toBe(false)
      expect(sink.events.map((event) => event.seq)).toEqual(sink.events.map((_, index) => index))
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('rejects a run whose response headers never arrive within the budget', async () => {
    // A real delay: the case under test is exactly "the sidecar answers late",
    // which cannot be expressed without a slow server.
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch() {
        await Bun.sleep(400)
        return new Response(ndjsonStream(['{"t":"end","ok":true}\n'], 0), { headers: NDJSON_HEADERS })
      },
    })
    const port = server.port
    if (port === undefined) throw new Error('stub sidecar did not bind a port')
    const runtime = await runtimeOnPort(port, { runApiTimeoutMs: 40 })
    const sink = collectEvents()
    try {
      const err = await runtime
        .apiRunStream({ runId: 'run-5', itemId: 'probe', code: 'x' }, sink.onEvent)
        .catch((error: unknown) => error)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(0)
      expect(sink.events).toEqual([])
    } finally {
      await runtime.stop()
      server.stop(true)
    }
  })

  it('reports status 0 without touching the network when the runtime is not running', async () => {
    const runtime = new CookbooksRuntime({ spawn: () => { throw new Error('must not spawn') } })
    const err = await runtime
      .apiRunStream({ runId: 'run-6', itemId: 'probe', code: 'x' }, () => {})
      .catch((error: unknown) => error)
    expect(err).toBeInstanceOf(CookbooksApiError)
    expect((err as CookbooksApiError).status).toBe(0)
    expect((err as CookbooksApiError).message).toBe('runtime not running')
  })
})

describe('CookbooksRuntime.apiRunAllStream', () => {
  const RUN_ALL_FRAMES = [
    '{"t":"start","itemId":"probe","index":null,"cells":[0,1],"timeout":150.0}\n',
    '{"t":"cell-start","index":0}\n',
    '{"t":"stdout","index":0,"data":"a\\n"}\n',
    '{"t":"cell-end","index":0,"status":"ok","ok":true,"timed_out":false,"duration_ms":5,"returncode":0,"error":null,"stdout":"a\\n","stderr":"","displays":[]}\n',
    '{"t":"cell-start","index":1}\n',
    '{"t":"stderr","index":1,"data":"boom\\n"}\n',
    '{"t":"cell-end","index":1,"status":"error","ok":false,"timed_out":false,"duration_ms":6,"returncode":1,"error":"boom","stdout":"","stderr":"boom\\n","displays":[]}\n',
    '{"t":"end","ok":false,"returncode":1,"timed_out":false,"cancelled":false,"missing":[],"duration_ms":11,"result":{"cells":[{"index":0,"status":"ok","stdout":"a\\n","error":null},{"index":1,"status":"error","stdout":"","error":"boom"}]}}\n',
  ]

  it('streams per-cell events and posts the cells with the batch budget', async () => {
    const stub = startStub(() => new Response(ndjsonStream(RUN_ALL_FRAMES, 10), { headers: NDJSON_HEADERS }))
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      const handle = await runtime.apiRunAllStream(
        { runId: 'batch-1', itemId: 'probe', cells: [{ index: 0, source: 'a' }, { index: 1, source: 'b' }] },
        sink.onEvent,
      )
      expect(handle).toEqual({ runId: 'batch-1' })
      await sink.settled

      expect(sink.events.map((event) => event.t)).toEqual([
        'start',
        'cell-start',
        'stdout',
        'cell-end',
        'cell-start',
        'stderr',
        'cell-end',
        'end',
      ])
      expect(sink.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      // The N/M feed: one `cell-end` per cell, each carrying its own duration.
      expect(
        sink.events.filter((event) => event.t === 'cell-end').map((event) => event.durationMs),
      ).toEqual([5, 6])
      expect(sink.events[7]).toMatchObject({
        t: 'end',
        ok: false,
        durationMs: 11,
        result: { cells: [{ index: 0 }, { index: 1, status: 'error', error: 'boom' }] },
      })
      expect(stub.calls[0]).toEqual({
        path: '/run-all-stream',
        body: {
          itemId: 'probe',
          cells: [{ index: 0, source: 'a' }, { index: 1, source: 'b' }],
          store: {},
        },
        authorization: `Bearer ${TOKEN}`,
      })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('aborts an in-flight stream when the runtime stops', async () => {
    const stub = startStub(() => new Response(ndjsonStream(OPEN_FRAMES, 20), { headers: NDJSON_HEADERS }))
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      await runtime.apiRunAllStream(
        { runId: 'batch-2', itemId: 'probe', cells: [{ index: 0, source: 'a' }] },
        sink.onEvent,
      )
      await runtime.stop()
      await sink.settled
      expect(sink.events.some((event) => event.t === 'error')).toBe(true)
      expect(sink.events.some((event) => event.t === 'end')).toBe(false)
    } finally {
      stub.stop()
    }
  })

  it('rejects with the sidecar status when a batch is refused before the stream starts', async () => {
    const stub = startStub(() => Response.json({ error: 'too many cells' }, { status: 400 }))
    const runtime = await runtimeOnPort(stub.port)
    const sink = collectEvents()
    try {
      const err = await runtime
        .apiRunAllStream({ runId: 'batch-3', itemId: 'probe', cells: [] }, sink.onEvent)
        .catch((error: unknown) => error)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(400)
      expect((err as CookbooksApiError).message).toBe('too many cells')
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })
})
