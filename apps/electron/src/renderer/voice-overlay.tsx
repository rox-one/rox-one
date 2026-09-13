import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { i18n } from '@craft-agent/shared/i18n'
import { emptyVoiceOverlayState, type VoiceOverlayState } from '../shared/voice-overlay-ipc'
import './index.css'

setupI18n([LanguageDetector, initReactI18next])

declare global {
  interface Window {
    voiceOverlay?: {
      dispatch(action: 'toggle' | 'cancel'): Promise<{ ok: true }>
      onState(callback: (state: VoiceOverlayState) => void): () => void
    }
  }
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function OverlayApp() {
  const [state, setState] = useState<VoiceOverlayState>(emptyVoiceOverlayState())
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    return window.voiceOverlay?.onState((next) => setState(next)) ?? (() => {})
  }, [])

  const recording = state.recording
  const busy = state.busy && !recording
  const label = recording
    ? i18n.t('chat.dictateStop')
    : busy
      ? i18n.t('chat.dictateTranscribing')
      : i18n.t('chat.dictate')

  return (
    <div
      className="flex h-[56px] items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 px-3 text-sm text-white shadow-lg"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${recording ? 'bg-red-500' : busy ? 'bg-amber-400' : 'bg-zinc-500'} ${recording && !reduceMotion ? 'animate-pulse' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          <span className="tabular-nums text-xs text-white/70">{formatElapsed(state.elapsedMs)}</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-red-400"
            style={{ width: `${Math.round(state.rms * 100)}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        className="rounded-full bg-white/10 px-2 py-1 text-xs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => void window.voiceOverlay?.dispatch('toggle')}
      >
        {i18n.t('chat.dictateStop')}
      </button>
      <button
        type="button"
        className="rounded-full bg-white/10 px-2 py-1 text-xs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => void window.voiceOverlay?.dispatch('cancel')}
      >
        {i18n.t('chat.dictateCancel')}
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<OverlayApp />)
