/**
 * Global dictation host for hotkeys pressed outside a composer.
 *
 * A mounted composer owns dictation through `VoiceDictationControl`, which
 * listens to the native `voice:hotkey` event itself. When no composer is on
 * screen (empty surfaces, settings, minimized window) that event has no
 * listener, so this host runs the same `voice:*` capture stack and, once the
 * transcript is ready, opens a NEW session with the text as a draft and saves
 * the transcript to the notebook. Nothing is ever auto-sent.
 *
 * The host never competes with a composer: it stands down whenever a visible
 * `[data-voice-dictation-host]` node exists, so the composer keeps its
 * existing behavior (insertion into the current draft).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@rox/ui'
import type { VoicePrefs } from '@rox/shared/voice'
import { Button } from '@/components/ui/button'
import { useMicrophoneLevel } from '@/components/voice/use-microphone-level'
import { VoiceLevelWave } from '@/components/voice/VoiceLevelWave'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useOptionalModalRegistry } from '@/context/ModalContext'
import { useOptionalDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { navigate, routes } from '@/lib/navigate'
import { saveTranscriptToNotebook } from '@/lib/transcripts-notebook'
import { VoiceCommandController } from './command-controller'

/** The host accepts bounded frames; keep long recordings below its decoded limit. */
const CHUNK_BYTES = 1024 * 1024
/** Marker rendered by every mounted composer's dictation control. */
const COMPOSER_HOST_SELECTOR = '[data-voice-dictation-host]'

type Translate = (key: string) => string

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

/** A composer is only "present" when it can actually receive the transcript. */
function composerIsPresent(): boolean {
  const hosts = document.querySelectorAll(COMPOSER_HOST_SELECTOR)
  for (const host of Array.from(hosts)) {
    if (!(host instanceof HTMLElement) || !host.isConnected) continue
    if (host.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    if (host.getClientRects().length === 0) continue
    if (getComputedStyle(host).visibility === 'hidden') continue
    return true
  }
  return false
}

/** Map `getUserMedia`/stream failures to a localized, user-readable message. */
function describeMicError(error: unknown, t: Translate): string {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return t('voice.errors.permissionDenied')
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return t('voice.errors.noDevice')
    case 'NotReadableError':
    case 'TrackStartError':
      return t('voice.errors.busy')
    case 'OverconstrainedError':
      return t('voice.errors.constraint')
    default:
      return error instanceof Error && error.message ? error.message : t('voice.errors.generic')
  }
}

/** Notebook title: first few dictated words, else the localized fallback. */
function buildTranscriptTitle(text: string, fallback: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const words = firstLine.split(/\s+/).slice(0, 6).join(' ')
  return words.slice(0, 60).trim() || fallback
}

async function cancelHostCapture(): Promise<void> {
  try {
    await window.electronAPI.cancelVoiceCapture?.()
  } catch {
    // A revoked grant or disconnected host must not interrupt local cleanup.
  }
}

export function HotkeyDictationHost() {
  const { t } = useTranslation()
  const modals = useOptionalModalRegistry()
  const layers = useOptionalDismissibleLayerRegistry()

  const prefsRef = useRef<VoicePrefs | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [savingConsent, setSavingConsent] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const level = useMicrophoneLevel(audioStream, recording)

  const mountedRef = useRef(true)
  const startingRef = useRef(false)
  const activeRef = useRef(false)
  const hostStartedRef = useRef(false)
  const captureIdRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const nativeRecordingIdRef = useRef<string | null>(null)
  const nativePermissionRef = useRef<{ captureId: number; close: () => void } | null>(null)
  const commandRef = useRef<VoiceCommandController | null>(null)

  const closeNativePermission = useCallback((captureId?: number) => {
    const prompt = nativePermissionRef.current
    if (!prompt || (captureId !== undefined && prompt.captureId !== captureId)) return
    nativePermissionRef.current = null
    prompt.close()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      captureIdRef.current += 1
      closeNativePermission()
      const recorder = recorderRef.current
      recorderRef.current = null
      chunksRef.current = []
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (hostStartedRef.current) void cancelHostCapture()
    }
  }, [closeNativePermission])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setAudioStream(null)
  }, [])

  const isCurrent = useCallback((captureId: number) => (
    mountedRef.current && captureId === captureIdRef.current
  ), [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    const captureId = captureIdRef.current
    setRecording(false)
    stopTracks()
    if (!recorder) return
    setTranscribing(true)
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const audioBase64 = await blobToBase64(blob.slice(offset, offset + CHUNK_BYTES))
        if (!isCurrent(captureId)) return
        await window.electronAPI.sendVoiceChunk?.({ audioBase64 })
      }
      if (!isCurrent(captureId)) return
      const job = await window.electronAPI.stopVoiceCapture?.()
      if (!isCurrent(captureId)) return
      hostStartedRef.current = false
      nativeRecordingIdRef.current = null
      const result = job?.transcript
      if (!result) {
        if (job?.job === 'failed') toast.error(job.error || t('common.errorLoadingContent'))
        return
      }
      const text = result.text.trim()
      if (text) {
        const delivered = prefsRef.current?.trailingSpace ? `${text} ` : text
        try {
          void saveTranscriptToNotebook({
            title: buildTranscriptTitle(text, t('voice.transcriptTitle')),
            text,
            source: 'dictation',
          }).catch(() => { /* Notebook persistence is best-effort. */ })
        } catch {
          // An unavailable notebook module must never break dictation.
        }
        // No auto-send: the transcript lands in the draft of the new session.
        navigate(routes.action.newSession({ input: delivered }))
      } else if (result.noSpeech) {
        toast.error(t('settings.input.voiceNoSpeech'))
      }
    } catch (error) {
      if (isCurrent(captureId)) toast.error(describeMicError(error, t))
    } finally {
      if (isCurrent(captureId)) {
        activeRef.current = false
        setTranscribing(false)
      }
    }
  }, [isCurrent, stopTracks, t])

  const cancelRecording = useCallback(() => {
    closeNativePermission(captureIdRef.current)
    nativeRecordingIdRef.current = null
    captureIdRef.current += 1
    activeRef.current = false
    const hostStarted = hostStartedRef.current
    hostStartedRef.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    setStarting(false)
    setTranscribing(false)
    stopTracks()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (hostStarted) void cancelHostCapture()
  }, [closeNativePermission, stopTracks])

  const cancelRecordingRef = useRef(cancelRecording)
  cancelRecordingRef.current = cancelRecording

  const runCapture = useCallback(async (selectedPrefs: VoicePrefs) => {
    if (startingRef.current || activeRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    startingRef.current = true
    activeRef.current = true
    setStarting(true)
    const captureId = ++captureIdRef.current
    nativeRecordingIdRef.current = null
    let pendingStream: MediaStream | null = null
    try {
      // The OS permission prompt has no DOM layer. Register this capture's
      // ownership before opening it so the provider retains its handoff on blur.
      const id = `voice-hotkey-microphone-${captureId}`
      const cancel = () => { if (captureId === captureIdRef.current) cancelRecordingRef.current() }
      const unregisterModal = modals?.registerModal(id, cancel, 100)
      const unregisterLayer = layers?.registerLayer({ id, type: 'custom', priority: 100, close: cancel })
      nativePermissionRef.current = { captureId, close: () => { unregisterLayer?.(); unregisterModal?.() } }
      try {
        pendingStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedPrefs.selectedInputDeviceId
            ? { deviceId: { exact: selectedPrefs.selectedInputDeviceId } }
            : true,
        })
      } finally {
        closeNativePermission(captureId)
      }
      const stream = pendingStream
      if (!isCurrent(captureId)) {
        stream.getTracks().forEach((track) => track.stop())
        pendingStream = null
        return
      }
      streamRef.current = stream
      setAudioStream(stream)
      pendingStream = null
      const recorder = new MediaRecorder(stream)
      const started = await window.electronAPI.startVoiceCapture?.({ mimeType: recorder.mimeType || 'audio/webm' })
      if (!started?.recordingId) throw new Error(t('settings.input.voiceOffline'))
      if (!isCurrent(captureId)) {
        await cancelHostCapture()
        return
      }
      hostStartedRef.current = true
      nativeRecordingIdRef.current = started.recordingId
      await window.electronAPI.grantVoicePermission?.()
      if (!isCurrent(captureId)) {
        const hostStarted = hostStartedRef.current
        hostStartedRef.current = false
        if (hostStarted) await cancelHostCapture()
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
      setRecording(true)
      recorder.start()
    } catch (error) {
      pendingStream?.getTracks().forEach((track) => track.stop())
      if (isCurrent(captureId)) {
        captureIdRef.current += 1
        activeRef.current = false
        nativeRecordingIdRef.current = null
        setStarting(false)
        setRecording(false)
        stopTracks()
        const hostStarted = hostStartedRef.current
        hostStartedRef.current = false
        if (hostStarted) await cancelHostCapture()
        toast.error(describeMicError(error, t))
      }
    } finally {
      startingRef.current = false
      if (isCurrent(captureId)) setStarting(false)
    }
  }, [closeNativePermission, finishRecording, isCurrent, layers, modals, stopTracks, t])

  const startRecording = useCallback(async () => {
    let selectedPrefs = prefsRef.current
    if (!selectedPrefs) {
      try {
        selectedPrefs = await window.electronAPI.getVoicePrefs?.() ?? null
      } catch {
        selectedPrefs = null
      }
      if (!selectedPrefs) {
        toast.error(t('settings.input.voiceOffline'))
        return
      }
      prefsRef.current = selectedPrefs
    }
    if (selectedPrefs.sttEngine === 'cloud-rox' && (!selectedPrefs.cloudAsrConsent || selectedPrefs.privacyMigrationPending)) {
      setConsentOpen(true)
      return
    }
    await runCapture(selectedPrefs)
  }, [runCapture, t])

  const startRecordingRef = useRef(startRecording)
  startRecordingRef.current = startRecording

  if (!commandRef.current) {
    commandRef.current = new VoiceCommandController({
      disabled: () => false,
      recording: () => recorderRef.current?.state === 'recording',
      active: () => activeRef.current,
      start: () => startRecordingRef.current(),
      stop: () => {
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      },
      cancel: () => cancelRecordingRef.current(),
    })
  }

  const enableCloudTranscription = useCallback(async () => {
    const captureId = captureIdRef.current
    setSavingConsent(true)
    try {
      const next = await window.electronAPI.saveVoicePrefs({ cloudAsrConsent: true, privacyMigrationPending: false, sttEngine: 'cloud-rox' })
      if (captureId !== captureIdRef.current) return
      prefsRef.current = next
      setConsentOpen(false)
      await runCapture(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.errorLoadingContent'))
    } finally {
      if (captureId === captureIdRef.current) setSavingConsent(false)
    }
  }, [runCapture, t])

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (cancelled) return
      prefsRef.current = next
    }).catch(() => {})
    const offChanged = window.electronAPI.onVoiceChanged?.((next) => {
      prefsRef.current = next
    })
    const offJob = window.electronAPI.onVoiceJob?.((job) => {
      // The host cancels on its own (denied microphone, dropped capture).
      if (job.job === 'cancelled' && activeRef.current) {
        cancelRecordingRef.current()
        return
      }
      if (job.job === 'ready' || job.job === 'cancelled' || job.job === 'failed') setRecording(false)
    })
    const offHotkey = window.electronAPI.onVoiceHotkey?.((payload) => {
      if (payload.recordingId !== undefined) {
        // Native overlay (minimized window) stop/cancel for our capture.
        const { recordingId, command } = payload
        if (typeof recordingId !== 'string' || !recordingId || (command !== 'toggle' && command !== 'cancel')) return
        if (recordingId !== nativeRecordingIdRef.current) return
        if (command === 'cancel') cancelRecordingRef.current()
        else if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        return
      }
      // A mounted composer is the authoritative handler — never compete with it.
      if (composerIsPresent()) return
      void commandRef.current?.handle(payload.command)
    })
    return () => {
      cancelled = true
      offChanged?.()
      offJob?.()
      offHotkey?.()
    }
  }, [])

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      cancelRecordingRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording])

  const busy = starting || transcribing
  const visible = recording || busy

  return (
    <>
      {visible && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 py-1.5 pl-3 pr-2 shadow-lg backdrop-blur">
            {transcribing || starting
              ? <Spinner className="h-4 w-4" />
              : <Mic className="h-4 w-4 text-destructive" strokeWidth={1.5} />}
            <span className="text-xs font-medium">
              {transcribing ? t('voice.overlay.transcribing') : t('voice.hotkey.globalRecording')}
            </span>
            {recording && <VoiceLevelWave level={level} active={recording} className="h-4 w-16 shrink-0 text-destructive" />}
            {recording && (
              <>
                <span className="text-[10px] text-muted-foreground">{t('voice.hotkey.globalCancelHint')}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  aria-label={t('chat.dictateStop')}
                  onClick={() => cancelRecordingRef.current()}
                >
                  <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
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
    </>
  )
}