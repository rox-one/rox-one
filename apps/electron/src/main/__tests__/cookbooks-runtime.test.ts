import { describe, expect, it } from 'bun:test'
import {
  CookbooksRuntime,
  buildCookbooksChildEnv,
  computeCookbooksBackoffMs,
  computeCookbooksRunAllTimeoutMs,
  redactCookbooksLogLine,
  type CookbooksChild,
} from '../cookbooks-runtime'
import { CookbooksApiError, parseCookbooksStartupLine } from '../../shared/cookbooks'

const TOKEN = 'A'.repeat(32)
const line = (port: number, token = TOKEN) => `http://127.0.0.1:${port}/lab.html?token=${token}\n`
const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// Fake child (no real process) — mirrors __tests__/server-host.test.ts.
// ---------------------------------------------------------------------------

class FakeChild implements CookbooksChild {
  pid = Math.floor(Math.random() * 1e5)
  autoExitOnKill = true
  private out: Array<(c: string) => void> = []
  private err: Array<(c: string) => void> = []
  private exits: Array<(code: number | null) => void> = []
  signals: Array<string | undefined> = []
  stdout = { on: (_e: 'data', cb: (c: Buffer | string) => void) => { this.out.push(cb) } }
  stderr = { on: (_e: 'data', cb: (c: Buffer | string) => void) => { this.err.push(cb) } }
  on(_e: 'exit', cb: (code: number | null) => void) { this.exits.push(cb) }
  kill(signal?: string) {
    this.signals.push(signal)
    if (this.autoExitOnKill) this.exit(137)
    return true
  }
  emit(s: string) { for (const cb of this.out) cb(s) }
  emitErr(s: string) { for (const cb of this.err) cb(s) }
  exit(code: number | null) { const e = this.exits; this.exits = []; for (const cb of e) cb(code) }
}

function harness(opts: Partial<ConstructorParameters<typeof CookbooksRuntime>[0]> = {}) {
  let t = 0
  let seq = 0
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  const children: FakeChild[] = []
  const logs: string[] = []
  const statuses: string[] = []
  const runtime = new CookbooksRuntime({
    spawn: () => { const c = new FakeChild(); children.push(c); return c },
    resolvePython: async () => '/usr/bin/python3',
    getCookbooksDir: () => '/res/cookbooks',
    getWorkspaceDir: () => '/ws',
    buildEnv: async () => ({ PATH: '/bin' }),
    checkHealth: async () => true,
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ at: t + ms, fn, id }); return id },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1) },
    log: (_level, msg) => { logs.push(msg) },
    onStatusChanged: (s) => { statuses.push(s.state) },
    ...opts,
  })
  const advance = (ms: number) => {
    t += ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const due = timers[0]
      if (!due || due.at > t) break
      timers.shift()
      due.fn()
    }
  }
  return { runtime, children, advance, logs, statuses }
}

// ---------------------------------------------------------------------------
// Discovery-line parser (SPEC §Discovery-строка)
// ---------------------------------------------------------------------------

describe('parseCookbooksStartupLine', () => {
  it('parses a valid discovery line into port/token/url', () => {
    const parsed = parseCookbooksStartupLine(line(52231))
    expect(parsed).toEqual({
      port: 52231,
      token: TOKEN,
      url: `http://127.0.0.1:52231/lab.html?token=${TOKEN}`,
    })
  })

  it('accepts a trailing newline and surrounding whitespace', () => {
    expect(parseCookbooksStartupLine(`  ${line(8080).trim()}  `)?.port).toBe(8080)
  })

  it('returns the first match when the buffer holds several lines', () => {
    const buffer = `noise\n${line(1111)}${line(2222)}`
    expect(parseCookbooksStartupLine(buffer)?.port).toBe(1111)
  })

  it('rejects garbage, empty and non-string input', () => {
    expect(parseCookbooksStartupLine('')).toBeNull()
    expect(parseCookbooksStartupLine('http://127.0.0.1:1/lab.html')).toBeNull()
    expect(parseCookbooksStartupLine('listening on port 3000')).toBeNull()
    // Never partial-match an embedded URL inside prose.
    expect(parseCookbooksStartupLine(`see ${line(3000).trim()} for details`)).toBeNull()
  })

  it('rejects foreign hosts and non-http schemes', () => {
    expect(parseCookbooksStartupLine(`http://localhost:3000/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://0.0.0.0:3000/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://[::1]:3000/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`https://127.0.0.1:3000/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.2:3000/lab.html?token=${TOKEN}`)).toBeNull()
  })

  it('rejects out-of-range ports', () => {
    expect(parseCookbooksStartupLine(`http://127.0.0.1:0/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.1:70000/lab.html?token=${TOKEN}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.1:/lab.html?token=${TOKEN}`)).toBeNull()
  })

  it('enforces the base64url token charset and minimum length', () => {
    expect(parseCookbooksStartupLine(`http://127.0.0.1:3000/lab.html?token=short`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.1:3000/lab.html?token=${'a'.repeat(23)}`)).toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.1:3000/lab.html?token=${'a'.repeat(24)}`)).not.toBeNull()
    expect(parseCookbooksStartupLine(`http://127.0.0.1:3000/lab.html?token=${'a'.repeat(20)}!`)).toBeNull()
    // base64url alphabet is accepted verbatim.
    expect(parseCookbooksStartupLine(`http://127.0.0.1:3000/lab.html?token=${'aA0_-'.repeat(6)}`)?.token)
      .toBe('aA0_-'.repeat(6))
  })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('computeCookbooksBackoffMs', () => {
  it('doubles from the base and caps at max', () => {
    expect([1, 2, 3, 4, 5].map((n) => computeCookbooksBackoffMs(n, 500, 30_000)))
      .toEqual([500, 1000, 2000, 4000, 8000])
    expect(computeCookbooksBackoffMs(7, 500, 30_000)).toBe(30_000)
    expect(computeCookbooksBackoffMs(0, 500, 30_000)).toBe(0)
  })
})

describe('computeCookbooksRunAllTimeoutMs', () => {
  it('reserves one cell timeout per cell plus overhead', () => {
    expect(computeCookbooksRunAllTimeoutMs(1)).toBe(90_000)
    expect(computeCookbooksRunAllTimeoutMs(3)).toBe(210_000)
    expect(computeCookbooksRunAllTimeoutMs(13)).toBe(810_000)
  })

  it('caps the total and never returns a sub-cell budget', () => {
    expect(computeCookbooksRunAllTimeoutMs(200)).toBe(15 * 60_000)
    expect(computeCookbooksRunAllTimeoutMs(0)).toBe(90_000)
  })

  it('gives a multi-cell run-all a larger budget than a single run', () => {
    expect(computeCookbooksRunAllTimeoutMs(3)).toBeGreaterThan(90_000)
  })
})

describe('redactCookbooksLogLine', () => {
  it('masks token values in any text destined for logs', () => {
    expect(redactCookbooksLogLine(`open ${line(3000).trim()}`)).toBe(
      'open http://127.0.0.1:3000/lab.html?token=***',
    )
    expect(redactCookbooksLogLine('token=abc123&x=1')).not.toContain('abc123')
    expect(redactCookbooksLogLine('nothing to hide')).toBe('nothing to hide')
  })
})

describe('buildCookbooksChildEnv', () => {
  it('keeps only the allowlisted keys and drops secrets', () => {
    const env = buildCookbooksChildEnv({
      PATH: '/bin',
      HOME: '/h',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      ROX_SECRET_KEY: 'leak',
      ROX_SERVER_TOKEN: 'leak',
      OPENAI_API_KEY: 'leak',
      ANTHROPIC_API_KEY: 'leak',
      UV_PYTHON: '/uv/python',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', TMPDIR: '/tmp', LANG: 'en_US.UTF-8', LC_ALL: 'C' })
  })
})

// ---------------------------------------------------------------------------
// Runtime state machine (fake spawn)
// ---------------------------------------------------------------------------

describe('CookbooksRuntime', () => {
  it('starts idle and exposes a token-free status', () => {
    const h = harness()
    const status = h.runtime.getStatus()
    expect(status).toEqual({ state: 'idle', reason: null, port: null })
    expect(JSON.stringify(status)).not.toContain('token')
  })

  it('spawns, parses the ready line and reports running with the port', async () => {
    const h = harness()
    const p = h.runtime.ensure()
    expect(h.runtime.getStatus().state).toBe('starting')
    await tick()
    h.children[0].emit(line(41234))
    const status = await p
    expect(status).toEqual({ state: 'running', reason: null, port: 41234 })
    // never leaks the token or the full url through the renderer contract
    expect(JSON.stringify(status)).not.toContain('token')
    expect(JSON.stringify(status)).not.toContain('lab.html')
    expect(h.statuses).toContain('starting')
    expect(h.statuses).toContain('running')
    expect(h.runtime.getStartup()?.token).toBe(TOKEN)
  })

  it('passes the frozen argv and cwd to the spawner', async () => {
    let seen: { cmd: string; args: string[]; cwd: string } | null = null
    const h = harness({
      spawn: (cmd, args, options) => {
        seen = { cmd, args, cwd: options.cwd }
        const c = new FakeChild()
        h.children.push(c)
        return c
      },
    })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    expect(seen!.cmd).toBe('/usr/bin/python3')
    expect(seen!.args).toEqual([
      '-u',
      '/res/cookbooks/scripts/serve_lab.py',
      '--workspace',
      '/ws/cookbooks/workspace',
    ])
    expect(seen!.cwd).toBe('/res/cookbooks')
  })

  it('never spawns when no interpreter is found', async () => {
    const h = harness({ resolvePython: async () => null })
    const status = await h.runtime.ensure()
    expect(status).toEqual({ state: 'failed', reason: 'python-missing', port: null })
    expect(h.children.length).toBe(0)
  })

  it('fails with ready-timeout after exhausting pre-ready attempts', async () => {
    const h = harness({ preReadyMaxAttempts: 2, preReadyTimeoutMs: 1000, backoffBaseMs: 500 })
    const p = h.runtime.ensure()
    await tick()
    // attempt 1: timeout kills the child → backoff restart
    h.advance(1000)
    expect(h.runtime.getStatus().state).toBe('starting')
    h.advance(500)
    expect(h.children.length).toBe(2)
    h.advance(1000)
    const status = await p
    expect(status).toEqual({ state: 'failed', reason: 'ready-timeout', port: null })
    h.advance(60_000)
    expect(h.children.length).toBe(2)
  })

  it('fails with spawn-failed when the process dies pre-ready twice', async () => {
    const h = harness({ preReadyMaxAttempts: 2, backoffBaseMs: 500 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].exit(1)
    h.advance(500)
    expect(h.children.length).toBe(2)
    h.children[1].exit(1)
    const status = await p
    expect(status).toEqual({ state: 'failed', reason: 'spawn-failed', port: null })
  })

  it('counts a throwing spawn as a failed attempt', async () => {
    let n = 0
    const h = harness({
      preReadyMaxAttempts: 2,
      backoffBaseMs: 500,
      spawn: () => { n++; throw new Error('boom') },
    })
    const p = h.runtime.ensure()
    await tick()
    h.advance(500)
    expect(n).toBe(2)
    const status = await p
    expect(status).toEqual({ state: 'failed', reason: 'spawn-failed', port: null })
  })

  it('restarts with backoff after a post-ready crash and resets on stability', async () => {
    const h = harness({ backoffBaseMs: 100, stableAfterMs: 1000, maxCrashes: 5 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    h.children[0].exit(1)
    expect(h.runtime.getStatus().state).toBe('starting')
    h.advance(99)
    expect(h.children.length).toBe(1)
    h.advance(1)
    expect(h.children.length).toBe(2)
    h.children[1].emit(line(2))
    await tick()
    expect(h.runtime.getStatus().state).toBe('running')
    // a stable run resets the crash counter
    h.advance(5000)
    h.children[1].exit(1)
    expect(h.runtime.getCrashCount()).toBe(1)
  })

  it('gives up with failed(crashed) after more than maxCrashes falls', async () => {
    const h = harness({ backoffBaseMs: 1, maxCrashes: 2, readyTimeoutMs: 60_000 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    // three consecutive falls after readiness; the third exceeds maxCrashes=2
    for (let run = 0; run < 3; run++) {
      h.children[h.children.length - 1].exit(1)
      await tick()
      h.advance(1000) // fire the backoff restart timer
      await tick()
    }
    expect(h.runtime.getStatus()).toEqual({ state: 'failed', reason: 'crashed', port: null })
  })

  it('restart() recovers from failed (spawn-failed)', async () => {
    const h = harness({ preReadyMaxAttempts: 1 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].exit(1)
    expect(await p).toEqual({ state: 'failed', reason: 'spawn-failed', port: null })
    const rp = h.runtime.restart()
    await tick()
    expect(h.children.length).toBe(2)
    h.children[1].emit(line(9))
    expect((await rp).state).toBe('running')
  })

  it('restart() re-resolves python after python-missing', async () => {
    let attempts = 0
    const h = harness({ resolvePython: async () => (++attempts === 1 ? null : '/usr/bin/python3') })
    expect((await h.runtime.ensure()).state).toBe('failed')
    expect(h.runtime.getStatus().reason).toBe('python-missing')
    const rp = h.runtime.restart()
    await tick()
    h.children[0].emit(line(7))
    expect((await rp).state).toBe('running')
  })

  it('ensure() is idempotent while running', async () => {
    const h = harness()
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    const again = await h.runtime.ensure()
    expect(again.state).toBe('running')
    expect(h.children.length).toBe(1)
  })

  it('stop() sends SIGINT, kills after grace and is idempotent', async () => {
    const h = harness({ shutdownGraceMs: 500 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].autoExitOnKill = false
    h.children[0].emit(line(1))
    await p
    const stopped = h.runtime.stop()
    expect(h.runtime.getStatus().state).toBe('stopping')
    expect(h.children[0].signals).toEqual(['SIGINT'])
    h.advance(500)
    expect(h.children[0].signals).toEqual(['SIGINT', 'SIGKILL'])
    h.children[0].exit(0)
    await stopped
    expect(h.runtime.getStatus().state).toBe('stopped')
    await h.runtime.stop() // idempotent
    expect(h.runtime.getStatus().state).toBe('stopped')
  })

  it('stop() during a pending start resolves the ensure promise', async () => {
    const h = harness()
    const p = h.runtime.ensure()
    await tick()
    h.children[0].autoExitOnKill = false
    const stopped = h.runtime.stop()
    expect(h.runtime.getStatus().state).toBe('stopping')
    h.children[0].exit(0)
    await stopped
    expect((await p).state).toBe('stopped')
    expect(h.runtime.getStatus().state).toBe('stopped')
  })

  it('stop() during backoff cancels the pending restart', async () => {
    const h = harness({ backoffBaseMs: 1000 })
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    h.children[0].exit(1)
    await h.runtime.stop()
    h.advance(60_000)
    expect(h.children.length).toBe(1)
    expect(h.runtime.getStatus().state).toBe('stopped')
  })

  it('redacts token= from every stderr line it buffers and logs', async () => {
    const h = harness()
    const p = h.runtime.ensure()
    await tick()
    h.children[0].emit(line(1))
    await p
    h.children[0].emitErr(`serving http://127.0.0.1:1/lab.html?token=${TOKEN}\n`)
    expect(h.logs.join('\n')).not.toContain(TOKEN)
    expect(h.logs.join('\n')).toContain('token=***')
  })
})

// ---------------------------------------------------------------------------
// Data plane (SPEC §Amendment 1)
//
// Main is the sidecar's ONLY HTTP client: a real loopback `Bun.serve` stands in
// for the lab's JSON surface, and the runtime is driven to `running` with the
// stub's OS-assigned port in its ready line.
// ---------------------------------------------------------------------------

/** Raw sidecar payloads — deliberately wider than the DTO (extra fields, snake_case). */
const CATALOG_CARD_RAW = {
  id: 'openai-embeddings-intro',
  title: 'OpenAI embeddings intro',
  vendor: 'openai',
  topics: ['embeddings'],
  tags: ['beginner'],
  kind: 'ipynb',
  secretsHave: ['openai.api_key'],
  secretsMissing: ['pinecone.api_key'],
  disabled: false,
  disabledReason: null,
}

const DOCUMENT_RAW = {
  kind: 'ipynb',
  title: 'Probe notebook',
  cells: [
    {
      cell_type: 'code',
      source: ['print(1)\n', 'print(2)'],
      outputs: [{ text: ['a', 'b'] }, { traceback: ['Traceback\n', 'Error: boom'] }],
    },
    { cell_type: 'markdown', source: '# Heading', outputs: [] },
  ],
  missing: ['pinecone.api_key'],
  supported: true,
}

const RUN_RAW = {
  ok: true,
  stdout: 'hello\n',
  stderr: 'not part of the contract',
  returncode: 0,
  timed_out: false,
  missing: ['pinecone.api_key'],
}

const RUN_ALL_RAW = {
  ok: true,
  timed_out: false,
  returncode: 0,
  missing: [],
  cells: [
    { index: 0, status: 'ok', ok: true, stdout: 'first\n', stderr: '', error: null, timed_out: false, duration_ms: 3 },
    { index: 2, status: 'skipped', ok: false, stdout: null, stderr: null, error: null, timed_out: false, duration_ms: null },
  ],
}

function startStub() {
  const requests: Array<{ path: string; authorization: string | null }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({ path: url.pathname, authorization: request.headers.get('authorization') })
      if (request.headers.get('authorization') !== `Bearer ${TOKEN}`) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      switch (url.pathname) {
        case '/catalog':
          return Response.json([CATALOG_CARD_RAW])
        case '/document/probe-item':
          return Response.json(DOCUMENT_RAW)
        // 400 with no `error` field — the client must fall back to the status text.
        case '/document/no-error':
          return new Response(null, { status: 400 })
        // 200 that is not JSON at all — a broken sidecar, not a request error.
        case '/document/not-json':
          return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
        case '/open':
          return Response.json({ copyId: 'copy-1', document: '/ws/cookbooks/copy-1/probe.ipynb' })
        case '/run': {
          const body = (await request.json()) as { itemId?: string }
          // A sidecar replaced under an open document answers with a stale token.
          if (body.itemId === 'expired') return Response.json({ error: 'unauthorized' }, { status: 401 })
          if (body.itemId === 'unsupported') {
            return Response.json({ error: 'no kernel for this item' }, { status: 400 })
          }
          return Response.json(RUN_RAW)
        }
        case '/run-all':
          return Response.json(RUN_ALL_RAW)
        case '/save':
        case '/reset':
          return Response.json({ ok: true })
        default:
          return Response.json({ error: 'not found' }, { status: 404 })
      }
    },
  })
  const port = server.port
  if (port === undefined) throw new Error('stub sidecar did not bind a port')
  return { port, requests, stop: () => server.stop(true) }
}

/** Drive a runtime to `running` against `port` through the injected fake spawn. */
async function runtimeOnPort(
  port: number,
  options: Partial<ConstructorParameters<typeof CookbooksRuntime>[0]> = {},
): Promise<CookbooksRuntime> {
  const children: FakeChild[] = []
  const runtime = new CookbooksRuntime({
    spawn: () => { const child = new FakeChild(); children.push(child); return child },
    resolvePython: async () => '/usr/bin/python3',
    getCookbooksDir: () => '/res/cookbooks',
    getWorkspaceDir: () => '/ws',
    buildEnv: async () => ({ PATH: '/bin' }),
    checkHealth: async () => true,
    ...options,
  })
  const ready = runtime.ensure()
  await tick()
  children[0].emit(line(port))
  await ready
  return runtime
}

/** A sidecar that accepts the connection and never answers. */
function startHangingStub() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  })
  const port = server.port
  if (port === undefined) throw new Error('hanging stub did not bind a port')
  return { port, stop: () => server.stop(true) }
}

describe('CookbooksRuntime data plane', () => {
  it('apiCatalog maps the cards to the DTO and authenticates with the bearer token', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiCatalog()).toEqual([
        {
          id: 'openai-embeddings-intro',
          title: 'OpenAI embeddings intro',
          vendor: 'openai',
          kind: 'ipynb',
          secretsHave: ['openai.api_key'],
          secretsMissing: ['pinecone.api_key'],
          disabled: false,
          disabledReason: null,
        },
      ])
      // `topics`/`tags` are sidecar-internal and never reach the contract.
      expect(stub.requests).toEqual([{ path: '/catalog', authorization: `Bearer ${TOKEN}` }])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('apiDocument maps snake_case cells/outputs and injects the itemId', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiDocument('probe-item')).toEqual({
        itemId: 'probe-item',
        kind: 'ipynb',
        title: 'Probe notebook',
        supported: true,
        missing: ['pinecone.api_key'],
        cells: [
          {
            cellType: 'code',
            source: 'print(1)\nprint(2)',
            outputs: [
              { text: 'ab', traceback: null },
              { text: '', traceback: 'Traceback\nError: boom' },
            ],
          },
          { cellType: 'markdown', source: '# Heading', outputs: [] },
        ],
        text: null,
      })
      expect(stub.requests[0].path).toBe('/document/probe-item')
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('apiOpen returns the copyId with the document read back from /document', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      const opened = await runtime.apiOpen('probe-item')
      expect(opened.copyId).toBe('copy-1')
      expect(opened.document.itemId).toBe('probe-item')
      expect(opened.document.cells).toHaveLength(2)
      expect(stub.requests.map((r) => r.path)).toEqual(['/open', '/document/probe-item'])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('apiRun maps the run result and drops the fields outside the contract', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiRun('probe-item', 'print(1)', 0)).toEqual({
        ok: true,
        stdout: 'hello\n',
        error: null,
        timedOut: false,
        missing: ['pinecone.api_key'],
      })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('apiRunAll maps one record per cell, normalising missing text and status', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      expect(await runtime.apiRunAll('probe-item', [{ index: 0, source: 'print(1)' }])).toEqual({
        cells: [
          { index: 0, status: 'ok', stdout: 'first\n', error: null },
          { index: 2, status: 'skipped', stdout: '', error: null },
        ],
      })
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('apiSave and apiReset resolve on the sidecar acknowledgement', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      await runtime.apiSave({ itemId: 'probe-item', index: 0, source: 'print(1)' })
      await runtime.apiReset('probe-item')
      expect(stub.requests.map((r) => r.path)).toEqual(['/save', '/reset'])
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('surfaces the sidecar status and its own error text as CookbooksApiError', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      const unauthorized = await runtime.apiRun('expired', 'print(1)', 0).catch((err: unknown) => err)
      expect(unauthorized).toBeInstanceOf(CookbooksApiError)
      expect((unauthorized as CookbooksApiError).status).toBe(401)
      expect((unauthorized as CookbooksApiError).message).toBe('unauthorized')

      const badRequest = await runtime.apiRun('unsupported', 'print(1)', 0).catch((err: unknown) => err)
      expect(badRequest).toBeInstanceOf(CookbooksApiError)
      expect((badRequest as CookbooksApiError).status).toBe(400)
      expect((badRequest as CookbooksApiError).message).toBe('no kernel for this item')
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('falls back to the HTTP status text when the sidecar sends no error field', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      const err = await runtime.apiDocument('no-error').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(400)
      expect((err as CookbooksApiError).message.length).toBeGreaterThan(0)
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('reports status 0 for a 200 that is not JSON', async () => {
    const stub = startStub()
    const runtime = await runtimeOnPort(stub.port)
    try {
      const err = await runtime.apiDocument('not-json').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(0)
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('reports status 0 without touching the network when the runtime is not running', async () => {
    const runtime = new CookbooksRuntime({
      spawn: () => { throw new Error('must not spawn') },
      resolvePython: async () => null,
    })
    const err = await runtime.apiCatalog().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CookbooksApiError)
    expect((err as CookbooksApiError).status).toBe(0)
    expect((err as CookbooksApiError).message).toBe('runtime not running')
    expect(runtime.getStatus().state).toBe('idle')
  })

  it('reports status 0 when nothing is listening on the recorded port', async () => {
    const stub = startStub()
    const port = stub.port
    stub.stop()
    const runtime = await runtimeOnPort(port)
    try {
      const err = await runtime.apiCatalog().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(0)
    } finally {
      await runtime.stop()
    }
  })

  it('aborts a hung request on the injected budget instead of waiting for the transport default', async () => {
    const stub = startHangingStub()
    const runtime = await runtimeOnPort(stub.port, { apiRequestTimeoutMs: 100 })
    try {
      const started = Date.now()
      const err = await runtime.apiCatalog().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(0)
      expect((err as CookbooksApiError).message).toBe('timeout')
      // The budget is the caller's, not undici's ~300s default.
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('applies the run-all budget to the run-all request', async () => {
    const stub = startHangingStub()
    const runtime = await runtimeOnPort(stub.port, { runAllTimeoutMs: () => 60 })
    try {
      const err = await runtime
        .apiRunAll('probe-item', [
          { index: 0, source: 'a' },
          { index: 1, source: 'b' },
        ])
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CookbooksApiError)
      expect((err as CookbooksApiError).status).toBe(0)
      expect((err as CookbooksApiError).message).toBe('timeout')
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })

  it('derives the run-all budget from the submitted cell count', async () => {
    const stub = startStub()
    const budgets: number[] = []
    const runtime = await runtimeOnPort(stub.port, {
      runApiTimeoutMs: 90_000,
      runAllTimeoutMs: (cellCount) => {
        budgets.push(cellCount)
        return computeCookbooksRunAllTimeoutMs(cellCount)
      },
    })
    try {
      await runtime.apiRunAll('probe-item', [
        { index: 0, source: 'a' },
        { index: 1, source: 'b' },
        { index: 2, source: 'c' },
      ])
      expect(budgets).toEqual([3])
      expect(computeCookbooksRunAllTimeoutMs(3)).toBeGreaterThan(90_000)
    } finally {
      await runtime.stop()
      stub.stop()
    }
  })
})
