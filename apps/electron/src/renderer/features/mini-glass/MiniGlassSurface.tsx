/**
 * Mini glass companion surface — loaded with `?surface=mini-glass` into the
 * tiny frameless, transparent window main floats while the app is minimized.
 *
 * Collapsed: a drag grip plus two circular glass icon buttons (tooltips via the
 * native `title`, which the OS draws outside the tiny window):
 * - New request → expands into a compact pill input; ⏎ restores Rox and starts
 *   a new session that sends with the default provider (main runs the regular
 *   `new-session` action with `send=true`). Esc collapses.
 * - Voice → records through the host voice-capture pipeline and drops the
 *   transcript into the pill input for review/send.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, LoaderCircle, Mic, SquarePen, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing'

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

/** Circular glass: translucent fill, hairline light border, soft lift, backdrop blur. */
const GLASS = 'border-[0.5px] border-white/25 bg-popover/55 text-white/90 shadow-strong backdrop-blur-2xl backdrop-saturate-150'
const GLASS_HOVER = 'hover:bg-popover/70'
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties

export function MiniGlassSurface() {
  const { t } = useTranslation()
  const api = window.electronAPI
  const [expanded, setExpanded] = React.useState(false)
  const [text, setText] = React.useState('')
  const [voice, setVoice] = React.useState<VoicePhase>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const hostStartedRef = React.useRef(false)
  const generationRef = React.useRef(0)

  // The window background stays fully transparent: only the glass shapes paint.
  React.useEffect(() => {
    const previous = [document.documentElement.style.background, document.body.style.background]
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      document.documentElement.style.background = previous[0]
      document.body.style.background = previous[1]
    }
  }, [])

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const cancelVoice = React.useCallback(() => {
    generationRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
    stopTracks()
    if (hostStartedRef.current) {
      hostStartedRef.current = false
      void api.cancelVoiceCapture?.().catch(() => undefined)
    }
    setVoice('idle')
  }, [api, stopTracks])

  const changeExpanded = React.useCallback((next: boolean) => {
    setExpanded(next)
    void api.miniGlass?.setExpanded(next).catch(() => undefined)
    if (next) window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [api])

  // Main hides us when the owner window returns; start clean next time.
  React.useEffect(() => api.miniGlass?.onReset(() => {
    cancelVoice()
    setExpanded(false)
    setText('')
    setError(null)
    setSubmitting(false)
  }), [api, cancelVoice])

  React.useEffect(() => () => cancelVoice(), [cancelVoice])

  const submit = React.useCallback(async () => {
    const body = text.trim()
    if (!body || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const ok = await api.miniGlass.submit(body)
      if (!ok) throw new Error('submit rejected')
      setText('')
      setExpanded(false)
    } catch {
      setError(t('window.mini.sendFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [api, submitting, t, text])

  const finishVoice = React.useCallback(async (recorder: MediaRecorder, generation: number) => {
    stopTracks()
    setVoice('transcribing')
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    try {
      const frameBytes = 1024 * 1024
      for (let offset = 0; offset < blob.size; offset += frameBytes) {
        const audioBase64 = await blobToBase64(blob.slice(offset, offset + frameBytes))
        if (generation !== generationRef.current) return
        await api.sendVoiceChunk({ audioBase64 })
      }
      if (generation !== generationRef.current) return
      const job = await api.stopVoiceCapture()
      hostStartedRef.current = false
      if (generation !== generationRef.current) return
      const transcript = job?.transcript?.text?.trim() ?? ''
      if (transcript) {
        setText((previous) => (previous.trim() ? `${previous.trimEnd()} ${transcript}` : transcript))
        setError(null)
      } else {
        setError(job?.job === 'failed'
          ? (job.error || t('window.mini.voiceFailed'))
          : t('settings.input.voiceNoSpeech'))
      }
      changeExpanded(true)
    } catch {
      if (generation === generationRef.current) {
        setError(t('window.mini.voiceFailed'))
        changeExpanded(true)
      }
    } finally {
      if (generation === generationRef.current) setVoice('idle')
    }
  }, [api, changeExpanded, stopTracks, t])

  const toggleVoice = React.useCallback(async () => {
    if (voice === 'recording') {
      recorderRef.current?.stop()
      return
    }
    if (voice !== 'idle') return
    setError(null)
    const generation = ++generationRef.current
    setVoice('starting')
    try {
      const prefs = await api.getVoicePrefs()
      if (prefs.sttEngine === 'cloud-rox' && (!prefs.cloudAsrConsent || prefs.privacyMigrationPending)) {
        // Consent is granted in the app's own dialog; never record without it.
        setVoice('idle')
        setError(t('window.mini.voiceConsentNeeded'))
        changeExpanded(true)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: prefs.selectedInputDeviceId ? { deviceId: { exact: prefs.selectedInputDeviceId } } : true,
      })
      if (generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const started = await api.startVoiceCapture({ mimeType: recorder.mimeType || 'audio/webm' })
      if (generation !== generationRef.current) {
        // Cancelled (reset/collapse) while the host was starting: release it.
        if (started?.recordingId) void api.cancelVoiceCapture?.().catch(() => undefined)
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      if (!started?.recordingId) throw new Error('voice offline')
      hostStartedRef.current = true
      await api.grantVoicePermission()
      if (generation !== generationRef.current) {
        if (hostStartedRef.current) {
          hostStartedRef.current = false
          void api.cancelVoiceCapture?.().catch(() => undefined)
        }
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return
        recorderRef.current = null
        void finishVoice(recorder, generation)
      }
      recorderRef.current = recorder
      recorder.start()
      setVoice('recording')
    } catch {
      if (generation !== generationRef.current) return
      cancelVoice()
      setError(t('window.mini.voiceFailed'))
      changeExpanded(true)
    }
  }, [api, cancelVoice, changeExpanded, finishVoice, t, voice])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (voice !== 'idle') cancelVoice()
      else if (expanded) { changeExpanded(false); setError(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancelVoice, changeExpanded, expanded, voice])

  const recording = voice === 'recording'
  const voiceBusy = voice === 'starting' || voice === 'transcribing'
  const voiceLabel = recording ? t('window.mini.voiceStop') : t('window.mini.voice')
  const VoiceIcon = voiceBusy ? LoaderCircle : recording ? Square : Mic

  const voiceButton = (size: 'lg' | 'sm') => (
    <button
      type="button"
      style={NO_DRAG}
      title={voiceLabel}
      aria-label={voiceLabel}
      aria-pressed={recording}
      disabled={voiceBusy || submitting}
      data-testid="mini-glass-voice"
      onClick={() => void toggleVoice()}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 disabled:opacity-60',
        size === 'lg' ? cn('size-10', GLASS, GLASS_HOVER) : 'size-7 text-white/80 hover:bg-white/10',
        recording && 'bg-status-danger/70 text-white hover:bg-status-danger/80',
      )}
    >
      <VoiceIcon className={cn(size === 'lg' ? 'icon-rail' : 'icon-toolbar', voiceBusy && 'animate-spin', recording && 'icon-caption fill-current')} />
    </button>
  )

  return (
    <div className="flex h-screen w-screen select-none items-center gap-1.5 overflow-hidden bg-transparent px-2.5" data-surface="mini-glass">
      <div
        style={DRAG}
        title={t('window.mini.drag')}
        aria-hidden="true"
        className="grid h-7 w-3 shrink-0 cursor-grab grid-cols-2 content-center gap-[3px] opacity-60 hover:opacity-100"
      >
        {Array.from({ length: 6 }, (_, index) => <span key={index} className="size-[3px] rounded-full bg-white/70" />)}
      </div>
      {expanded ? (
        <form
          className={cn('flex h-10 min-w-0 flex-1 items-center gap-1 rounded-full pl-4 pr-1.5', GLASS)}
          style={NO_DRAG}
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <input
            ref={inputRef}
            value={text}
            maxLength={8000}
            disabled={submitting}
            onChange={(event) => { setText(event.target.value); if (error) setError(null) }}
            placeholder={error ?? t('window.mini.placeholder')}
            aria-label={t('window.mini.newRequest')}
            aria-invalid={error ? true : undefined}
            data-testid="mini-glass-input"
            className={cn('min-w-0 flex-1 bg-transparent text-small text-white outline-none placeholder:text-white/50', error && 'placeholder:text-status-danger')}
          />
          {voiceButton('sm')}
          <button
            type="submit"
            // eslint-disable-next-line rox/prefer-primitives -- the OS draws the native title outside the 124x60 frameless companion window; an in-window Tooltip would be clipped to it. The button carries aria-label.
            title={t('window.mini.send')}
            aria-label={t('window.mini.send')}
            disabled={!text.trim() || submitting}
            data-testid="mini-glass-send"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-black transition-opacity disabled:opacity-30"
          >
            {submitting ? <LoaderCircle className="icon-toolbar animate-spin" /> : <ArrowUp className="icon-toolbar" />}
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            style={NO_DRAG}
            // eslint-disable-next-line rox/prefer-primitives -- the OS draws the native title outside the 124x60 frameless companion window; an in-window Tooltip would be clipped to it. The button carries aria-label.
            title={t('window.mini.newRequest')}
            aria-label={t('window.mini.newRequest')}
            data-testid="mini-glass-new"
            onClick={() => changeExpanded(true)}
            className={cn('grid size-10 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95', GLASS, GLASS_HOVER)}
          >
            <SquarePen className="icon-rail" />
          </button>
          {voiceButton('lg')}
        </>
      )}
    </div>
  )
}

export default MiniGlassSurface
