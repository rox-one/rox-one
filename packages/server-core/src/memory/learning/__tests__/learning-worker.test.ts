/**
 * LearningQueue + LearningWorker tests (PRD §33-34).
 *
 * Covers idempotent enqueue, restart persistence, per-type dispatch to a fake
 * LearningServicePorts, exponential backoff with a fake clock, maxAttempts,
 * one-failure-doesn't-abort, periodic re-scheduling without row accumulation,
 * injected (fake) timers, whenIdle, and corrupt-row tolerance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { LearningServicePorts } from '../learning-types'
import { learningDirFor } from '../learning-types'
import { LearningQueue, learningJobId } from '../LearningQueue'
import type { LearningJobType } from '../LearningQueue'
import { LearningWorker } from '../LearningWorker'
import type { LearningWorkerDeps } from '../LearningWorker'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'learning-worker-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function queuePath(): string {
  return join(learningDirFor(root), 'queue.jsonl')
}

interface FakeService {
  service: LearningServicePorts
  calls: Array<{ fn: string; args: unknown[] }>
  failures: Set<string>
}

function makeService(): FakeService {
  const calls: Array<{ fn: string; args: unknown[] }> = []
  const failures = new Set<string>()
  const track = (fn: string, args: unknown[]): void => {
    calls.push({ fn, args })
    if (failures.has(fn)) throw new Error(`boom:${fn}`)
  }
  const service = {
    reflectSession: async (workspaceId: string, sessionId: string) => {
      track('reflectSession', [workspaceId, sessionId])
      return { candidates: [] }
    },
    runConsolidation: async (workspaceId: string) => {
      track('runConsolidation', [workspaceId])
      return { candidates: [] }
    },
    runSkillCuration: async (workspaceId: string) => {
      track('runSkillCuration', [workspaceId])
      return { items: [] }
    },
    runPolicyLearning: async (workspaceId: string) => {
      track('runPolicyLearning', [workspaceId])
      return { policies: [] }
    },
    runGarbageCollection: async (workspaceId: string) => {
      track('runGarbageCollection', [workspaceId])
      return { archived: 0 }
    },
    evaluateOutcomes: async (workspaceId: string) => {
      track('evaluateOutcomes', [workspaceId])
      return { rolledBack: [] }
    },
  }
  return { service: service as unknown as LearningServicePorts, calls, failures }
}

function mkWorker(service: LearningServicePorts, over: Partial<LearningWorkerDeps> = {}, queue = new LearningQueue(queuePath())): LearningWorker {
  return new LearningWorker({ queue, service, workspaceId: 'wid', ...over })
}

describe('LearningQueue', () => {
  it('assigns the deterministic jobId <type>:<sourceId>', () => {
    const queue = new LearningQueue(queuePath())
    const row = queue.enqueue('session_reflection', 'sess-1', { at: 100 })
    expect(row.jobId).toBe('session_reflection:sess-1')
    expect(row.id).toBe(row.jobId)
    expect(learningJobId('consolidation', 'ws')).toBe('consolidation:ws')
    expect(row.status).toBe('pending')
    expect(row.attempt).toBe(0)
    expect(row.createdAt).toBe(100)
    expect(row.notBefore).toBe(100)
  })

  it('is idempotent for pending jobs (same row, no duplicate, untouched)', () => {
    const queue = new LearningQueue(queuePath())
    const first = queue.enqueue('consolidation', 'wid', { at: 100, notBefore: 500 })
    const again = queue.enqueue('consolidation', 'wid', { at: 999, notBefore: 999 })
    expect(again).toEqual(first)
    expect(queue.list().length).toBe(1)
    expect(queue.get('consolidation:wid')?.notBefore).toBe(500)
    expect(queue.get('consolidation:wid')?.createdAt).toBe(100)
  })

  it('returns a running job untouched on re-enqueue', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100 })
    queue.markRunning('consolidation:wid', 150)
    queue.enqueue('consolidation', 'wid', { at: 200 })
    expect(queue.list().length).toBe(1)
    expect(queue.get('consolidation:wid')?.status).toBe('running')
    expect(queue.get('consolidation:wid')?.updatedAt).toBe(150)
  })

  it('restarts a finished job as fresh pending while keeping createdAt', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100 })
    queue.markDone('consolidation:wid', 200)
    const fresh = queue.enqueue('consolidation', 'wid', { at: 300 })
    expect(queue.list().length).toBe(1)
    expect(fresh.status).toBe('pending')
    expect(fresh.attempt).toBe(0)
    expect(fresh.createdAt).toBe(100)
  })

  it('honours notBefore in listDue and ignores future/non-pending rows', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100, notBefore: 1_000 })
    queue.enqueue('skill_curation', 'wid', { at: 100, notBefore: 100 })
    queue.enqueue('policy_learning', 'wid', { at: 100, notBefore: 100 })
    queue.markDone('policy_learning:wid', 110)
    expect(queue.listDue(500).map((r) => r.jobId)).toEqual(['skill_curation:wid'])
    expect(queue.listDue(1_000).map((r) => r.jobId)).toEqual(['skill_curation:wid', 'consolidation:wid'])
  })

  it('transitions through markRunning / markDone', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100 })
    queue.markRunning('consolidation:wid', 120)
    expect(queue.get('consolidation:wid')?.status).toBe('running')
    queue.markDone('consolidation:wid', 140)
    const row = queue.get('consolidation:wid')
    expect(row?.status).toBe('done')
    expect(row?.updatedAt).toBe(140)
    expect(row?.notBefore).toBeUndefined()
  })

  it('markFailed stores status, error and attempt', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100 })
    queue.markFailed('consolidation:wid', 'kaboom', { attempt: 5, at: 200 })
    const row = queue.get('consolidation:wid')
    expect(row?.status).toBe('failed')
    expect(row?.lastError).toBe('kaboom')
    expect(row?.attempt).toBe(5)
  })

  it('reschedule returns the job to pending with notBefore + attempt', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('consolidation', 'wid', { at: 100 })
    queue.reschedule('consolidation:wid', 5_000, 'retry', { attempt: 2, at: 300 })
    const row = queue.get('consolidation:wid')
    expect(row?.status).toBe('pending')
    expect(row?.notBefore).toBe(5_000)
    expect(row?.attempt).toBe(2)
    expect(row?.lastError).toBe('retry')
  })

  it('statusCounts counts each status plus total', () => {
    const queue = new LearningQueue(queuePath())
    queue.enqueue('session_reflection', 'a', { at: 100 })
    queue.enqueue('consolidation', 'b', { at: 100 })
    queue.enqueue('skill_curation', 'c', { at: 100 })
    queue.enqueue('policy_learning', 'd', { at: 100 })
    queue.markRunning('consolidation:b', 110)
    queue.markDone('skill_curation:c', 110)
    queue.markFailed('policy_learning:d', 'x', { at: 110 })
    expect(queue.statusCounts()).toEqual({ pending: 1, running: 1, done: 1, failed: 1, total: 4 })
  })

  it('persists attempt/status across a queue reload', () => {
    const first = new LearningQueue(queuePath())
    first.enqueue('consolidation', 'wid', { at: 100 })
    first.reschedule('consolidation:wid', 9_000, 'retry', { attempt: 3, at: 200 })
    const reloaded = new LearningQueue(queuePath())
    const row = reloaded.get('consolidation:wid')
    expect(row?.attempt).toBe(3)
    expect(row?.status).toBe('pending')
    expect(row?.notBefore).toBe(9_000)
  })

  it('tolerates corrupt and unknown-status rows', () => {
    const p = queuePath()
    mkdirSync(dirname(p), { recursive: true })
    const good = { id: 'consolidation:wid', jobId: 'consolidation:wid', type: 'consolidation', sourceId: 'wid', status: 'pending', attempt: 0, createdAt: 1, updatedAt: 1 }
    const bogus = { id: 'weird:x', jobId: 'weird:x', type: 'weird', sourceId: 'x', status: 'bogus', attempt: 0, createdAt: 1, updatedAt: 1 }
    writeFileSync(p, `{ not json\n${JSON.stringify(good)}\n${JSON.stringify(bogus)}\n`)
    const queue = new LearningQueue(p)
    expect(queue.list().length).toBe(2)
    expect(queue.statusCounts()).toEqual({ pending: 1, running: 0, done: 0, failed: 0, total: 2 })
    expect(queue.listDue(50).map((r) => r.jobId)).toEqual(['consolidation:wid'])
  })
})
interface WorkerFixture {
  queue: LearningQueue
  worker: LearningWorker
  service: FakeService
  clock: { now: number }
}

function workerWith(over: Partial<LearningWorkerDeps> = {}): WorkerFixture {
  const service = makeService()
  const queue = new LearningQueue(queuePath())
  const clock = { now: 1_000_000 }
  const worker = new LearningWorker({ queue, service: service.service, workspaceId: 'wid', clock: () => clock.now, ...over })
  return { queue, worker, service, clock }
}

const DISPATCH_CASES: Array<{ type: LearningJobType; sourceId?: string; fn: string; args: unknown[] }> = [
  { type: 'session_reflection', sourceId: 'sess-1', fn: 'reflectSession', args: ['wid', 'sess-1'] },
  { type: 'consolidation', fn: 'runConsolidation', args: ['wid'] },
  { type: 'skill_curation', fn: 'runSkillCuration', args: ['wid'] },
  { type: 'policy_learning', fn: 'runPolicyLearning', args: ['wid'] },
  { type: 'garbage_collection', fn: 'runGarbageCollection', args: ['wid'] },
  { type: 'outcome_evaluation', fn: 'evaluateOutcomes', args: ['wid'] },
]

describe('LearningWorker dispatch', () => {
  for (const c of DISPATCH_CASES) {
    it(`dispatches ${c.type} to ${c.fn} and marks it done`, async () => {
      const { queue, worker, service, clock } = workerWith()
      worker.enqueue(c.type, c.sourceId)
      await worker.runDue(clock.now)
      expect(service.calls).toEqual([{ fn: c.fn, args: c.args }])
      expect(queue.get(learningJobId(c.type, c.sourceId ?? 'wid'))?.status).toBe('done')
    })
  }

  it('success marks the job done with no attempt bump', async () => {
    const { queue, worker, clock } = workerWith()
    worker.enqueue('consolidation')
    await worker.runDue(clock.now)
    const row = queue.get('consolidation:wid')
    expect(row?.status).toBe('done')
    expect(row?.attempt).toBe(0)
  })

  it('enqueue returns the deterministic jobId', () => {
    const { worker } = workerWith()
    expect(worker.enqueue('session_reflection', 'sess-9')).toBe('session_reflection:sess-9')
    expect(worker.enqueue('consolidation')).toBe('consolidation:wid')
  })

  it('does not run jobs whose notBefore is in the future', async () => {
    const { queue, worker, service, clock } = workerWith()
    const jobId = worker.enqueue('consolidation')
    queue.reschedule(jobId, clock.now + 5_000, undefined, { at: clock.now })
    await worker.runDue(clock.now)
    expect(service.calls.length).toBe(0)
    clock.now += 5_000
    await worker.runDue(clock.now)
    expect(service.calls.length).toBe(1)
  })
})

describe('LearningWorker retry', () => {
  it('bumps attempt and schedules exponential backoff on failure', async () => {
    const { queue, worker, service, clock } = workerWith({ retryBaseMs: 1_000, retryMaxMs: 8_000 })
    service.failures.add('runConsolidation')
    worker.enqueue('consolidation')

    await worker.runDue(clock.now)
    let row = queue.get('consolidation:wid')!
    expect(row.status).toBe('pending')
    expect(row.attempt).toBe(1)
    expect(row.notBefore).toBe(clock.now + 2_000)
    expect(row.lastError).toBe('boom:runConsolidation')

    await worker.runDue(clock.now)
    expect(service.calls.length).toBe(1)

    clock.now += 2_000
    await worker.runDue(clock.now)
    row = queue.get('consolidation:wid')!
    expect(row.attempt).toBe(2)
    expect(row.notBefore).toBe(clock.now + 4_000)
  })

  it('caps the backoff delay at retryMaxMs', async () => {
    const { queue, worker, service, clock } = workerWith({ retryBaseMs: 1_000, retryMaxMs: 3_000, maxAttempts: 10 })
    service.failures.add('runConsolidation')
    worker.enqueue('consolidation')

    await worker.runDue(clock.now)
    expect(queue.get('consolidation:wid')?.notBefore).toBe(clock.now + 2_000)

    clock.now += 2_000
    await worker.runDue(clock.now)
    expect(queue.get('consolidation:wid')?.notBefore).toBe(clock.now + 3_000)

    clock.now += 3_000
    await worker.runDue(clock.now)
    expect(queue.get('consolidation:wid')?.notBefore).toBe(clock.now + 3_000)
  })

  it('marks the job failed after maxAttempts', async () => {
    const { queue, worker, service, clock } = workerWith({ retryBaseMs: 10, retryMaxMs: 100, maxAttempts: 3 })
    service.failures.add('runConsolidation')
    worker.enqueue('consolidation')

    await worker.runDue(clock.now)
    clock.now += 1_000
    await worker.runDue(clock.now)
    clock.now += 1_000
    await worker.runDue(clock.now)

    const row = queue.get('consolidation:wid')!
    expect(row.status).toBe('failed')
    expect(row.attempt).toBe(3)
    expect(service.calls.length).toBe(3)

    clock.now += 1_000_000
    await worker.runDue(clock.now)
    expect(service.calls.length).toBe(3)
  })

  it('one failing job does not abort the tick', async () => {
    const { queue, worker, service, clock } = workerWith()
    service.failures.add('runConsolidation')
    worker.enqueue('consolidation')
    worker.enqueue('skill_curation')

    await worker.runDue(clock.now)

    expect(service.calls.map((c) => c.fn)).toEqual(['runConsolidation', 'runSkillCuration'])
    expect(queue.get('consolidation:wid')?.status).toBe('pending')
    expect(queue.get('consolidation:wid')?.attempt).toBe(1)
    expect(queue.get('skill_curation:wid')?.status).toBe('done')
  })
})

describe('LearningWorker periodic', () => {
  it('ensurePeriodic enqueues one row per periodic type', () => {
    const { queue, worker, clock } = workerWith()
    worker.ensurePeriodic(clock.now)
    expect(queue.list().length).toBe(5)
    expect(queue.statusCounts()).toEqual({ pending: 5, running: 0, done: 0, failed: 0, total: 5 })
    expect(queue.list().map((r) => r.type).sort()).toEqual([
      'consolidation',
      'garbage_collection',
      'outcome_evaluation',
      'policy_learning',
      'skill_curation',
    ])
  })

  it('re-schedules done jobs at lastDone + cadence without row accumulation', async () => {
    const { queue, worker, clock } = workerWith()
    worker.ensurePeriodic(clock.now)
    await worker.runDue(clock.now)
    expect(queue.statusCounts().done).toBe(5)

    worker.ensurePeriodic(clock.now)
    const consolidation = queue.get('consolidation:wid')!
    expect(consolidation.status).toBe('pending')
    expect(consolidation.attempt).toBe(0)
    expect(consolidation.notBefore).toBe(clock.now + 6 * 60 * 60 * 1000)
    expect(queue.get('garbage_collection:wid')!.notBefore).toBe(clock.now + 7 * 24 * 60 * 60 * 1000)

    worker.ensurePeriodic(clock.now)
    worker.ensurePeriodic(clock.now)
    expect(queue.list().length).toBe(5)
  })

  it('leaves pending periodic jobs untouched', () => {
    const { queue, worker, clock } = workerWith()
    worker.ensurePeriodic(clock.now)
    const before = queue.get('consolidation:wid')
    worker.ensurePeriodic(clock.now + 999)
    expect(queue.get('consolidation:wid')).toEqual(before)
  })

  it('tick keeps a single row per periodic type across many ticks', async () => {
    const { queue, worker, clock } = workerWith({ cadences: { consolidationMs: 100 } })
    for (let i = 0; i < 4; i += 1) {
      clock.now += 1_000
      worker.ensurePeriodic(clock.now)
      await worker.runDue(clock.now)
    }
    expect(queue.list().length).toBe(5)
    expect(queue.get('consolidation:wid')?.status).toBe('done')
  })
})

describe('LearningWorker lifecycle', () => {
  it('start installs exactly one interval and stop clears it', async () => {
    const timers: Array<{ fn: () => void; ms: number }> = []
    const cleared: unknown[] = []
    const { queue, worker } = workerWith({
      setIntervalFn: (fn, ms) => {
        timers.push({ fn, ms })
        return 'h1'
      },
      clearIntervalFn: (h) => {
        cleared.push(h)
      },
    })
    worker.enqueue('consolidation')
    worker.start()
    expect(timers.length).toBe(1)
    expect(timers[0].ms).toBe(60_000)
    worker.start()
    expect(timers.length).toBe(1)

    timers[0].fn()
    await worker.whenIdle()
    expect(queue.get('consolidation:wid')?.status).toBe('done')

    worker.stop()
    expect(cleared).toEqual(['h1'])
    worker.stop()
    expect(cleared.length).toBe(1)
  })

  it('honours an injected intervalMs', () => {
    const timers: number[] = []
    const { worker } = workerWith({
      intervalMs: 5_000,
      setIntervalFn: (_fn, ms) => {
        timers.push(ms)
        return 'h'
      },
      clearIntervalFn: () => {},
    })
    worker.start()
    expect(timers).toEqual([5_000])
    worker.stop()
  })

  it('whenIdle resolves immediately when nothing is in flight', async () => {
    const { worker } = workerWith()
    await worker.whenIdle()
    expect(true).toBe(true)
  })

  it('whenIdle waits for the in-flight tick to finish', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = makeService()
    const tracked = service.service as unknown as { runConsolidation: () => Promise<unknown> }
    tracked.runConsolidation = async () => {
      await gate
      return { candidates: [] }
    }
    const queue = new LearningQueue(queuePath())
    const worker = new LearningWorker({ queue, service: service.service, workspaceId: 'wid', clock: () => 1_000 })
    worker.enqueue('consolidation')

    const due = worker.runDue(1_000)
    let idleSettled = false
    const idle = worker.whenIdle().then(() => {
      idleSettled = true
    })
    await Promise.resolve()
    expect(idleSettled).toBe(false)

    release()
    await due
    await idle
    expect(idleSettled).toBe(true)
  })

  it('statusCounts is a passthrough to the queue', () => {
    const { queue, worker } = workerWith()
    worker.enqueue('consolidation')
    expect(worker.statusCounts()).toEqual(queue.statusCounts())
    expect(worker.statusCounts().pending).toBe(1)
  })
})