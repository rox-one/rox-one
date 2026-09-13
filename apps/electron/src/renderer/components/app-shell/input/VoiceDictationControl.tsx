import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import type { VoicePrefs } from '@craft-agent/shared/voice'
import { joinDraftTranscript } from '@craft-agent/shared/voice'
import { voiceCaptureSession } from '@/voice/capture-session'

interface VoiceDictationControlProps {
  disabled?: boolean
  compactMode?: boolean
  inputValue: string
  onInputChange?: (value: string) => void
}

export function VoiceDictationControl({
  disabled,
  compactMode,
  inputValue,
  onInputChange,
}: VoiceDictationControlProps) {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [recording, setRecording] = useState(voiceCaptureSession.getState().recording)
  const [busy, setBusy] = useState(voiceCaptureSession.getState().busy)
  const inputRef = useRef(inputValue)
  inputRef.current = inputValue
  const onInputChangeRef = useRef(onInputChange)
  onInputChangeRef.current = onInputChange

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getVoicePrefs?.().then((next) => {
      if (!cancelled) setPrefs(next)
    }).catch(() => {})
    const offPrefs = window.electronAPI.onVoiceChanged?.((next) => setPrefs(next))
    const offCapture = voiceCaptureSession.subscribe((state) => {
      setRecording(state.recording)
      setBusy(state.busy)
    })
    const offText = voiceCaptureSession.onTranscript((text) => {
      if (!text) return
      onInputChangeRef.current?.(joinDraftTranscript(inputRef.current, text))
    })
    return () => {
      cancelled = true
      offPrefs?.()
      offCapture()
      offText()
    }
  }, [])

  const finish = useCallback(async () => {
    try {
      await voiceCaptureSession.stop()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.dictate'))
    }
  }, [t])

  const start = useCallback(async () => {
    try {
      await voiceCaptureSession.start(prefs?.selectedInputDeviceId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.input.voiceOffline'))
    }
  }, [prefs?.selectedInputDeviceId, t])

  const toggle = useCallback(() => {
    if (disabled || busy) return
    if (recording) {
      void finish()
      return
    }
    void start()
  }, [busy, disabled, finish, recording, start])

  useEffect(() => {
    if (window.electronAPI.onVoiceCommand) return
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
        disabled={disabled || busy}
      />
    </div>
  )
}
