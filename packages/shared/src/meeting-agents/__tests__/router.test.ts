import { describe, expect, test } from 'bun:test'
import { buildSessionToolDefs } from '../../agent/session-tool-defs.ts'
import { BUILTIN_MEETING_AGENTS } from '../catalog.ts'
import {
  emptyMeetingAgentStore,
  setMeetingAgentEnabled,
  ensureBuiltinMeetingAgents,
} from '../bootstrap.ts'
import {
  MEETING_DISPATCH_LIMITS,
  MeetingJobDispatcher,
  hostToolsForRoutedJob,
  routeMeetingEvent,
  type MeetingBackendFactory,
  type MeetingEvent,
  type MeetingRouterClock,
  type RoleJob,
} from '../router.ts'

function snapshot(watermark: number, revision = watermark) {
  return { revision, finalizedWatermark: watermark, text: `w${watermark}` }
}

function event(partial: Partial<MeetingEvent> & Pick<MeetingEvent, 'id' | 'kind'>): MeetingEvent {
  return {
    meetingId: 'mtg-1',
    workspaceId: 'ws-1',
    sourceSnapshot: snapshot(1),
    ...partial,
  }
}

function holdingBackend() {
  const started: string[] = []
  const backend: MeetingBackendFactory = {
    create(job) {
      return {
        async run(_job: RoleJob, signal: AbortSignal) {
          started.push(job.id)
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        },
      }
    },
  }
  return { backend, started }
}

function fakeClock(): MeetingRouterClock & { advance(ms: number): void } {
  let now = 0
  const timers: { at: number; fn: () => void; cleared: boolean }[] = []
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer = { at: now + ms, fn, cleared: false }
      timers.push(timer)
      return { clear() { timer.cleared = true } }
    },
    advance(ms: number) {
      now += ms
      for (const timer of [...timers]) {
        if (!timer.cleared && timer.at <= now) {
          timer.cleared = true
          timer.fn()
        }
      }
    },
  }
}

function dispatcher(overrides: Partial<ConstructorParameters<typeof MeetingJobDispatcher>[0]> = {}) {
  const held = holdingBackend()
  const clock = fakeClock()
  const instance = new MeetingJobDispatcher({
    backend: held.backend,
    debounceMs: 0,
    clock,
    ...overrides,
  })
  return { dispatcher: instance, started: held.started, clock }
}

describe('meeting role router (issue 363)', () => {
  test('session tools stay the single catalog and meeting tools are opt-in', () => {
    const defaultNames = buildSessionToolDefs().map((def) => def.name)
    expect(defaultNames).not.toContain('meeting.brief')
    const meetingNames = buildSessionToolDefs({ includeMeetingAgentTools: true }).map((def) => def.name)
    expect(meetingNames).toContain('meeting.brief')
    for (const role of BUILTIN_MEETING_AGENTS) {
      for (const skill of role.skillIds) {
        expect(meetingNames).toContain(skill)
      }
    }
  })

  test('partial audio chunks do not create jobs or start a model', () => {
    const { dispatcher: router, started } = dispatcher()
    expect(router.submit(event({ id: 'chunk-1', kind: 'speech', final: false }))).toHaveLength(0)
    expect(router.submit(event({ id: 'chunk-2', kind: 'audio-chunk', final: false }))).toHaveLength(0)
    expect(router.list()).toHaveLength(0)
    expect(started).toHaveLength(0)
    expect(router.runningCount()).toBe(0)
  })

  test('five jobs on one meeting stay within two concurrent slots', () => {
    const { dispatcher: router, started } = dispatcher()
    const jobs = [
      ...router.submit(event({ id: 'e1', kind: 'prepare' })),
      ...router.submit(event({ id: 'e2', kind: 'fact' })),
      ...router.submit(event({ id: 'e3', kind: 'approved-command' })),
      ...router.submit(event({ id: 'e4', kind: 'document' })),
      ...router.submit(event({ id: 'e5', kind: 'hotkey', interactive: true })),
    ]
    expect(jobs).toHaveLength(5)
    expect(router.list()).toHaveLength(5)
    expect(router.runningCount({ meetingId: 'mtg-1' })).toBe(MEETING_DISPATCH_LIMITS.maxConcurrentPerMeeting)
    expect(router.list().filter((job) => job.status === 'queued')).toHaveLength(3)
    expect(started).toHaveLength(2)
    for (const job of router.list()) {
      expect(job.roleVersion).toBe(1)
      expect(job.promptVersion).toBe(1)
      expect(job.sourceSnapshot.finalizedWatermark).toBe(1)
      expect(job.budget.timeoutMs).toBeGreaterThan(0)
    }
  })

  test('interactive jobs jump the digest queue when a slot opens', () => {
    const { dispatcher: router, started } = dispatcher()
    router.submit(event({ id: 'e1', kind: 'prepare' }))
    router.submit(event({ id: 'e2', kind: 'fact' }))
    router.submit(event({ id: 'e3', kind: 'approved-command' }))
    router.submit(event({ id: 'e4', kind: 'document' }))
    const assist = router.submit(event({ id: 'e5', kind: 'hotkey', interactive: true }))[0]
    expect(assist?.status).toBe('queued')
    const running = router.list().filter((job) => job.status === 'running')
    router.complete(running[0]!.id)
    expect(router.list().find((job) => job.id === assist?.id)?.status).toBe('running')
    expect(started.at(-1)).toBe(assist?.id)
  })

  test('workspace limit is four concurrent jobs across meetings', () => {
    const { dispatcher: router, started } = dispatcher()
    for (const meetingId of ['m1', 'm2', 'm3']) {
      router.submit(event({ id: `${meetingId}-a`, kind: 'prepare', meetingId }))
      router.submit(event({ id: `${meetingId}-b`, kind: 'fact', meetingId }))
    }
    expect(router.runningCount({ workspaceId: 'ws-1' })).toBe(MEETING_DISPATCH_LIMITS.maxConcurrentPerWorkspace)
    expect(started).toHaveLength(4)
    expect(router.list().filter((job) => job.status === 'queued')).toHaveLength(2)
  })

  test('duplicate finalized watermark does not create another job', () => {
    const { dispatcher: router, started } = dispatcher()
    const first = router.submit(event({
      id: 's1',
      kind: 'speech',
      final: true,
      sourceSnapshot: snapshot(9),
    }))
    const second = router.submit(event({
      id: 's2',
      kind: 'speech',
      final: true,
      sourceSnapshot: snapshot(9),
    }))
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(router.list()).toHaveLength(1)
    expect(started).toHaveLength(1)
  })

  test('unknown tool is rejected and is not dispatched', () => {
    const { dispatcher: router, started } = dispatcher()
    const jobs = router.submit(event({
      id: 'q1',
      kind: 'question',
      interactive: true,
      toolName: 'meeting.explode',
    }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('rejected')
    expect(jobs[0]?.rejectCode).toBe('unknown-tool')
    expect(started).toHaveLength(0)
    const knownForeign = router.submit(event({
      id: 'q2',
      kind: 'question',
      interactive: true,
      toolName: 'meeting.execute',
    }))
    expect(knownForeign[0]?.rejectCode).toBe('tool-not-allowed')
    expect(hostToolsForRoutedJob(jobs[0]!).map((tool) => tool.name)).toEqual(
      BUILTIN_MEETING_AGENTS.find((role) => role.id === 'rox.meeting.assist')?.skillIds,
    )
  })

  test('cancel stops queued remainder and does not start it', () => {
    const { dispatcher: router, started } = dispatcher()
    router.submit(event({ id: 'e1', kind: 'prepare' }))
    router.submit(event({ id: 'e2', kind: 'fact' }))
    router.submit(event({ id: 'e3', kind: 'approved-command' }))
    router.submit(event({ id: 'e4', kind: 'document' }))
    router.submit(event({ id: 'e5', kind: 'profile' }))
    expect(started).toHaveLength(2)
    const after = router.cancel('mtg-1')
    expect(after.every((job) => job.status === 'cancelled' || job.status === 'done')).toBe(true)
    expect(after.filter((job) => job.status === 'cancelled')).toHaveLength(5)
    expect(started).toHaveLength(2)
    expect(router.runningCount({ meetingId: 'mtg-1' })).toBe(0)
  })

  test('extraction debounce coalesces speech into one model start after 1000ms', () => {
    const clock = fakeClock()
    const { dispatcher: router, started } = dispatcher({ clock, debounceMs: 1000 })
    router.submit(event({ id: 's1', kind: 'speech', final: true, sourceSnapshot: snapshot(1) }))
    router.submit(event({ id: 's2', kind: 'speech', final: true, sourceSnapshot: snapshot(2) }))
    router.submit(event({ id: 's3', kind: 'speech', final: true, sourceSnapshot: snapshot(3) }))
    expect(started).toHaveLength(0)
    expect(router.runningCount()).toBe(0)
    clock.advance(999)
    expect(started).toHaveLength(0)
    clock.advance(1)
    expect(started).toHaveLength(1)
    const live = router.list().filter((job) => job.status === 'running')
    expect(live).toHaveLength(1)
    expect(live[0]?.sourceSnapshot.finalizedWatermark).toBe(3)
    expect(router.list().filter((job) => job.rejectCode === 'coalesced')).toHaveLength(2)
  })

  test('waiting_device is not running and reload keeps jobs without idle processes', () => {
    const first = dispatcher()
    first.dispatcher.submit(event({
      id: 'd1',
      kind: 'prepare',
      deviceScoped: true,
      deviceOnline: false,
    }))
    first.dispatcher.submit(event({ id: 'e1', kind: 'fact' }))
    expect(first.dispatcher.list().find((job) => job.eventId === 'd1')?.status).toBe('waiting_device')
    expect(first.dispatcher.runningCount()).toBe(1)
    const snap = first.dispatcher.snapshot()
    const restored = dispatcher()
    restored.dispatcher.reload(snap)
    expect(restored.dispatcher.list()).toHaveLength(2)
    expect(restored.dispatcher.list().find((job) => job.eventId === 'd1')?.status).toBe('waiting_device')
    expect(restored.dispatcher.runningCount()).toBe(1)
    expect(restored.dispatcher.list().filter((job) => job.status === 'running')).toHaveLength(1)
    expect(ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore()).readiness.every((row) => row.running === false)).toBe(true)
  })

  test('budget is checked before dispatch and disabled roles are not triggered', () => {
    const { dispatcher: router, started } = dispatcher()
    const emptyBudget = router.submit(event({ id: 'b1', kind: 'prepare', budgetRemainingMs: 0 }))
    expect(emptyBudget[0]?.status).toBe('rejected')
    expect(emptyBudget[0]?.rejectCode).toBe('budget-exhausted')
    expect(started).toHaveLength(0)

    const disabled = setMeetingAgentEnabled(
      ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore()).store,
      'rox.meeting.scribe',
      false,
    )
    const routed = routeMeetingEvent(
      event({ id: 's1', kind: 'speech', final: true }),
      { store: disabled },
    )
    expect(routed.jobs).toHaveLength(0)
  })
})
