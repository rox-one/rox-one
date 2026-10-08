import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { useTranslation, initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@rox/shared/i18n'
import type { OverlayState } from '@rox/shared/voice'
import { VOICE_OVERLAY_REQUIRES_CONATION_FLAG } from './voice-overlay-rox2-surface'

export { VOICE_OVERLAY_REQUIRES_CONATION_FLAG, VOICE_OVERLAY_SURFACE_ID, voiceOverlaySurfaceResult } from './voice-overlay-rox2-surface'

setupI18n([LanguageDetector, initReactI18next])

declare global {
  interface Window { voiceOverlay?: {
    onState(callback: (state: OverlayState) => void): () => void
    stop(recordingId: string | null): Promise<{ ok: boolean }>
    cancel(recordingId: string | null): Promise<{ ok: boolean }>
  } }
}

/** Number of bars in the overlay wave; short enough to read as a level meter. */
const WAVE_BAR_COUNT = 16
const WAVE_BAR_INDEXES = Array.from({ length: WAVE_BAR_COUNT }, (_, index) => index)

/**
 * Live microphone level wave for the owned overlay.
 *
 * `renderer/components/voice/VoiceLevelWave.tsx` (the in-app meter) is
 * deliberately not imported here: this surface is its own Vite entry
 * (`voice-overlay.html`) with a separate browser fixture that resolves no `@`
 * alias, and the tiny always-on-top pill must stay free of app-only modules.
 * The renderer below is the minimal equivalent, driven by the same normalized
 * RMS (0..1) that the voice host publishes for the real capture.
 */
function OverlayLevelWave({ level, active, label }: { level: number; active: boolean; label: string }) {
  const bars = useRef<Array<HTMLSpanElement | null>>([])
  const levelRef = useRef(level)
  const activeRef = useRef(active)
  levelRef.current = level
  activeRef.current = active

  useEffect(() => {
    const history = new Array<number>(WAVE_BAR_COUNT).fill(0)
    let smoothed = 0
    let frame = requestAnimationFrame(function tick() {
      const target = activeRef.current ? Math.min(1, Math.max(0, levelRef.current)) : 0
      smoothed = target > smoothed ? target : smoothed * 0.72 + target * 0.28
      history.shift()
      history.push(smoothed)
      bars.current.forEach((bar, index) => {
        if (!bar) return
        const value = history[index] ?? 0
        bar.style.height = `${Math.max(12, Math.round(value * 100))}%`
        bar.style.opacity = String(0.35 + value * 0.65)
      })
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <span role="img" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 2, width: 64, height: 18 }}>
      {WAVE_BAR_INDEXES.map(index => (
        <span
          key={index}
          ref={node => { bars.current[index] = node }}
          style={{ flex: '1 1 0', minWidth: 1, height: '12%', borderRadius: 1, background: '#f4f4f5', transition: 'height 90ms linear, opacity 90ms linear' }}
        />
      ))}
    </span>
  )
}

export function OverlayApp() {
  if (VOICE_OVERLAY_REQUIRES_CONATION_FLAG) {
    throw new Error('Voice overlay is native and must not require Conation')
  }
  const { t } = useTranslation()
  const [state, setState] = useState<OverlayState>({
    recordingId: null,
    phase: 'hidden',
    elapsedMs: 0,
    rms: 0,
    streaming: false,
  })

  const generation = useRef(0)
  const mounted = useRef(false)
  const [commandError, setCommandError] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.voiceOverlay?.onState(next => {
      generation.current++
      setState(next); setCommandError(false); setPending(false)
    })
    return () => { mounted.current = false; generation.current++; unsubscribe?.() }
  }, [])
  const command = async (action: 'stop' | 'cancel') => {
    const current = generation.current
    setPending(true); setCommandError(false)
    try {
      const reply = await window.voiceOverlay?.[action](state.recordingId)
      if (mounted.current && current === generation.current && !reply?.ok) { setCommandError(true); setPending(false) }
    } catch {
      if (mounted.current && current === generation.current) { setCommandError(true); setPending(false) }
    }
  }

  if (state.phase === 'hidden') return null

  const phaseKey: Record<OverlayState['phase'], string> = {
    hidden: '',
    permission: 'voice.overlay.permission',
    recording: 'voice.overlay.recording',
    saving: 'voice.overlay.saving',
    transcribing: 'voice.overlay.transcribing',
    enhancing: 'voice.overlay.enhancing',
    ready: 'voice.overlay.ready',
    error: 'voice.overlay.error',
  }

  return (
    <div className="shadow-strong" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      margin: 8,
      padding: '10px 14px',
      borderRadius: 999,
      background: 'rgba(20,20,24,0.92)',
      color: 'white',
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: 999,
        background: state.phase === 'recording' ? '#ef4444' : '#a1a1aa',
      }} />
      <span style={{ fontSize: 12, minWidth: 64 }}>{phaseKey[state.phase] ? t(phaseKey[state.phase]) : ''}</span>
      <OverlayLevelWave level={state.rms} active={state.phase === 'recording'} label={t('voice.overlay.level')} />
      <span style={{ fontSize: 11 }}>{`${Math.floor(state.elapsedMs / 60000)}:${String(Math.floor(state.elapsedMs / 1000) % 60).padStart(2, '0')}`}</span>
      {commandError ? <span role="alert">{t('voice.overlay.error')}</span> : null}
      {state.streaming && state.partialTranscript ? <span style={{ fontSize: 11 }}>{state.partialTranscript}</span> : null}
      <button type="button" className="rounded-md px-2 py-0.5 text-xs hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40" disabled={pending || state.phase !== 'recording'} onClick={() => void command('stop')}>{t('voice.overlay.stop')}</button>
      <button type="button" className="rounded-md px-2 py-0.5 text-xs hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40" disabled={pending || !['permission', 'recording', 'saving', 'transcribing', 'enhancing'].includes(state.phase)} onClick={() => void command('cancel')}>{t('voice.overlay.cancel')}</button>
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<OverlayApp />)
