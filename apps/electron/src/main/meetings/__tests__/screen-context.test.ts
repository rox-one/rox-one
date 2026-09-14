import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { answerMeetingQuestion, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  MeetingScreenContext,
  type ScreenCaptureDriver,
  type ScreenFrame,
  type ScreenSource,
} from '../screen-context.ts'

const src = readFileSync(join(import.meta.dir, '../screen-context.ts'), 'utf8')

const actor = {
  accountId: 'acct-1',
  workspaceId: 'ws',
  deviceId: 'dev-1',
  authenticated: true as const,
}

const screenGrant: MeetingGrant = {
  id: 'g-screen',
  actorId: 'acct-1',
  workspaceId: 'ws',
  deviceId: 'dev-1',
  capabilities: ['capture.screen'],
  expiresAt: 9_000,
}

function driver(sources: ScreenSource[], frames: Record<string, ScreenFrame>): ScreenCaptureDriver {
  return {
    listSources: () => sources,
    captureFrame(sourceId) {
      return frames[sourceId] ?? null
    },
    applyExclusion: () => ({ attempted: true, supported: process.platform === 'darwin' || process.platform === 'win32' }),
  }
}

describe('meeting selected screen (issue 370 / I014)', () => {
  test('does not create a second overlay or steal focus', () => {
    expect(src).not.toContain('new BrowserWindow')
    expect(src).not.toContain('.show()')
    expect(src).not.toContain('.focus(')
    expect(src).toContain('SurfaceContextProvider')
    expect(src).toContain('all-displays-denied')
  })

  test('selects one tab and does not capture other windows or all displays', async () => {
    const tab: ScreenSource = { id: 'tab-1', kind: 'tab', name: 'Meet', revision: '1' }
    const other: ScreenSource = { id: 'win-2', kind: 'window', name: 'Secret', revision: '4' }
    const displayA: ScreenSource = { id: 'disp-1', kind: 'display', name: 'A', revision: '1' }
    const displayB: ScreenSource = { id: 'disp-2', kind: 'display', name: 'B', revision: '1' }
    const frames: Record<string, ScreenFrame> = {
      'tab-1': { sourceId: 'tab-1', revision: '1', capturedAt: 1, text: 'selected tab agenda' },
      'win-2': { sourceId: 'win-2', revision: '4', capturedAt: 1, text: 'SECRET_WINDOW' },
    }
    const session = new MeetingScreenContext({
      workspaceId: 'ws',
      meetingId: 'm1',
      sessionId: 's1',
      actor,
      grants: [screenGrant],
      now: 1,
      driver: driver([tab, other, displayA, displayB], frames),
    })
    await session.refreshSources()
    const selected = await session.selectSource({ sourceId: 'tab-1', now: 1 })
    expect(selected.selected?.id).toContain('tab-1')
    expect(selected.error).toBeUndefined()

    const all = await session.captureFrame({ allDisplays: true, now: 1 })
    expect(all).toBeNull()
    expect(session.snapshot().error).toBe('all-displays-denied')

    const frame = await session.captureFrame({ now: 1 })
    expect(frame?.text).toBe('selected tab agenda')
    expect(frame?.text).not.toContain('SECRET_WINDOW')
    const binding = session.providerBinding()
    expect(binding?.envelope.entityRefs).toEqual([frame?.sourceId])
    expect(binding?.envelope.closedSourceIds.some((id) => id.includes('win-2'))).toBe(true)
  })

  test('selected scope does not change silently when the source list refreshes', async () => {
    let sources: ScreenSource[] = [
      { id: 'tab-1', kind: 'tab', name: 'Meet', revision: '1' },
      { id: 'win-2', kind: 'window', name: 'Other', revision: '1' },
    ]
    const session = new MeetingScreenContext({
      workspaceId: 'ws',
      meetingId: 'm1',
      sessionId: 's1',
      actor,
      grants: [screenGrant],
      now: 1,
      driver: {
        listSources: () => sources,
        captureFrame: () => ({ sourceId: 'tab-1', revision: '1', capturedAt: 1, text: 'ok' }),
      },
    })
    await session.refreshSources()
    await session.selectSource({ sourceId: 'tab-1', now: 1 })
    sources = [{ id: 'win-2', kind: 'window', name: 'Other', revision: '2' }]
    await session.refreshSources()
    const snap = session.snapshot()
    expect(snap.selected?.id).toContain('tab-1')
    expect(snap.available).toBe(false)
    expect(snap.error).toBe('selected-unavailable')
    expect(await session.captureFrame({ now: 1 })).toBeNull()
  })

  test('preview is available and revoke stops new frames', async () => {
    const tab: ScreenSource = { id: 'tab-1', kind: 'tab', name: 'Meet', revision: '1' }
    const session = new MeetingScreenContext({
      workspaceId: 'ws',
      meetingId: 'm1',
      sessionId: 's1',
      actor,
      grants: [screenGrant],
      now: 1,
      driver: driver([tab], {
        'tab-1': { sourceId: 'tab-1', revision: '1', capturedAt: 1, text: 'preview text', preview: 'data:image/png;base64,xx' },
      }),
    })
    await session.refreshSources()
    await session.selectSource({ sourceId: 'tab-1', now: 1 })
    await session.previewSelected(1)
    expect(session.snapshot().preview?.sourceId).toContain('tab-1')
    expect(session.snapshot().captureExclusion.attempted).toBe(true)

    session.revoke(2)
    expect(session.snapshot().revoked).toBe(true)
    expect(await session.captureFrame({ now: 3 })).toBeNull()
    expect(session.snapshot().framesAfterRevoke).toBeGreaterThan(0)
    expect(session.snapshot().capturing).toBe(false)
  })

  test('denied without a screen grant', async () => {
    const session = new MeetingScreenContext({
      workspaceId: 'ws',
      meetingId: 'm1',
      sessionId: 's1',
      actor,
      grants: [],
      now: 1,
      driver: driver([{ id: 'tab-1', kind: 'tab', name: 'Meet', revision: '1' }], {}),
    })
    await session.refreshSources()
    const selected = await session.selectSource({ sourceId: 'tab-1', now: 1 })
    expect(selected.selected).toBeUndefined()
    expect(selected.error).toBeTruthy()
  })

  test('assist consumes the selected-frame snapshot without leaking a closed window', async () => {
    const tab: ScreenSource = { id: 'tab-1', kind: 'tab', name: 'Meet', revision: '1' }
    const other: ScreenSource = { id: 'win-2', kind: 'window', name: 'Secret', revision: '4' }
    const session = new MeetingScreenContext({
      workspaceId: 'ws',
      meetingId: 'm1',
      sessionId: 's1',
      actor,
      grants: [screenGrant],
      now: 1,
      driver: driver([tab, other], {
        'tab-1': { sourceId: 'tab-1', revision: '1', capturedAt: 1, text: 'Agenda: prototype' },
      }),
      closedSourceIds: ['note:ws:secret@2'],
    })
    await session.refreshSources()
    await session.selectSource({ sourceId: 'tab-1', now: 1 })
    const frame = await session.captureFrame({ now: 1 })
    const result = await answerMeetingQuestion({
      question: 'What is the agenda?',
      provider: session.surfaceProvider(),
      surfaceId: `meeting-screen:m1`,
      sessionId: 's1',
      selectedFrame: frame ?? undefined,
      selectedSourceIds: frame ? [frame.sourceId] : [],
      documents: [{ sourceId: 'note:ws:secret@2', revision: '9', text: 'SECRET_PAYLOAD' }],
      closedSourceIds: ['note:ws:secret@2'],
      actor,
      grants: [screenGrant],
      now: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('forbidden-source')
    expect(JSON.stringify(result)).not.toContain('SECRET_PAYLOAD')
  })
})
