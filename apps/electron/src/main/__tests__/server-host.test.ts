import { describe, expect, it } from 'bun:test'
import {
  ServerSupervisor,
  computeBackoffMs,
  evaluateLoopDelayGate,
  isServerHostEnabled,
  parseReadyLine,
  buildChildEnv,
  SERVER_HOST_DISABLE_ARG,
  type ServerHostChild,
} from '../server-host'

class FakeChild implements ServerHostChild {
  pid = Math.floor(Math.random() * 1e5)
  private out: Array<(c: string) => void> = []
  private exits: Array<(c: number) => void> = []
  messages: unknown[] = []
  killed = false
  stdout = { on: (_e: 'data', cb: (c: Buffer | string) => void) => { this.out.push(cb as (c: string) => void) } }
  stderr = { on: () => {} }
  on(_e: 'exit', cb: (code: number) => void) { this.exits.push(cb) }
  postMessage(m: unknown) { this.messages.push(m) }
  kill() { this.killed = true; this.exit(137); return true }
  emit(s: string) { for (const cb of this.out) cb(s) }
  exit(code: number) { const e = this.exits; this.exits = []; for (const cb of e) cb(code) }
}

function harness(opts: Partial<ConstructorParameters<typeof ServerSupervisor>[0]> = {}) {
  let t = 0
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let seq = 0
  const children: FakeChild[] = []
  const env: NodeJS.ProcessEnv = { PATH: '/bin', ROX_SERVER_UTILITY_PROCESS: '1', CRAFT_SERVER_TOKEN: 'leak', SECRET_THING: 'x' }
  const sup = new ServerSupervisor({
    fork: (_p, _a, o) => { const c = new FakeChild(); (c as FakeChild & { env?: unknown }).env = o.env; children.push(c); return c },
    workerPath: '/w.cjs',
    env,
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ at: t + ms, fn, id }); return id },
    clearTimer: (h) => { const i = timers.findIndex(x => x.id === h); if (i >= 0) timers.splice(i, 1) },
    ...opts,
  })
  const advance = (ms: number) => {
    t += ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const due = timers[0]
      if (!due || due.at > t) break
      timers.shift(); due.fn()
    }
  }
  return { sup, children, advance, env }
}

describe('server-host flag', () => {
  it('is off by default and when already a thin client', () => {
    expect(isServerHostEnabled({})).toBe(false)
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '0' })).toBe(false)
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '1', CRAFT_SERVER_URL: 'ws://x' })).toBe(false)
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '1', CRAFT_HEADLESS: '1' })).toBe(false)
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '1' }, [])).toBe(true)
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '1' }, ['x', SERVER_HOST_DISABLE_ARG])).toBe(false)
  })
})

describe('helpers', () => {
  it('backoff doubles and caps', () => {
    expect([1, 2, 3, 4].map(n => computeBackoffMs(n, 500, 3000))).toEqual([500, 1000, 2000, 3000])
    expect(computeBackoffMs(0)).toBe(0)
  })
  it('parses readiness lines', () => {
    expect(parseReadyLine('noise\nCRAFT_SERVER_URL=ws://127.0.0.1:5000\nROX_SERVER_TOKEN=ab…cd\n'))
      .toEqual({ url: 'ws://127.0.0.1:5000', token: 'ab…cd' })
  })
  it('child env is allowlisted and never carries tokens', () => {
    const out = buildChildEnv({
      PATH: '/bin', HOME: '/h', LC_ALL: 'C', CRAFT_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k',
      CRAFT_SERVER_TOKEN: 't', ROX_SERVER_TOKEN: 't', CRAFT_SERVER_URL: 'u', ROX_SERVER_UTILITY_PROCESS: '1',
      AWS_SECRET_ACCESS_KEY: 's', GITHUB_TOKEN: 'g',
    })
    expect(out).toEqual({ PATH: '/bin', HOME: '/h', LC_ALL: 'C', CRAFT_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k' })
  })
  it('loop-delay gate', () => {
    expect(evaluateLoopDelayGate(null, 50).status).toBe('no-data')
    expect(evaluateLoopDelayGate({ p99: 20 }, 50).status).toBe('pass')
    expect(evaluateLoopDelayGate({ p99: 80 }, 50).status).toBe('fail')
  })
})

describe('ServerSupervisor', () => {
  it('resolves on readiness with a stable token and pins the port', async () => {
    const h = harness()
    const p = h.sup.start()
    h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:41234\n')
    const r = await p
    expect(r.url).toBe('ws://127.0.0.1:41234')
    expect(r.token.length).toBeGreaterThan(16)
    expect(h.env.CRAFT_RPC_PORT).toBeUndefined()
    expect(h.env.CRAFT_SERVER_URL).toBeUndefined()
    const childEnv = (h.children[0] as FakeChild & { env: NodeJS.ProcessEnv }).env
    expect(childEnv.ROX_SERVER_TOKEN).toBe(r.token)
    expect(childEnv.CRAFT_SERVER_TOKEN).toBeUndefined()
    expect(childEnv.SECRET_THING).toBeUndefined()
    expect(childEnv.CRAFT_RPC_PORT).toBe('0')
    expect(h.sup.getState()).toBe('running')
  })

  it('restarts with backoff, reusing token and port', async () => {
    const tokens: string[] = []
    const h = harness({ backoffBaseMs: 100, onReady: r => tokens.push(r.token) })
    const p = h.sup.start()
    h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:41234\n')
    await p
    h.children[0].exit(1)
    expect(h.sup.getState()).toBe('backoff')
    h.advance(99); expect(h.children.length).toBe(1)
    h.advance(1); expect(h.children.length).toBe(2)
    const env2 = (h.children[1] as FakeChild & { env: NodeJS.ProcessEnv }).env
    expect(env2.CRAFT_RPC_PORT).toBe('41234')
    expect(h.env.CRAFT_RPC_PORT).toBeUndefined()
    expect(env2.ROX_SERVER_UTILITY_PROCESS).toBeUndefined()
    h.children[1].emit('CRAFT_SERVER_URL=ws://127.0.0.1:41234\n')
    expect(tokens.length).toBe(2)
    expect(tokens[0]).toBe(tokens[1])
    // second crash soon after → doubled backoff
    h.children[1].exit(1)
    h.advance(199); expect(h.children.length).toBe(2)
    h.advance(1); expect(h.children.length).toBe(3)
  })

  it('resets crash count after a stable run', async () => {
    const h = harness({ backoffBaseMs: 100, stableAfterMs: 1000 })
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    h.children[0].exit(1); h.advance(100)
    h.children[1].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n')
    h.advance(5000)
    h.children[1].exit(1)
    expect(h.sup.getCrashCount()).toBe(1)
  })

  it('after first ready: gives up after max consecutive crashes', async () => {
    let gaveUp = -2
    const h = harness({ backoffBaseMs: 10, maxConsecutiveCrashes: 2, onGiveUp: c => { gaveUp = c } })
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    h.children[0].exit(1); h.advance(10)
    h.children[1].exit(1); h.advance(20)
    h.children[2].exit(3)
    expect(h.sup.getState()).toBe('failed')
    expect(gaveUp).toBe(3)
  })

  it('fork that always throws: fails fast before ready (1 retry)', async () => {
    let forks = 0
    const h = harness({ fork: () => { forks++; throw new Error('boom') }, backoffBaseMs: 10 })
    const p = h.sup.start()
    h.advance(10)
    await expect(p).rejects.toThrow()
    expect(forks).toBe(2)
    expect(h.sup.getState()).toBe('failed')
    h.advance(60_000)
    expect(forks).toBe(2)
  })

  it('fork throws after first ready: counted, give-up guaranteed', async () => {
    let n = 0
    let gaveUp = false
    const kids: FakeChild[] = []
    const h = harness({
      backoffBaseMs: 10, maxConsecutiveCrashes: 3, stableAfterMs: 1,
      onGiveUp: () => { gaveUp = true },
      fork: () => { n++; if (n > 1) throw new Error('boom'); const c = new FakeChild(); kids.push(c); return c },
    })
    const p = h.sup.start(); kids[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    h.advance(1000)
    kids[0].exit(1)
    for (let i = 0; i < 10 && !gaveUp; i++) h.advance(1000)
    expect(gaveUp).toBe(true)
    expect(n).toBe(4)
  })

  it('never-ready child: 10s timeout, one retry, then rejects', async () => {
    const h = harness({ backoffBaseMs: 10, killHardTimeoutMs: 100 })
    const p = h.sup.start()
    p.catch(() => {})
    h.advance(10_000)
    expect(h.children[0].killed).toBe(true)
    h.advance(10)
    expect(h.children.length).toBe(2)
    h.advance(10_000)
    await expect(p).rejects.toThrow()
    expect(h.sup.getState()).toBe('failed')
  })

  it('kill without exit event: hard timeout synthesizes exit', async () => {
    const h = harness({ backoffBaseMs: 10, killHardTimeoutMs: 100, preReadyMaxAttempts: 1 })
    const p = h.sup.start(); p.catch(() => {})
    h.children[0].kill = () => true // swallow: no exit event
    h.advance(10_000)
    h.advance(100)
    await expect(p).rejects.toThrow()
  })

  it('clean shutdown: asks child, does not restart', async () => {
    const h = harness()
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    const stopped = h.sup.stop()
    expect(h.children[0].messages).toEqual([{ type: 'shutdown' }])
    h.children[0].exit(0)
    await stopped
    expect(h.sup.getState()).toBe('stopped')
    h.advance(60_000)
    expect(h.children.length).toBe(1)
  })

  it('stop during start rejects with stopped error, no fallback', async () => {
    const h = harness()
    const p = h.sup.start()
    const stopped = h.sup.stop()
    await expect(p).rejects.toThrow('stopped')
    h.children[0].exit(0)
    await stopped
    expect(h.sup.getState()).toBe('stopped')
  })

  it('shutdown kill with no exit event still resolves (hard timeout)', async () => {
    const h = harness({ shutdownGraceMs: 500, killHardTimeoutMs: 200 })
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    h.children[0].kill = () => true
    const stopped = h.sup.stop()
    h.advance(500); h.advance(200)
    await stopped
    expect(h.sup.getState()).toBe('stopped')
  })

  it('shutdown kills after grace if child ignores it', async () => {
    const h = harness({ shutdownGraceMs: 500 })
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    const stopped = h.sup.stop()
    h.advance(500)
    await stopped
    expect(h.children[0].killed).toBe(true)
  })

  it('stop during backoff cancels the restart', async () => {
    const h = harness({ backoffBaseMs: 100 })
    const p = h.sup.start(); h.children[0].emit('CRAFT_SERVER_URL=ws://127.0.0.1:1\n'); await p
    h.children[0].exit(1)
    await h.sup.stop()
    h.advance(1000)
    expect(h.children.length).toBe(1)
    expect(h.sup.getState()).toBe('stopped')
  })
})
