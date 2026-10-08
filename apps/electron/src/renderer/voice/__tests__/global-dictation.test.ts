import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const modulePath = join(__dirname, '../global-dictation.tsx')
const appShellPath = join(__dirname, '../../components/app-shell/AppShell.tsx')

const source = readFileSync(modulePath, 'utf8')
const appShellSource = readFileSync(appShellPath, 'utf8')

// Sibling slices write these in parallel; the pure-helper import only runs once
// every dependency module exists (importing the .tsx otherwise fails to resolve).
const depsPresent = existsSync(join(__dirname, '../../lib/voice/level-meter.ts'))
  && existsSync(join(__dirname, '../dictation-ownership.ts'))
  && existsSync(join(__dirname, '../../lib/transcripts/notes.ts'))

describe('global voice dictation wiring', () => {
  it('yields to the composer on every command and hotkey path', () => {
    expect(source).toContain('activeComposerPresent')
    expect(source).toContain('shouldYieldDictation({ composerPresent: activeComposerPresent()')
    expect(source).toContain('createVoiceLevelMeter')
  })

  it('claims and releases dictation ownership through the shared module', () => {
    expect(source).toContain('claimDictation(owner)')
    expect(source).toContain('releaseDictation(owner)')
    expect(source).toContain("setDictationIntent(owner, { source: 'global', delivery: 'draft' })")
  })

  it('subscribes to the shared voice hotkey event and the local accelerator', () => {
    expect(source).toContain('window.electronAPI.onVoiceHotkey?.')
    expect(source).toContain("event.key.toLowerCase() !== 'd'")
    expect(source).toContain('window.electronAPI.getVoicePrefs?.()')
  })

  it('orders the proven capture sequence', () => {
    const getUserMedia = source.indexOf('navigator.mediaDevices.getUserMedia(')
    const recorder = source.indexOf('new MediaRecorder(stream)')
    const startCapture = source.indexOf('startVoiceCapture?.(')
    const grant = source.indexOf('grantVoicePermission?.(')
    const start = source.indexOf('recorder.start()')
    expect(getUserMedia).toBeGreaterThanOrEqual(0)
    expect(recorder).toBeGreaterThan(getUserMedia)
    expect(startCapture).toBeGreaterThan(recorder)
    expect(grant).toBeGreaterThan(startCapture)
    expect(start).toBeGreaterThan(grant)
    expect(source).toContain('blobToBase64')
    expect(source).toContain('window.electronAPI.sendVoiceChunk?.(')
    expect(source).toContain('window.electronAPI.stopVoiceCapture?.()')
  })

  it('publishes the mic level the mini-overlay window renders, including a zero reset', () => {
    expect(source).toContain('window.electronAPI.publishVoiceLevel?.(level)')
    expect(source).toContain('window.electronAPI.publishVoiceLevel?.(0)')
  })

  it('drops the finished transcript into a new-session draft and files it as a global transcript', () => {
    expect(source).toContain('routes.action.newSession({ input: text, send: false })')
    expect(source).toContain("{ newPanel: true, targetLaneId: 'main' }")
    expect(source).toContain('recordTranscript({')
    expect(source).toContain("source: 'global'")
    expect(source).toContain('windowWorkspaceIdAtom')
  })

  it('reuses the composer consent gate and no-speech copy', () => {
    expect(source).toContain("selectedPrefs.sttEngine === 'cloud-rox'")
    expect(source).toContain('cloudAsrConsent')
    expect(source).toContain('privacyMigrationPending')
    expect(source).toContain("t('meetings.local.enableDeepgram')")
    expect(source).toContain("t('meetings.local.deepgramConsent')")
    expect(source).toContain("t('settings.input.voiceNoSpeech')")
  })

  it('keeps user-cancelled captures free of error toasts', () => {
    // Capture failures are fenced behind isCurrentCapture; a deliberate cancel
    // bumps captureIdRef, so the guard suppresses the toast.
    expect(source).toContain("if (isCurrentCapture(captureId)) {\n        toast.error(error instanceof Error ? error.message : t('chat.dictate'))")
    const cancelStart = source.indexOf('const cancelRecording = useCallback')
    const cancelEnd = source.indexOf('cancelRecordingRef.current = cancelRecording')
    expect(cancelStart).toBeGreaterThanOrEqual(0)
    expect(cancelEnd).toBeGreaterThan(cancelStart)
    expect(source.slice(cancelStart, cancelEnd)).not.toContain('toast.error')
  })

  it('exports the null-rendering component and mounts it in AppShell', () => {
    expect(source).toContain('export function GlobalVoiceDictation(): React.ReactElement | null')
    expect(source).toContain('if (!consentOpen) return null')
    expect(appShellSource).toContain('import { GlobalVoiceDictation } from "@/voice/global-dictation"')
    expect(appShellSource).toContain('<GlobalVoiceDictation />')
  })
})

if (depsPresent) {
  // Static import cannot work here: this slice is written before sibling
  // dependency modules exist, so the module is loaded only once resolvable.
  const { shouldYieldDictation } = await import('../global-dictation')
  describe('shouldYieldDictation', () => {
    const owner = {}

    it('yields whenever a composer is present, even when it owns the capture', () => {
      expect(shouldYieldDictation({ composerPresent: true, activeOwner: owner, ownOwner: owner })).toBe(true)
      expect(shouldYieldDictation({ composerPresent: true, activeOwner: null, ownOwner: owner })).toBe(true)
    })

    it('yields to a different active owner', () => {
      expect(shouldYieldDictation({ composerPresent: false, activeOwner: {}, ownOwner: owner })).toBe(true)
    })

    it('keeps control when idle or when it is the active owner', () => {
      expect(shouldYieldDictation({ composerPresent: false, activeOwner: null, ownOwner: owner })).toBe(false)
      expect(shouldYieldDictation({ composerPresent: false, activeOwner: owner, ownOwner: owner })).toBe(false)
    })
  })
} else {
  describe('shouldYieldDictation', () => {
    it.skip('pure ownership helper (sibling dependency modules not written yet)', () => {})
  })
}