import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyMeeting } from '@rox/core/meetings'
import type { MeetingGrant } from '@rox/shared/meeting-agents'
import { MeetingJournal } from '../journal.ts'
import { MeetingObserveCoordinator, applyNativeObserveIntent } from '../observe.ts'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'meeting-observe-'))
  roots.push(root)
  return root
}

function seedMeeting(root: string, workspaceId = 'ws', meetingId = 'm1'): void {
  const journal = new MeetingJournal(root)
  journal.acquireWriter()
  journal.commit({
    workspaceId,
    meetingId,
    expectedRevision: 0,
    commandId: 'seed',
    events: [{ type: 'meeting.created', meeting: emptyMeeting({ workspaceId, meetingId, title: 'Call', now: 0 }) }],
    outboxEntries: [],
  })
  journal.releaseWriter()
}

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['mic'],
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('observe capture intent (grant-gated)', () => {
  test('requires a grant with the mic capability', () => {
    const root = tempRoot()
    seedMeeting(root)
    expect(applyNativeObserveIntent({
      persistRootDir: root, workspaceId: 'ws', actorId: 'user', grant: null, meetingId: 'm1', action: 'start', now: 1,
    })).toEqual({ ok: false, code: 'grant-required' })
    const noMic = applyNativeObserveIntent({
      persistRootDir: root, workspaceId: 'ws', actorId: 'user',
      grant: { ...grant, capabilities: ['send'] }, meetingId: 'm1', action: 'start', now: 1,
    })
    expect(noMic).toEqual({ ok: false, code: 'capability-denied' })
  })

  test('start/pause/stop persist an observe session through the journal', () => {
    const root = tempRoot()
    seedMeeting(root)
    const started = applyNativeObserveIntent({
      persistRootDir: root, workspaceId: 'ws', actorId: 'user', grant, meetingId: 'm1', action: 'start', now: 10,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.session.state).toBe('in_call')
    expect(started.observing).toBe(true)

    const paused = applyNativeObserveIntent({
      persistRootDir: root, workspaceId: 'ws', actorId: 'user', grant, meetingId: 'm1', action: 'pause',
      sessionId: started.session.sessionId, now: 20,
    })
    expect(paused.ok && paused.session.state).toBe('paused')

    const stopped = applyNativeObserveIntent({
      persistRootDir: root, workspaceId: 'ws', actorId: 'user', grant, meetingId: 'm1', action: 'stop',
      sessionId: started.session.sessionId, now: 30,
    })
    expect(stopped.ok && stopped.observing).toBe(false)
    if (!stopped.ok) return
    const snapshot = new MeetingJournal(root, { readOnly: true }).read('m1')
    expect(snapshot.sessions[started.session.sessionId]?.state).toBe('ended')
  })
})

describe('live observe coordinator', () => {
  test('start/append/stop keeps bounded transcript lines and a rolling summary', async () => {
    const root = tempRoot()
    seedMeeting(root)
    const coordinator = new MeetingObserveCoordinator(() => root, () => 100)

    const startedResult = coordinator.start({ workspaceId: 'ws', meetingId: 'm1' })
    expect(startedResult.ok).toBe(true)
    if (!startedResult.ok) return
    expect(startedResult.observing).toBe(true)
    const session = coordinator.state({ workspaceId: 'ws', meetingId: 'm1' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    coordinator.appendLine(session.session.sessionId, { key: 'k0', speaker: 'Иван', text: 'решили начать', at: 100 })
    coordinator.appendLine(session.session.sessionId, { key: 'k1', speaker: '', text: 'надо проверить', at: 200 })
    expect(coordinator.appendLine(session.session.sessionId, { key: 'k1', speaker: '', text: 'дубль', at: 300 }).duplicate).toBe(true)

    const lines = coordinator.transcriptLines('m1')
    expect(lines.map((line) => line.text)).toEqual(['решили начать', 'надо проверить'])
    expect(coordinator.transcriptLines('m1', 0).map((line) => line.seq)).toEqual([1])

    const summary = await coordinator.generateSummary({ workspaceId: 'ws', meetingId: 'm1' })
    expect(summary?.generator).toBe('heuristic')
    expect(coordinator.summary({ workspaceId: 'ws', meetingId: 'm1' })?.summary).toBe('решили начать • надо проверить')

    // The summary is journal-canonical, so a fresh coordinator still sees it.
    const fresh = new MeetingObserveCoordinator(() => root, () => 400)
    expect(fresh.summary({ workspaceId: 'ws', meetingId: 'm1' })?.summary).toBe('решили начать • надо проверить')

    const stoppedResult = coordinator.stop({ workspaceId: 'ws', meetingId: 'm1' })
    expect(stoppedResult.ok).toBe(true)
    if (!stoppedResult.ok) return
    expect(stoppedResult.observing).toBe(false)
    expect(coordinator.state({ workspaceId: 'ws', meetingId: 'm1' }).ok).toBe(true)
  })

  test('state is fail-closed for unknown meetings', () => {
    const root = tempRoot()
    const coordinator = new MeetingObserveCoordinator(() => root, () => 0)
    expect(coordinator.state({ workspaceId: 'ws', meetingId: 'missing' })).toEqual({ ok: false, code: 'session-not-found' })
    expect(coordinator.summary({ workspaceId: 'ws', meetingId: 'missing' })).toBeNull()
    expect(coordinator.start({ workspaceId: 'ws', meetingId: 'missing' })).toEqual({ ok: false, code: 'observe-failed' })
  })
})