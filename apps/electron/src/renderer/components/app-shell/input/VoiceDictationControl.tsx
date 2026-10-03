import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { VoiceCommandController } from '../../../voice/command-controller'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import type { VoicePrefs } from '@rox/shared/voice'

interface VoiceDictationControlProps {
  disabled?: boolean
  compactMode?: boolean
  inputValue: string
  onInputChange?: (value: string) => void
}

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
  onInputChange,
}: VoiceDictationControlProps) {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [recording, setRecording] = useState(false)
  const [modelEvidence, setModelEvidence] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const captureIdRef = useRef(0)
  const activeRequestRef = useRef(false)
  const hostStartedRef = useRef(false)
  const commandRef = useRef<VoiceCommandController | null>(null)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (!cancelled) setPrefs(next)
    }).catch(() => {})
    const offChanged = window.electronAPI.onVoiceChanged?.((next) => setPrefs(next))
    const offJob = window.electronAPI.onVoiceJob?.((job) => {
      if (job.job === 'ready' || job.job === 'cancelled' || job.job === 'failed') setRecording(false)
    })
    const offHotkey = window.electronAPI.onVoiceHotkey?.((payload) => {
      void commandRef.current?.handle(payload.command)
    })
    return () => {
      cancelled = true
      captureIdRef.current += 1
      offChanged?.()
      offJob?.()
      offHotkey?.()
    }
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    const captureId = captureIdRef.current
    setRecording(false)
    stopTracks()
    if (!recorder) return
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    try {
      const audioBase64 = await blobToBase64(blob)
      if (captureId !== captureIdRef.current) return
      await window.electronAPI.sendVoiceChunk?.({ audioBase64 })
      if (captureId !== captureIdRef.current) return
      const job = await window.electronAPI.stopVoiceCapture?.()
      if (captureId !== captureIdRef.current) return
      hostStartedRef.current = false
      const result = await window.electronAPI.transcribeVoice({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
      })
      if (captureId !== captureIdRef.current) return
      if (result.resolvedModelId && result.requestedModelId) {
        setModelEvidence(t('settings.input.voiceActualModel', {
          engine: result.engine,
          requested: result.requestedModelId,
          resolved: result.resolvedModelId,
        }))
      }
      const text = result.text.trim()
      if (text) onInputChange?.(inputValue ? `${inputValue} ${text}` : text)
      else if (result.noSpeech) toast.error(t('settings.input.voiceNoSpeech'))
      void job
    } catch (error) {
      if (captureId === captureIdRef.current) {
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    } finally {
      if (captureId === captureIdRef.current) activeRequestRef.current = false
    }
  }, [inputValue, onInputChange, stopTracks, t])

  const cancelRecording = useCallback(() => {
    captureIdRef.current += 1
    activeRequestRef.current = false
    const hostStarted = hostStartedRef.current
    hostStartedRef.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    stopTracks()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (hostStarted) void window.electronAPI.cancelVoiceCapture?.()
  }, [stopTracks])

  const cancelRecordingRef = useRef(cancelRecording)
  cancelRecordingRef.current = cancelRecording

  const startRecording = useCallback(async () => {
    if (!prefs) {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    if (prefs?.sttEngine === 'cloud-rox' && !prefs.cloudAsrConsent) {
      toast.error(t('settings.input.voiceAsrConsentDesc'))
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    const captureId = ++captureIdRef.current
    activeRequestRef.current = true
    let pendingStream: MediaStream | null = null
    try {
      const started = await window.electronAPI.startVoiceCapture?.()
      if (!started?.recordingId) throw new Error(t('settings.input.voiceOffline'))
      if (captureId !== captureIdRef.current) {
        await window.electronAPI.cancelVoiceCapture?.()
        return
      }
      hostStartedRef.current = true
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: prefs?.selectedInputDeviceId
          ? { deviceId: { exact: prefs.selectedInputDeviceId } }
          : true,
      })
      const stream = pendingStream
      if (captureId !== captureIdRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        pendingStream = null
        await window.electronAPI.cancelVoiceCapture?.()
        hostStartedRef.current = false
        return
      }
      await window.electronAPI.grantVoicePermission?.()
      if (captureId !== captureIdRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        pendingStream = null
        if (hostStartedRef.current) await window.electronAPI.cancelVoiceCapture?.()
        hostStartedRef.current = false
        return
      }
      streamRef.current = stream
      pendingStream = null
      const recorder = new MediaRecorder(stream)
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
      if (captureId === captureIdRef.current) {
        captureIdRef.current += 1
        activeRequestRef.current = false
        const hostStarted = hostStartedRef.current
        hostStartedRef.current = false
        if (hostStarted) await window.electronAPI.cancelVoiceCapture?.()
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    }
  }, [finishRecording, prefs, t])

  const startRecordingRef = useRef(startRecording)
  startRecordingRef.current = startRecording
  if (!commandRef.current) {
    commandRef.current = new VoiceCommandController({
      disabled: () => Boolean(disabledRef.current),
      recording: () => recorderRef.current?.state === 'recording',
      active: () => activeRequestRef.current,
      start: () => startRecordingRef.current(),
      stop: () => recorderRef.current?.stop(),
      cancel: () => cancelRecordingRef.current(),
    })
  }

  const toggle = useCallback(() => {
    void commandRef.current?.handle('toggle')
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'd') return
      if (event.defaultPrevented) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  useEffect(() => () => {
    void commandRef.current?.handle('cancel')
    captureIdRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stopTracks()
  }, [stopTracks])

  const label = recording ? t('chat.dictateStop') : t('chat.dictate')

  return (
    <div className={cn('flex items-center', compactMode && 'shrink-0')}>
      <FreeFormInputContextBadge
        icon={recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        label={label}
        isExpanded={false}
        hasSelection={recording}
        showChevron={false}
        onClick={toggle}
        tooltip={modelEvidence ? `${t('chat.dictateTooltip')} · ${modelEvidence}` : t('chat.dictateTooltip')}
        disabled={disabled}
      />
    </div>
  )
}
