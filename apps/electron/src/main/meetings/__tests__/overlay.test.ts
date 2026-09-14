import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapMeetingOverlayPhase, parseMeetingOverlayState, resolveOverlayDisplay } from '../../../shared/meeting-overlay-ipc'
import {
  destroyMeetingOverlay,
  dispatchMeetingOverlayCommand,
  flushMeetingOverlayAssist,
  hideMeetingOverlay,
  openMeetingOverlay,
  rebindMeetingHotkeys,
  setMeetingOverlayAssistContext,
  setMeetingStopHandler,
  stopMeetingFromHost,
  type MeetingOverlayRuntime,
  type MeetingOverlayWindow,
} from '../overlay.ts'

const overlaySrc = readFileSync(join(import.meta.dir, '../overlay.ts'), 'utf8')
const hostSrc = readFileSync(join(import.meta.dir, '../../voice-overlay.ts'), 'utf8')
const uiSrc = readFileSync(join(import.meta.dir, '../../../renderer/voice-overlay.tsx'), 'utf8')

function fakeWindow(): MeetingOverlayWindow {
  return {
    showInactive() {},
    hide() {},
    setSize() {},
    setPosition() {},
    setContentProtection() {},
  }
}

function runtime(): MeetingOverlayRuntime {
  let win: MeetingOverlayWindow | null = null
  return {
    rebindHotkeys: () => ({ ok: true }),
    displays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } }],
    overlayPosition: 'top',
    ensureWindow: async () => {
      const reused = win !== null
      win ??= fakeWindow()
      return { reused, window: win }
    },
  }
}

describe('meeting overlay (issue 369)', () => {
  afterEach(() => {
    destroyMeetingOverlay()
  })

  test('reuses the voice overlay host and does not steal focus', () => {
    expect(overlaySrc).toContain('showInactive')
    expect(overlaySrc).toContain('ensureVoiceOverlayWindow')
    expect(overlaySrc).not.toContain('new BrowserWindow')
    expect(overlaySrc).not.toContain('.show()')
    expect(overlaySrc).not.toContain('.focus(')
    expect(hostSrc).toContain('focusable: false')
    expect(hostSrc).toContain('skipTaskbar: true')
    expect(hostSrc).toContain('showInactive')
    expect(uiSrc).toContain('data-testid="meeting-pause"')
    expect(uiSrc).toContain('data-testid="meeting-stop"')
    expect(uiSrc).toContain("t('meetings.overlayError')")
    expect(uiSrc).not.toContain('meetings.ready')
    expect(uiSrc).toContain("t('chat.dictate')")
  })

  test('lifecycle hides, shows again, and duplicate open reuses the host', async () => {
    const host = runtime()
    const first = await openMeetingOverlay({ visible: true, phase: 'recording' }, host)
    expect(first.reused).toBe(false)
    expect(first.visible).toBe(true)
    const hidden = await hideMeetingOverlay(host)
    expect(hidden.visible).toBe(false)
    const second = await openMeetingOverlay({ visible: true, phase: 'recording' }, host)
    expect(second.reused).toBe(true)
    expect(second.visible).toBe(true)
    const third = await openMeetingOverlay({ visible: true, phase: 'paused' }, host)
    expect(third.reused).toBe(true)
  })

  test('error is not mapped to ready and does not invent a transcript', () => {
    expect(mapMeetingOverlayPhase({ error: 'dead-mic', phase: 'recording' })).toBe('error')
    expect(mapMeetingOverlayPhase({ phase: 'ready' })).toBe('idle')
    const parsed = parseMeetingOverlayState({
      error: 'dead-mic',
      phase: 'ready',
      recording: true,
      text: 'should-not-leak',
      liveTranscript: 'частичный текст',
    })
    expect(parsed.phase).toBe('error')
    expect(parsed.recording).toBe(false)
    expect(parsed.liveTranscript).toBe('частичный текст')
    expect(parsed).not.toHaveProperty('ready')
  })

  test('hotkey conflict is reported and does not bind', () => {
    expect(rebindMeetingHotkeys({
      hotkeyToggle: 'CommandOrControl+H',
      hotkeyCancel: 'CommandOrControl+Shift+Escape',
    })).toEqual({ ok: false, conflict: 'CommandOrControl+H' })
    expect(rebindMeetingHotkeys({
      hotkeyToggle: 'CommandOrControl+Shift+D',
      hotkeyCancel: 'CommandOrControl+Shift+D',
    }).ok).toBe(false)
    expect(rebindMeetingHotkeys({
      hotkeyToggle: 'CommandOrControl+Shift+D',
      hotkeyCancel: 'CommandOrControl+Shift+Escape',
    })).toEqual({ ok: true })
  })

  test('pause/stop/ask/catch-up stay available after overlay failure', async () => {
    let stopped = 0
    setMeetingStopHandler(() => { stopped += 1 })
    await openMeetingOverlay({ visible: true, phase: 'recording' }, runtime())
    expect(dispatchMeetingOverlayCommand('pause').phase).toBe('paused')
    expect(dispatchMeetingOverlayCommand('ask').phase).toBe('ask')
    expect(dispatchMeetingOverlayCommand('catch-up').phase).toBe('catch-up')
    destroyMeetingOverlay()
    stopMeetingFromHost()
    expect(stopped).toBe(2)
    expect(stopMeetingFromHost().phase).toBe('stopped')
  })

  test('ask and catch-up call answerMeetingQuestion instead of only setting phase', async () => {
    await openMeetingOverlay({ visible: true, phase: 'recording' }, runtime())
    setMeetingOverlayAssistContext({
      transcript: [
        { sourceId: 'seg:final', revision: '1', text: 'Решили запустить прототип.', final: true },
        { sourceId: 'seg:partial', revision: '2', text: 'может быть бюджет...', final: false },
      ],
    })
    expect(dispatchMeetingOverlayCommand('ask').phase).toBe('ask')
    const asked = await flushMeetingOverlayAssist()
    expect(asked.liveTranscript).toContain('прототип')
    expect(asked.phase).not.toBe('error')
    expect(asked.phase).not.toBe('ready')
    expect(dispatchMeetingOverlayCommand('catch-up').phase).toBe('catch-up')
    const caught = await flushMeetingOverlayAssist()
    expect(caught.liveTranscript).toContain('прототип')
    expect(caught.liveTranscript).not.toContain('бюджет')
  })

  test('monitor disconnect falls back to the remaining display', () => {
    const fallback = resolveOverlayDisplay({
      displays: [{ id: 2, workArea: { x: 0, y: 0, width: 800, height: 600 } }],
      lastDisplayId: 99,
    })
    expect(fallback?.id).toBe(2)
    expect(resolveOverlayDisplay({ displays: [], lastDisplayId: 1 })).toBeNull()
  })
})
