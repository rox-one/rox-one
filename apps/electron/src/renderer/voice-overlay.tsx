import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { useTranslation, initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import type { OverlayState } from '@craft-agent/shared/voice'
import { VOICE_OVERLAY_REQUIRES_CONATION_FLAG } from './voice-overlay-rox2-surface'

export { VOICE_OVERLAY_REQUIRES_CONATION_FLAG, VOICE_OVERLAY_SURFACE_ID, voiceOverlaySurfaceResult } from './voice-overlay-rox2-surface'

setupI18n([LanguageDetector, initReactI18next])

function OverlayApp() {
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

  useEffect(() => {
    return window.electronAPI.onVoiceOverlay?.((next) => setState(next))
  }, [])

  if (state.phase === 'hidden') return null

  const phaseKey: Record<OverlayState['phase'], string> = {
    hidden: '',
    permission: 'voice.overlay.permission',
    recording: 'voice.overlay.recording',
    saving: 'voice.overlay.saving',
    transcribing: 'voice.overlay.transcribing',
    enhancing: 'voice.overlay.enhancing',
    ready: 'voice.overlay.ready',
    error: 'voice.overlay.ready',
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
      <span style={{ width: 48, height: 8, background: '#27272a', borderRadius: 4, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, state.rms * 400)}%`, background: '#f4f4f5' }} />
      </span>
      {state.streaming && state.partialTranscript ? <span style={{ fontSize: 11 }}>{state.partialTranscript}</span> : null}
      <button type="button" onClick={() => void window.electronAPI.stopVoiceCapture?.()}>{t('voice.overlay.stop')}</button>
      <button type="button" onClick={() => void window.electronAPI.cancelVoiceCapture?.()}>{t('voice.overlay.cancel')}</button>
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<OverlayApp />)
