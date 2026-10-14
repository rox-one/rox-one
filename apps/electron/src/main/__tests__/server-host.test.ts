import { describe, expect, it } from 'bun:test'
import {
  ServerSupervisor,
  computeBackoffMs,
  evaluateLoopDelayGate,
  isServerHostEnabled,
  parseReadyLine,
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
  const env: NodeJS.ProcessEnv = {}
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
    expect(isServerHostEnabled({ ROX_SERVER_UTILITY_PROCESS: '1' })).toBe(true)
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
    expect(h.env.CRAFT_RPC_PORT).toBe('41234')
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

  it('gives up after max consecutive crashes and rejects start', async () => {
    let gaveUp = -2
    const h = harness({ backoffBaseMs: 10, maxConsecutiveCrashes: 2, onGiveUp: c => { gaveUp = c } })
    const p = h.sup.start()
    h.children[0].exit(1); h.advance(10)
    h.children[1].exit(1); h.advance(20)
    h.children[2].exit(3)
    await expect(p).rejects.toThrow()
    expect(h.sup.getState()).toBe('failed')
    expect(gaveUp).toBe(3)
  })

  it('kills a child that never becomes ready', () => {
    const h = harness({ readyTimeoutMs: 1000, backoffBaseMs: 10 })
    void h.sup.start().catch(() => {})
    h.advance(1000)
    expect(h.children[0].killed).toBe(true)
    expect(h.sup.getState()).toBe('backoff')
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
