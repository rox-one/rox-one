import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { VoiceCommandController } from '../../../voice/command-controller'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
  const [transcribing, setTranscribing] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [savingConsent, setSavingConsent] = useState(false)
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
  const latestInputRef = useRef({ inputValue, onInputChange })
  latestInputRef.current = { inputValue, onInputChange }

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
    setTranscribing(true)
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
      const result = job?.transcript
      if (!result) {
        if (job?.job === 'failed') toast.error(job.error || t('common.errorLoadingContent'))
        return
      }
      if (result.resolvedModelId && result.requestedModelId) {
        setModelEvidence(t('settings.input.voiceActualModel', {
          engine: prefs?.sttEngine ?? 'cloud-rox',
          requested: result.requestedModelId,
          resolved: result.resolvedModelId,
        }))
      }
      const text = result.text.trim()
      if (text) {
        const latest = latestInputRef.current
        latest.onInputChange?.(latest.inputValue ? `${latest.inputValue} ${text}` : text)
      }
      else if (result.noSpeech) toast.error(t('settings.input.voiceNoSpeech'))
    } catch (error) {
      if (captureId === captureIdRef.current) {
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    } finally {
      if (captureId === captureIdRef.current) {
        activeRequestRef.current = false
        setTranscribing(false)
      }
    }
  }, [prefs?.sttEngine, stopTracks, t])

  const cancelRecording = useCallback(() => {
    captureIdRef.current += 1
    activeRequestRef.current = false
    const hostStarted = hostStartedRef.current
    hostStartedRef.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    setTranscribing(false)
    stopTracks()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (hostStarted) void window.electronAPI.cancelVoiceCapture?.()
  }, [stopTracks])

  const cancelRecordingRef = useRef(cancelRecording)
  cancelRecordingRef.current = cancelRecording

  const startRecording = useCallback(async (selectedPrefs = prefs) => {
    if (!selectedPrefs) return
    if (selectedPrefs.sttEngine === 'cloud-rox' && (!selectedPrefs.cloudAsrConsent || selectedPrefs.privacyMigrationPending)) {
      setConsentOpen(true)
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
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: selectedPrefs.selectedInputDeviceId
          ? { deviceId: { exact: selectedPrefs.selectedInputDeviceId } }
          : true,
      })
      const stream = pendingStream
      if (captureId !== captureIdRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        pendingStream = null
        return
      }
      // Keep acquired tracks reachable while START and permission are pending,
      // so releasing push-to-talk closes the microphone immediately.
      streamRef.current = stream
      pendingStream = null
      const recorder = new MediaRecorder(stream)
      const started = await window.electronAPI.startVoiceCapture?.({ mimeType: recorder.mimeType || 'audio/webm' })
      if (!started?.recordingId) throw new Error(t('settings.input.voiceOffline'))
      if (captureId !== captureIdRef.current) {
        await window.electronAPI.cancelVoiceCapture?.()
        return
      }
      hostStartedRef.current = true
      await window.electronAPI.grantVoicePermission?.()
      if (captureId !== captureIdRef.current) {
        if (hostStartedRef.current) await window.electronAPI.cancelVoiceCapture?.()
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
      setRecording(true)
      recorder.start()
    } catch (error) {
      pendingStream?.getTracks().forEach((track) => track.stop())
      if (captureId === captureIdRef.current) {
        stopTracks()
        captureIdRef.current += 1
        activeRequestRef.current = false
        const hostStarted = hostStartedRef.current
        hostStartedRef.current = false
        if (hostStarted) await window.electronAPI.cancelVoiceCapture?.()
        toast.error(error instanceof Error ? error.message : t('chat.dictate'))
      }
    }
  }, [finishRecording, prefs, stopTracks, t])

  const enableCloudTranscription = useCallback(async () => {
    const captureId = captureIdRef.current
    setSavingConsent(true)
    try {
      const next = await window.electronAPI.saveVoicePrefs({ cloudAsrConsent: true, privacyMigrationPending: false, sttEngine: 'cloud-rox' })
      if (captureId !== captureIdRef.current) return
      setPrefs(next)
      setConsentOpen(false)
      await startRecording(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.errorLoadingContent'))
    } finally { if (captureId === captureIdRef.current) setSavingConsent(false) }
  }, [startRecording, t])

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
        disabled={disabled || !prefs || transcribing}
      />
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
    </div>
  )
}
