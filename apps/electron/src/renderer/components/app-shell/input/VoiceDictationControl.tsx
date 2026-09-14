import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import { appendDictationTranscript, createDictationRequestGuard } from './voice-dictation-state'
import type { VoicePrefs } from '@craft-agent/shared/voice'

interface VoiceDictationControlProps {
  disabled?: boolean
  compactMode?: boolean
  inputValue: string
  sessionId?: string
  onInputChange?: (value: string) => void
}

// Native hotkeys are broadcast to every mounted composer. Claim synchronously so
// retained panels and inline editors cannot start competing microphone captures.
let activeDictationOwner: symbol | null = null

type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function VoiceDictationControl({
  disabled,
  compactMode,
  inputValue,
  sessionId,
  onInputChange,
}: VoiceDictationControlProps) {
  const { t } = useTranslation()
  const appShellContext = useOptionalAppShellContext()
  const isFocusedPanel = appShellContext?.isFocusedPanel ?? true
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const phaseRef = useRef<DictationPhase>('idle')
  const hostRef = useRef<HTMLDivElement>(null)
  const owner = useRef(Symbol('composer-dictation')).current
  const mountedRef = useRef(true)
  const requestGuard = useRef(createDictationRequestGuard()).current
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const latestRef = useRef({ inputValue, onInputChange, sessionId, disabled, isFocusedPanel })
  latestRef.current = { inputValue, onInputChange, sessionId, disabled, isFocusedPanel }

  const updatePhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next
    if (mountedRef.current) setPhase(next)
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const cancel = useCallback(() => {
    requestGuard.cancel()
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      // Unmount/cancel must not run onstop's transcription and edit a stale draft.
      recorder.onstop = null
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stopTracks()
    if (activeDictationOwner === owner) {
      activeDictationOwner = null
      void window.electronAPI.cancelVoiceCapture?.().catch(() => {})
    }
    updatePhase('idle')
  }, [owner, requestGuard, stopTracks, updatePhase])

  const isCurrent = useCallback((request: number) => mountedRef.current
    && activeDictationOwner === owner
    && requestGuard.isCurrent(request, latestRef.current.sessionId), [owner, requestGuard])

  const canStart = useCallback(() => {
    const host = hostRef.current
    if (!mountedRef.current || latestRef.current.disabled || !latestRef.current.isFocusedPanel
      || phaseRef.current !== 'idle' || activeDictationOwner !== null || !host?.isConnected
      || document.hidden || host.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    if (host.getClientRects().length === 0 || getComputedStyle(host).visibility === 'hidden') return false
    const focusedForm = document.activeElement?.closest('form')
    return !focusedForm || focusedForm === host.closest('form')
  }, [])

  const startRecording = useCallback(async () => {
    if (!canStart()) return
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    activeDictationOwner = owner
    const request = requestGuard.begin(latestRef.current.sessionId)
    updatePhase('starting')
    try {
      await window.electronAPI.startVoiceCapture?.()
      if (!isCurrent(request)) return
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: prefs?.selectedInputDeviceId
          ? { deviceId: { exact: prefs.selectedInputDeviceId } }
          : true,
      })
      if (!isCurrent(request)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      await window.electronAPI.grantVoicePermission?.()
      if (!isCurrent(request)) return
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        if (!isCurrent(request)) return
        recorderRef.current = null
        stopTracks()
        updatePhase('transcribing')
        void (async () => {
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
            const audioBase64 = await blobToBase64(blob)
            if (!isCurrent(request)) return
            await window.electronAPI.sendVoiceChunk?.({ audioBase64 })
            if (!isCurrent(request)) return
            await window.electronAPI.stopVoiceCapture?.()
            if (!isCurrent(request)) return
            const result = await window.electronAPI.transcribeVoice({
              audioBase64,
              mimeType: blob.type || 'audio/webm',
            })
            if (!isCurrent(request)) return
            const latest = latestRef.current
            const next = appendDictationTranscript(latest.inputValue, result.text)
            if (next !== latest.inputValue) latest.onInputChange?.(next)
          } catch (error) {
            if (isCurrent(request)) {
              cancel()
              toast.error(error instanceof Error ? error.message : t('chat.dictate'))
            }
          } finally {
            if (isCurrent(request)) {
              activeDictationOwner = null
              updatePhase('idle')
            }
          }
        })()
      }
      recorderRef.current = recorder
      recorder.start()
      updatePhase('recording')
    } catch (error) {
      if (!isCurrent(request)) return
      cancel()
      toast.error(error instanceof Error ? error.message : t('chat.dictate'))
    }
  }, [canStart, owner, requestGuard, updatePhase, isCurrent, prefs?.selectedInputDeviceId, stopTracks, t, cancel])

  const toggle = useCallback(() => {
    if (activeDictationOwner === owner && phaseRef.current === 'recording') {
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
      return
    }
    void startRecording()
  }, [owner, startRecording])
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (!cancelled) setPrefs(next)
    }).catch(() => {})
    const offChanged = window.electronAPI.onVoiceChanged?.((next) => {
      if (!cancelled) setPrefs(next)
    })
    const offJob = window.electronAPI.onVoiceJob?.((job) => {
      if (activeDictationOwner === owner && (job.job === 'cancelled' || job.job === 'failed')) cancel()
    })
    const offHotkey = window.electronAPI.onVoiceHotkey?.((payload) => {
      if (payload.command === 'toggle') toggleRef.current()
      if (payload.command === 'cancel' && activeDictationOwner === owner) cancel()
    })
    return () => {
      cancelled = true
      offChanged?.()
      offJob?.()
      offHotkey?.()
    }
  }, [owner, cancel])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'd' || event.isComposing
        || event.defaultPrevented) return
      if (activeDictationOwner !== owner && !canStart()) return
      event.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [owner, canStart])

  useEffect(() => {
    mountedRef.current = true
    // A retained composer can switch sessions without remounting. Cleanup has
    // already stopped capture while state updates were disabled; reset its UI.
    updatePhase('idle')
    return () => {
      mountedRef.current = false
      cancel()
    }
  }, [cancel, sessionId, updatePhase])

  useEffect(() => {
    if ((!isFocusedPanel || disabled) && activeDictationOwner === owner) cancel()
  }, [isFocusedPanel, disabled, owner, cancel])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && activeDictationOwner === owner) cancel()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [owner, cancel])

  const recording = phase === 'recording'
  const busy = phase === 'starting' || phase === 'transcribing'
  const label = phase === 'starting' ? t('common.loading')
    : phase === 'transcribing' ? t('voice.overlay.transcribing')
    : recording ? t('chat.dictateStop') : t('chat.dictate')

  return (
    <div ref={hostRef} className={cn('flex min-w-0 items-center', compactMode && 'shrink-0')}>
      <FreeFormInputContextBadge
        icon={busy ? <Spinner className="h-4 w-4" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        label={label}
        isExpanded={false}
        showChevron={false}
        onClick={toggle}
        aria-pressed={recording}
        tooltip={busy || recording ? label : t('chat.dictateTooltip')}
        disabled={busy || (disabled && !recording)}
        className={recording ? 'bg-destructive/10 text-destructive' : undefined}
      />
    </div>
  )
}
