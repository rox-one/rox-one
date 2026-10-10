/**
 * PERF-10 (#1577): the idle warm-up queue — order, slices, input preemption,
 * the CPU budget, failure containment and the low-power trim.
 */
import { describe, expect, it } from 'bun:test'
import {
  WARMUP_CPU_BUDGET_MS,
  WARMUP_LOW_POWER_STEPS,
  WARMUP_SLICE_MS,
  WarmupScheduler,
  buildWarmupSteps,
  detectLowMemory,
  warmupStepBudget,
  type IdleDeadlineLike,
  type InputTargetLike,
  type WarmupStep,
} from '../warmup'
import type { RoutePageName } from '@/components/app-shell/route-pages'

/** Idle host that runs callbacks only when the test asks it to. */
function idleHost() {
  const pending = new Map<number, (deadline: IdleDeadlineLike) => void>()
  let nextHandle = 1
  const runAll = () => {
    let guard = 0
    while (pending.size > 0 && guard < 1000) {
      guard += 1
      const [handle, callback] = pending.entries().next().value as [number, (deadline: IdleDeadlineLike) => void]
      pending.delete(handle)
      callback({ didTimeout: false, timeRemaining: () => WARMUP_SLICE_MS })
    }
  }
  return {
    requestIdle: (callback: (deadline: IdleDeadlineLike) => void) => {
      const handle = nextHandle++
      pending.set(handle, callback)
      return handle
    },
    cancelIdle: (handle: number) => { pending.delete(handle) },
    pending: () => pending.size,
    runAll,
  }
}

function inputTarget() {
  const listeners = new Map<string, () => void>()
  const target: InputTargetLike = {
    addEventListener: (type, listener) => { listeners.set(type, listener) },
    removeEventListener: (type) => { listeners.delete(type) },
  }
  return {
    target,
    fire: (type: string) => { listeners.get(type)?.() },
    attached: () => listeners.size,
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('WarmupScheduler', () => {
  it('runs the steps in order during idle time', async () => {
    const idle = idleHost()
    const ran: string[] = []
    const ids = ['sessions-meta', 'transcript-tails', 'notes-tasks'] as const
    const steps: WarmupStep[] = ids.map(id => ({ id, run: () => { ran.push(id) } }))
    const scheduler = new WarmupScheduler(steps, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null })
    scheduler.start()
    expect(ran).toEqual([])
    idle.runAll()
    expect(ran).toEqual([...ids])
    expect((await scheduler.whenFinished()).completed).toEqual([...ids])
  })

  it('yields between asynchronous steps instead of blocking the slice', async () => {
    const idle = idleHost()
    const ran: string[] = []
    const gate: { release?: () => void } = {}
    const steps: WarmupStep[] = [
      { id: 'sessions-meta', run: () => { ran.push('meta') } },
      { id: 'transcript-tails', run: () => new Promise<void>(resolve => { ran.push('tail'); gate.release = resolve }) },
      { id: 'notes-tasks', run: () => { ran.push('notes') } },
    ]
    const scheduler = new WarmupScheduler(steps, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null })
    scheduler.start()
    idle.runAll()
    expect(ran).toEqual(['meta', 'tail'])
    expect(idle.pending()).toBe(0)

    gate.release?.()
    await flush()
    expect(idle.pending()).toBe(1)
    idle.runAll()
    expect(ran).toEqual(['meta', 'tail', 'notes'])
  })

  it('preempts the remaining queue on user input', async () => {
    const idle = idleHost()
    const input = inputTarget()
    const ran: string[] = []
    const ids = ['sessions-meta', 'transcript-tails', 'notes-tasks'] as const
    const steps: WarmupStep[] = ids.map(id => ({ id, run: () => { ran.push(id) } }))
    const scheduler = new WarmupScheduler(steps, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: input.target })
    scheduler.start()
    expect(input.attached()).toBe(3)
    idle.runAll()
    expect(ran).toEqual([...ids])

    const second = new WarmupScheduler(steps, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: input.target })
    second.start()
    input.fire('keydown')
    idle.runAll()
    expect(second.status().cancelledBy).toBe('input')
    expect(second.status().pending).toEqual([...ids])
    expect(input.attached()).toBe(0)
  })

  it('stops when the CPU budget is spent and keeps a failing step from killing the queue', async () => {
    let clock = 0
    const idle = idleHost()
    const ran: string[] = []
    const steps: WarmupStep[] = [
      { id: 'sessions-meta', run: () => { clock += WARMUP_CPU_BUDGET_MS; ran.push('meta') } },
      { id: 'transcript-tails', run: () => { ran.push('tail') } },
    ]
    const scheduler = new WarmupScheduler(steps, {
      requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null, now: () => clock,
    })
    scheduler.start()
    idle.runAll()
    expect(scheduler.status().cancelledBy).toBe('budget')
    expect(ran).toEqual(['meta'])

    const failing: WarmupStep[] = [
      { id: 'sessions-meta', run: () => { throw new Error('offline') } },
      { id: 'transcript-tails', run: () => { ran.push('after-failure') } },
    ]
    const recovering = new WarmupScheduler(failing, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null })
    recovering.start()
    idle.runAll()
    await recovering.whenFinished()
    expect(recovering.status().failed).toEqual(['sessions-meta'])
    expect(ran).toContain('after-failure')

    const rejecting = new WarmupScheduler([
      { id: 'sessions-meta', run: () => Promise.reject(new Error('offline')) },
      { id: 'transcript-tails', run: () => { ran.push('after-rejection') } },
    ], { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null })
    rejecting.start()
    idle.runAll()
    await flush()
    idle.runAll()
    await rejecting.whenFinished()
    expect(rejecting.status().failed).toEqual(['sessions-meta'])
    expect(ran).toContain('after-rejection')
  })

  it('keeps a synchronously throwing step out of completed', async () => {
    const idle = idleHost()
    const ran: string[] = []
    const steps: WarmupStep[] = [
      { id: 'sessions-meta', run: () => { throw new Error('offline') } },
      { id: 'transcript-tails', run: () => { ran.push('after-failure') } },
    ]
    const scheduler = new WarmupScheduler(steps, { requestIdle: idle.requestIdle, cancelIdle: idle.cancelIdle, inputTarget: null })
    scheduler.start()
    idle.runAll()
    const status = await scheduler.whenFinished()
    expect(status.failed).toEqual(['sessions-meta'])
    expect(status.completed).not.toContain('sessions-meta')
    expect(status.completed).toEqual(['transcript-tails'])
    expect(status.pending).toEqual([])
    expect(status.cancelledBy).toBeNull()
    expect(status.running).toBe(false)
    expect(ran).toContain('after-failure')
  })
})

describe('warm-up plan', () => {
  it('warms meta, three transcript tails, then the surfaces and rail chunks in order', async () => {
    const calls: string[] = []
    const steps = buildWarmupSteps({
      warmSessionMeta: () => { calls.push('meta') },
      recentSessionIds: limit => { calls.push(`recent:${limit}`); return ['s1', 's2', 's3'] },
      warmTranscriptTail: id => { calls.push(`tail:${id}`) },
      warmNotesAndTasks: () => { calls.push('notes') },
      warmSkillsAndSources: () => { calls.push('catalog') },
      warmAgentProfiles: () => { calls.push('agents') },
      warmInboxAndFeed: () => { calls.push('inbox-feed') },
      warmCalendar: weeks => { calls.push(`calendar:${weeks}`) },
      warmRouteChunks: names => { calls.push(`chunks:${names.length}`) },
      routeChunkNames: ['notes', 'tasks'] as readonly RoutePageName[],
    })
    expect(steps.map(step => step.id)).toEqual([
      'sessions-meta', 'transcript-tails', 'notes-tasks', 'skills-sources',
      'agent-profiles', 'inbox-feed', 'calendar', 'route-chunks',
    ])
    for (const step of steps) await step.run()
    expect(calls).toEqual(['meta', 'recent:3', 'tail:s1', 'tail:s2', 'tail:s3', 'notes', 'catalog', 'agents', 'inbox-feed', 'calendar:1', 'chunks:2'])
  })

  it('trims to the three hottest steps on battery or low memory', () => {
    expect(warmupStepBudget({ lowMemory: false, onBattery: false }, 8)).toBe(8)
    expect(warmupStepBudget({ lowMemory: true, onBattery: false }, 8)).toBe(WARMUP_LOW_POWER_STEPS)
    expect(warmupStepBudget({ lowMemory: false, onBattery: true }, 8)).toBe(WARMUP_LOW_POWER_STEPS)
    expect(detectLowMemory(4)).toBe(true)
    expect(detectLowMemory(8)).toBe(false)
  })
})