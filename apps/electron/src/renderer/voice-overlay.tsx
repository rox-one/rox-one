import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { i18n } from '@craft-agent/shared/i18n'
import { emptyVoiceOverlayState, type VoiceOverlayCommand, type VoiceOverlayState } from '../shared/voice-overlay-ipc'
import type { MeetingOverlayState } from '../shared/meeting-overlay-ipc'
import './index.css'

setupI18n([LanguageDetector, initReactI18next])

declare global {
  interface Window {
    voiceOverlay?: {
      dispatch(action: VoiceOverlayCommand): Promise<{ ok: true }>
      onState(callback: (state: OverlayUiState) => void): () => void
    }
  }
}

type OverlayUiState = VoiceOverlayState & Partial<Pick<MeetingOverlayState, 'kind' | 'phase' | 'error' | 'liveTranscript'>>

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function OverlayApp() {
  const [state, setState] = useState<OverlayUiState>(emptyVoiceOverlayState())
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    return window.voiceOverlay?.onState((next) => setState(next)) ?? (() => {})
  }, [])

  if (state.kind === 'meeting') {
    const errored = state.phase === 'error' || Boolean(state.error)
    const paused = state.phase === 'paused'
    const label = errored
      ? i18n.t('meetings.overlayError')
      : state.phase === 'ask'
        ? i18n.t('meetings.overlayAsk')
        : state.phase === 'catch-up'
          ? i18n.t('meetings.overlayCatchUp')
          : paused
            ? i18n.t('meetings.overlayPause')
            : i18n.t('meetings.overlayRecording')

    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[120px] flex-col justify-center gap-2 rounded-2xl border border-white/10 bg-zinc-900/90 px-3 py-2 text-sm text-white shadow-lg"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${errored ? 'bg-amber-400' : paused ? 'bg-zinc-400' : 'bg-red-500'} ${state.recording && !reduceMotion ? 'animate-pulse' : ''}`}
          />
          <span className="truncate" data-testid={errored ? 'meeting-overlay-error' : undefined}>{label}</span>
          <span className="ml-auto tabular-nums text-xs text-white/70">{formatElapsed(state.elapsedMs)}</span>
        </div>
        <p className="truncate text-xs text-white/80" data-testid="meeting-live-transcript">
          {state.liveTranscript ?? ''}
        </p>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            data-testid="meeting-pause"
            aria-label={paused ? i18n.t('meetings.overlayResume') : i18n.t('meetings.overlayPause')}
            className="rounded-full bg-white/10 px-2 py-1 text-xs"
            onClick={() => void window.voiceOverlay?.dispatch('pause')}
          >
            {paused ? i18n.t('meetings.overlayResume') : i18n.t('meetings.overlayPause')}
          </button>
          <button
            type="button"
            data-testid="meeting-stop"
            aria-label={i18n.t('meetings.overlayStop')}
            className="rounded-full bg-white/10 px-2 py-1 text-xs"
            onClick={() => void window.voiceOverlay?.dispatch('stop')}
          >
            {i18n.t('meetings.overlayStop')}
          </button>
          <button
            type="button"
            data-testid="meeting-ask"
            aria-label={i18n.t('meetings.overlayAsk')}
            className="rounded-full bg-white/10 px-2 py-1 text-xs"
            onClick={() => void window.voiceOverlay?.dispatch('ask')}
          >
            {i18n.t('meetings.overlayAsk')}
          </button>
          <button
            type="button"
            data-testid="meeting-catch-up"
            aria-label={i18n.t('meetings.overlayCatchUp')}
            className="rounded-full bg-white/10 px-2 py-1 text-xs"
            onClick={() => void window.voiceOverlay?.dispatch('catch-up')}
          >
            {i18n.t('meetings.overlayCatchUp')}
          </button>
        </div>
      </div>
    )
  }

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
