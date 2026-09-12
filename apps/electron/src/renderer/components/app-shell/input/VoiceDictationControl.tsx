import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import type { VoicePrefs } from '@craft-agent/shared/voice'

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
  const [draft, setDraft] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (!cancelled) setPrefs(next)
    }).catch(() => {})
    const off = window.electronAPI.onVoiceChanged?.((next) => setPrefs(next))
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    stopTracks()
    if (!recorder) return
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    try {
      const audioBase64 = await blobToBase64(blob)
      const result = await window.electronAPI.transcribeVoice({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
        transcript: draft || undefined,
      })
      const text = result.text.trim()
      setDraft(text)
      if (text) onInputChange?.(inputValue ? `${inputValue} ${text}` : text)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.dictate'))
    }
  }, [draft, inputValue, onInputChange, stopTracks, t])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t('settings.input.voiceOffline'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: prefs?.selectedInputDeviceId
          ? { deviceId: { exact: prefs.selectedInputDeviceId } }
          : true,
      })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void finishRecording()
      }
      recorderRef.current = recorder
      setDraft('')
      setRecording(true)
      recorder.start()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.dictate'))
    }
  }, [finishRecording, prefs?.selectedInputDeviceId, t])

  const toggle = useCallback(() => {
    if (disabled) return
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    void startRecording()
  }, [disabled, recording, startRecording])

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
    recorderRef.current?.stop()
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
        tooltip={t('chat.dictateTooltip')}
        disabled={disabled}
      />
    </div>
  )
}
