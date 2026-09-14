import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTaskRepository } from '@craft-agent/core/tasks/personal'
import { resetPersonalTaskIds } from '@craft-agent/core/tasks/personal'
import { isVerifiedEffect, Rox2NoteRepository } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { AutomationSystem } from '@craft-agent/shared/automations'
import { ActionDefinitionSchema } from '@craft-agent/shared/automations'
import {
  createFileTaskPort,
  createRox2NotePort,
  memoryTaskFs,
} from '../native-actions.ts'
import {
  MeetingFollowupService,
  occurrenceKey,
  type FollowupSchedule,
} from '../followup.ts'

const archiveGrant: MeetingGrant = {
  id: 'g-archive',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['archive.durable'],
  expiresAt: Date.UTC(2027, 0, 1),
}

const sendGrant: MeetingGrant = {
  ...archiveGrant,
  id: 'g-send',
  capabilities: ['action.external'],
}

function schedule(overrides: Partial<FollowupSchedule> = {}): FollowupSchedule {
  return {
    id: 'sched-1',
    ownerId: 'acct-1',
    workspaceId: 'ws-a',
    timezone: 'America/New_York',
    expiresAt: Date.UTC(2026, 10, 1),
    optOut: false,
    budgetRemaining: 3,
    missedRunPolicy: 'skip',
    maxRetries: 3,
    kind: 'prepare',
    calendarEventId: 'cal-1',
    scope: 'server',
    payloadHash: 'hash-1',
    ...overrides,
  }
}

function harness(overrides: ConstructorParameters<typeof MeetingFollowupService>[0] extends infer T ? Partial<T> : never = {}) {
  resetPersonalTaskIds()
  const fs = memoryTaskFs()
  const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
  const notes = new Rox2NoteRepository()
  const service = new MeetingFollowupService({
    workspaceId: 'ws-a',
    actorId: 'acct-1',
    deviceId: 'dev-1',
    grants: [archiveGrant, sendGrant],
    now: () => Date.UTC(2026, 5, 1, 12),
    tasks: createFileTaskPort(repo),
    notes: createRox2NotePort(notes),
    ...overrides,
  })
  return { fs, repo, notes, service }
}

describe('meeting follow-up (issue 374 / I018)', () => {
  test('does not duplicate DST/replay of the same local calendar day', async () => {
    const { service } = harness({ now: () => Date.UTC(2026, 2, 8, 6, 30) })
    service.upsertSchedule(schedule())
    const first = await service.run('sched-1', 'prepare')
    const second = await service.run('sched-1', 'prepare')
    expect(first.status).toBe('ran')
    expect(isVerifiedEffect(first.result)).toBe(true)
    expect(second.status).toBe('duplicate')
    expect(isVerifiedEffect(second.result)).toBe(false)
    const before = occurrenceKey('sched-1', Date.UTC(2026, 2, 8, 6, 0), 'America/New_York')
    const after = occurrenceKey('sched-1', Date.UTC(2026, 2, 8, 7, 0), 'America/New_York')
    expect(before).toBe(after)
  })

  test('calendar cancel disables upcoming prepare without erasing ledger', async () => {
    const { service } = harness()
    service.upsertSchedule(schedule())
    const first = await service.run('sched-1', 'prepare')
    expect(first.status).toBe('ran')
    service.cancelCalendar('cal-1')
    const next = await service.run('sched-1', 'prepare')
    expect(next.reason).toBe('calendar-canceled')
    expect(isVerifiedEffect(next.result)).toBe(false)
    expect(service.listLedger().some((row) => row.status === 'ran')).toBe(true)
    expect(service.listLedger().some((row) => row.reason === 'calendar-canceled')).toBe(true)
  })

  test('marks closed-app device jobs as waiting_device and continues server jobs', async () => {
    const { service } = harness({ deviceAvailable: false })
    service.upsertSchedule(schedule({ id: 'device-1', scope: 'device' }))
    service.upsertSchedule(schedule({ id: 'server-1', scope: 'server' }))
    const device = await service.run('device-1', 'prepare')
    const server = await service.run('server-1', 'prepare')
    expect(device.reason).toBe('waiting_device')
    expect(isVerifiedEffect(device.result)).toBe(false)
    expect(server.status).toBe('ran')
    expect(isVerifiedEffect(server.result)).toBe(true)
  })

  test('reads native task state instead of assuming a promise is done', async () => {
    const { service, repo } = harness()
    const loaded = await repo.load()
    const open = loaded.store.create({ title: 'прототип', notes: 'open', now: 1 })
    const done = loaded.store.create({ title: 'done', notes: 'done', now: 1 })
    loaded.store.complete(done.id, 2)
    await repo.save(loaded.store, loaded.revision)
    service.upsertSchedule(schedule({ id: 'open', kind: 'promise-check', taskId: open.id }))
    service.upsertSchedule(schedule({ id: 'done', kind: 'promise-check', taskId: done.id }))
    const stillOpen = await service.run('open', 'promise-check')
    const completed = await service.run('done', 'promise-check')
    expect(stillOpen.reason).toBe('open')
    expect(isVerifiedEffect(stillOpen.result)).toBe(false)
    expect(completed.reason).toBe('already-completed')
    expect(completed.status).toBe('fulfilled')
    expect(isVerifiedEffect(completed.result)).toBe(false)
  })

  test('expired grant is denied and ask-without-grant is a challenge', async () => {
    const expired: MeetingGrant = { ...archiveGrant, id: 'g-exp', expiresAt: 1 }
    const { service } = harness({ grants: [expired], now: () => 10 })
    service.upsertSchedule(schedule({ expiresAt: Date.UTC(2027, 0, 1) }))
    const result = await service.run('sched-1', 'prepare')
    expect(result.reason).toBe('expired-grant')
    expect(isVerifiedEffect(result.result)).toBe(false)

    const missing = new MeetingFollowupService({
      workspaceId: 'ws-a',
      actorId: 'acct-1',
      deviceId: 'dev-1',
      grants: [],
      now: () => 10,
    })
    missing.upsertSchedule(schedule())
    const challenge = await missing.run('sched-1', 'prepare')
    expect(challenge.reason).toBe('challenge')
  })

  test('refuses simulator/fixture executors and does not auto-resend an unknown send', async () => {
    const simulated = harness({ executor: 'simulator' }).service
    simulated.upsertSchedule(schedule())
    expect((await simulated.run('sched-1', 'prepare')).reason).toBe('simulator-not-production')
    expect(isVerifiedEffect((await simulated.run('sched-1', 'prepare')).result)).toBe(false)

    const { service } = harness()
    service.upsertSchedule(schedule({ kind: 'send' }))
    const send = await service.run('sched-1', 'send')
    expect(send.reason).toBe('send-requires-fresh-grant')
    expect(isVerifiedEffect(send.result)).toBe(false)
    const unknown = await service.run('sched-1', 'send', { crashAfterSend: true })
    expect(unknown.status).toBe('unknown')
    expect(isVerifiedEffect(unknown.result)).toBe(false)
    const resend = await service.run('sched-1', 'send')
    expect(resend.reason).toBe('unknown-no-resend')
    expect(isVerifiedEffect(resend.result)).toBe(false)
  })

  test('restart restores persisted schedules and keeps occurrence dedupe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-mtg-followup-'))
    const first = harness({ persistDir: dir, now: () => Date.UTC(2026, 2, 8, 6, 30) }).service
    first.upsertSchedule(schedule())
    await first.run('sched-1', 'prepare')
    const restored = await MeetingFollowupService.load({
      workspaceId: 'ws-a',
      actorId: 'acct-1',
      deviceId: 'dev-1',
      grants: [archiveGrant, sendGrant],
      now: () => Date.UTC(2026, 2, 8, 7, 0),
      persistDir: dir,
      notes: createRox2NotePort(new Rox2NoteRepository()),
    })
    const replay = await restored.run('sched-1', 'prepare')
    expect(replay.status).toBe('duplicate')
    expect(restored.listLedger().some((row) => row.status === 'ran')).toBe(true)
  })

  test('rollback disables schedules while keeping the ledger', async () => {
    const { service } = harness()
    service.upsertSchedule(schedule())
    await service.run('sched-1', 'prepare')
    service.disableSchedules()
    expect(service.listSchedules()[0]?.optOut).toBe(true)
    expect(service.listLedger()).toHaveLength(1)
    const later = await service.run('sched-1', 'prepare')
    expect(later.status).toBe('disabled')
  })

  test('missed-run skip does not catch up and catch-up-once runs once', async () => {
    const { service } = harness()
    service.upsertSchedule(schedule({ missedRunPolicy: 'skip' }))
    const skipped = await service.run('sched-1', 'prepare', { missed: true })
    expect(skipped.reason).toBe('missed-skip')
    expect(isVerifiedEffect(skipped.result)).toBe(false)
    const catchUp = harness().service
    catchUp.upsertSchedule(schedule({ missedRunPolicy: 'catch-up-once' }))
    const ran = await catchUp.run('sched-1', 'prepare', { missed: true })
    expect(ran.status).toBe('ran')
  })

  test('SchedulerTick dispatches meeting.followup without using workflows/run.ts', async () => {
    const { service } = harness()
    service.upsertSchedule(schedule({ cron: '* * * * *' }))
    const dir = mkdtempSync(join(tmpdir(), 'rox-mtg-auto-'))
    const system = new AutomationSystem({
      workspaceRootPath: dir,
      workspaceId: 'ws-a',
      meetingFollowupExecutor: service.asAutomationExecutor(),
      meetingFollowupMatchers: () => service.matchers(),
    })
    try {
      await system.eventBus.emit('SchedulerTick', {
        workspaceId: 'ws-a',
        timestamp: Date.UTC(2026, 5, 1, 12),
        localTime: '08:00',
        utcTime: '2026-06-01T12:00:00.000Z',
      })
      expect(service.listLedger().some((row) => row.status === 'ran')).toBe(true)
    } finally {
      await system.dispose()
    }
    const source = readFileSync(join(import.meta.dir, '../followup.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*workflows\/run/)
    expect(source).not.toContain('localStorage')
    expect(ActionDefinitionSchema.safeParse({ type: 'meeting.followup', scheduleId: 'sched-1' }).success).toBe(true)
  })
})
