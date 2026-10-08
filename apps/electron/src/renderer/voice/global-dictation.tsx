import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isMac } from '@/lib/platform'
import { navigate, routes } from '@/lib/navigate'
import { createVoiceLevelMeter } from '@/lib/voice/level-meter'
import { recordTranscript } from '@/lib/transcripts/notes'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import type { VoicePrefs } from '@rox/shared/voice'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import {
  claimDictation,
  currentOwner,
  isComposerPresent,
  releaseDictation,
  setDictationIntent,
} from './dictation-ownership'
import type { DictationOwner } from './dictation-ownership'

function blobToBase64(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result ?? '')
    const comma = result.indexOf(',')
    resolve(comma >= 0 ? result.slice(comma + 1) : result)
  }
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
  return promise
}

async function cancelHostCapture(): Promise<void> {
  try {
    await window.electronAPI.cancelVoiceCapture?.()
  } catch {
    // A revoked grant or disconnected host must not interrupt local cleanup.
  }
}

/**
 * The composer control always wins: when it is mounted (or another dictation
 * owner is active) global dictation must stay completely inert.
 */
export interface DictationYieldState {
  composerPresent: boolean
  activeOwner: DictationOwner | null
  ownOwner: DictationOwner
}

export function shouldYieldDictation(state: DictationYieldState): boolean {
  return state.composerPresent || (state.activeOwner !== null && state.activeOwner !== state.ownOwner)
}

/**
 * Fallback dictation path used when no composer owns the microphone: the voice
 * hotkey records, then drops the finished transcript into a brand-new session
 * draft. The mini-overlay window renders the live wave from
 * `publishVoiceLevel` — the composer publishes the same channel when it owns.
 *
 * Renders nothing unless the cloud-consent dialog is open.
 */
export function GlobalVoiceDictation(): React.ReactElement | null {
  const { t } = useTranslation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const owner = useRef<DictationOwner>({}).current

  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [savingConsent, setSavingConsent] = useState(false)

  const mountedRef = useRef(true)
  const startingRef = useRef(false)
  const activeRequestRef = useRef(false)
  const hostStartedRef = useRef(false)
  const captureIdRef = useRef(0)
  const nativeRecordingIdRef = useRef<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const levelMeterRef = useRef<{ stop(): void } | null>(null)
  const prefsRef = useRef<VoicePrefs | null>(null)
  const workspaceIdRef = useRef<string | null>(workspaceId)
  const startRecordingRef = useRef<(selectedPrefs?: VoicePrefs | null) => Promise<void>>(async () => {})
  const cancelRecordingRef = useRef<() => void>(() => {})
  const commandRef = useRef<(command: HotkeyCommand) => Promise<void>>(async () => {})

  prefsRef.current = prefs
  workspaceIdRef.current = workspaceId

  const stopTracks = useCallback(() => {
    levelMeterRef.current?.stop()
    levelMeterRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    window.electronAPI.publishVoiceLevel?.(0)
  }, [])

  const isCurrentCapture = useCallback((captureId: number) => (
    mountedRef.current && currentOwner() === owner && captureId === captureIdRef.current
  ), [owner])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    const captureId = captureIdRef.current
    stopTracks()
    if (!recorder) return
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    try {
      // The host accepts bounded frames; keep long recordings below its decoded
      // chunk limit without changing the single-transcription flow.
      const frameBytes = 1024 * 1024
      for (let offset = 0; offset < blob.size; offset += frameBytes) {
        const audioBase64 = await blobToBase64(blob.slice(offset, offset + frameBytes))
        if (!isCurrentCapture(captureId)) return
        await window.electronAPI.sendVoiceChunk?.({ audioBase64 })
      }
      if (!isCurrentCapture(captureId)) return
      const job = await window.electronAPI.stopVoiceCapture?.()
      if (!isCurrentCapture(captureId)) return
      hostStartedRef.current = false
      const result = job?.transcript
      if (!result) {
        if (job?.job === 'failed') toast.error(job.error || t('common.errorLoadingContent'))
        return
      }
      const text = result.text.trim()
      if (text) {
        setDictationIntent(owner, { source: 'global', delivery: 'draft' })
        navigate(
          routes.action.newSession({ input: text, send: false }),
          { newPanel: true, targetLaneId: 'main' },
        )
        const activeWorkspaceId = workspaceIdRef.current
        if (activeWorkspaceId) {
          void recordTranscript({
            workspaceId: activeWorkspaceId,
            text,
            source: 'global',
            language: result.detectedLanguage,
            model: result.resolvedModelId ?? result.requestedModelId,
            durationMs: result.durationMs,
          }).then((outcome) => {
            if (!outcome.ok && outcome.error) toast.error(outcome.error)
          }).catch(() => {
            // recordTranscript never throws; keep the draft even if filing fails.
          })
        }
      } else if (result.noSpeech) {
        toast.error(t('settings.input.voiceNoSpeech'))
      }
    } catch (error) {
      if (isCurrentCapture(captureId)) {
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    } finally {
      if (isCurrentCapture(captureId)) {
        nativeRecordingIdRef.current = null
        activeRequestRef.current = false
      }
      if (currentOwner() === owner) releaseDictation(owner)
    }
  }, [isCurrentCapture, owner, stopTracks, t])

  const cancelRecording = useCallback(() => {
    if (currentOwner() === owner) releaseDictation(owner)
    nativeRecordingIdRef.current = null
    captureIdRef.current += 1
    activeRequestRef.current = false
    const hostStarted = hostStartedRef.current
    hostStartedRef.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    stopTracks()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (hostStarted) void cancelHostCapture()
  }, [owner, stopTracks])
  cancelRecordingRef.current = cancelRecording

  const startRecording = useCallback(async (selectedPrefs: VoicePrefs | null = prefsRef.current) => {
    if (!mountedRef.current || startingRef.current) return
    if (shouldYieldDictation({ composerPresent: isComposerPresent(), activeOwner: currentOwner(), ownOwner: owner })) return
    if (!selectedPrefs) return
    if (selectedPrefs.sttEngine === 'cloud-rox' && (!selectedPrefs.cloudAsrConsent || selectedPrefs.privacyMigrationPending)) {
      setConsentOpen(true)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    if (!claimDictation(owner)) return
    setDictationIntent(owner, { source: 'global', delivery: 'draft' })
    startingRef.current = true
    const captureId = ++captureIdRef.current
    nativeRecordingIdRef.current = null
    activeRequestRef.current = true
    let pendingStream: MediaStream | null = null
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: selectedPrefs.selectedInputDeviceId
          ? { deviceId: { exact: selectedPrefs.selectedInputDeviceId } }
          : true,
      })
      const stream = pendingStream
      if (!isCurrentCapture(captureId)) {
        stream.getTracks().forEach((track) => track.stop())
        pendingStream = null
        return
      }
      pendingStream = null
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const started = await window.electronAPI.startVoiceCapture?.({ mimeType: recorder.mimeType || 'audio/webm' })
      if (!started?.recordingId) throw new Error(t('settings.input.voiceOffline'))
      if (!isCurrentCapture(captureId)) {
        await cancelHostCapture()
        return
      }
      hostStartedRef.current = true
      nativeRecordingIdRef.current = started.recordingId
      await window.electronAPI.grantVoicePermission?.()
      if (!isCurrentCapture(captureId)) {
        if (hostStartedRef.current) await cancelHostCapture()
        hostStartedRef.current = false
        return
      }
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return
        void finishRecording()
      }
      recorderRef.current = recorder
      recorder.start()
      levelMeterRef.current = createVoiceLevelMeter(stream, (level) => window.electronAPI.publishVoiceLevel?.(level), { driver: 'frame' })
    } catch (error) {
      pendingStream?.getTracks().forEach((track) => track.stop())
      if (isCurrentCapture(captureId)) {
        stopTracks()
        nativeRecordingIdRef.current = null
        captureIdRef.current += 1
        activeRequestRef.current = false
        const hostStarted = hostStartedRef.current
        hostStartedRef.current = false
        if (hostStarted) await cancelHostCapture()
        if (currentOwner() === owner) releaseDictation(owner)
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    } finally {
      startingRef.current = false
    }
  }, [finishRecording, isCurrentCapture, owner, stopTracks, t])
  startRecordingRef.current = startRecording

  const enableCloudTranscription = useCallback(async () => {
    setSavingConsent(true)
    try {
      const next = await window.electronAPI.saveVoicePrefs({ cloudAsrConsent: true, privacyMigrationPending: false, sttEngine: 'cloud-rox' })
      if (!mountedRef.current) return
      setPrefs(next)
      setConsentOpen(false)
      await startRecordingRef.current(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.errorLoadingContent'))
    } finally {
      if (mountedRef.current) setSavingConsent(false)
    }
  }, [t])

  const handleCommand = useCallback(async (command: HotkeyCommand) => {
    if (!mountedRef.current) return
    if (shouldYieldDictation({ composerPresent: isComposerPresent(), activeOwner: currentOwner(), ownOwner: owner })) return
    if (command === 'cancel') {
      cancelRecordingRef.current()
      return
    }
    if (command === 'ptt-up') {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      return
    }
    if (command === 'ptt-down') {
      if (recorderRef.current || activeRequestRef.current) return
      await startRecordingRef.current()
      return
    }
    if (command === 'toggle') {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
        return
      }
      if (activeRequestRef.current) {
        cancelRecordingRef.current()
        return
      }
      await startRecordingRef.current()
    }
  }, [owner])
  commandRef.current = handleCommand

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (!cancelled) setPrefs(next)
    }).catch(() => {})
    const offChanged = window.electronAPI.onVoiceChanged?.((next) => setPrefs(next))
    const offHotkey = window.electronAPI.onVoiceHotkey?.((payload) => {
      if (payload.recordingId !== undefined) {
        // Commands bound to a native capture only apply to our own recording.
        if (!nativeRecordingIdRef.current || payload.recordingId !== nativeRecordingIdRef.current) return
        if (payload.command === 'cancel') cancelRecordingRef.current()
        else if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        return
      }
      void commandRef.current(payload.command)
    })
    return () => {
      cancelled = true
      offChanged?.()
      offHotkey?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'd' || event.isComposing) return
      if (event.defaultPrevented) return
      // The composer control binds the same accelerator when it is mounted.
      if (shouldYieldDictation({ composerPresent: isComposerPresent(), activeOwner: currentOwner(), ownOwner: owner })) return
      event.preventDefault()
      void commandRef.current('toggle')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [owner])

  // Minimizing or occluding the window must never abort a recording: the wave
  // keeps running in the owned mini-overlay (see level-meter's watchdog).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (currentOwner() === owner) releaseDictation(owner)
      captureIdRef.current += 1
      const hostStarted = hostStartedRef.current
      hostStartedRef.current = false
      const recorder = recorderRef.current
      recorderRef.current = null
      chunksRef.current = []
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stopTracks()
      startingRef.current = false
      activeRequestRef.current = false
      if (hostStarted) void cancelHostCapture()
    }
  }, [owner, stopTracks])

  if (!consentOpen) return null
  return (
    <Dialog open={consentOpen} onOpenChange={(open) => { if (!savingConsent) setConsentOpen(open) }}>
      <DialogContent showCloseButton={!savingConsent}>
        <DialogHeader>
          <DialogTitle>{t('meetings.local.enableDeepgram')}</DialogTitle>
          <DialogDescription>{t('meetings.local.deepgramConsent')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={savingConsent} onClick={() => setConsentOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={savingConsent} onClick={() => void enableCloudTranscription()}>
            {t(savingConsent ? 'common.loading' : 'meetings.local.enableDeepgram')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}