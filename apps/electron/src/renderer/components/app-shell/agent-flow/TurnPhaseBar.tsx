/**
 * TurnPhaseBar — live agent turn phase (#14) plus the queue-or-steer
 * selector (#17), rendered directly above the composer while the agent works.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TurnPhaseState } from './turn-phase'
import { MID_STREAM_MODES, type MidStreamMode } from './mid-stream-mode'

export interface TurnPhaseBarProps {
  state: TurnPhaseState
  mode: MidStreamMode
  onModeChange: (mode: MidStreamMode) => void
}

export const TurnPhaseBar = React.memo(function TurnPhaseBar({ state, mode, onModeChange }: TurnPhaseBarProps) {
  const { t } = useTranslation()
  const groupRef = React.useRef<HTMLDivElement>(null)
  if (state.phase === 'idle' && state.queued === 0) return null

  const label = state.phase === 'tool'
    ? t('chat.turnPhase.tool', { tool: state.toolName || t('chat.turnPhase.toolFallback') })
    : state.phase === 'idle' ? '' : t(`chat.turnPhase.${state.phase}`)

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const i = MID_STREAM_MODES.indexOf(mode)
    const next = MID_STREAM_MODES[(i + (event.key === 'ArrowRight' ? 1 : MID_STREAM_MODES.length - 1)) % MID_STREAM_MODES.length]!
    onModeChange(next)
    requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus())
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-1 text-caption text-muted-foreground" data-turn-phase={state.phase}>
      <span className="flex min-w-0 items-center gap-1.5" role="status" aria-live="polite">
        {state.phase !== 'idle' && <Loader2 className="icon-caption shrink-0 animate-spin" aria-hidden />}
        <span className="truncate">{label}</span>
        {state.toolsDone > 0 && <span className="shrink-0">· {t('chat.turnPhase.toolsDone', { count: state.toolsDone })}</span>}
        {state.queued > 0 && <span className="shrink-0">· {t('chat.turnPhase.queued', { count: state.queued })}</span>}
      </span>
      {state.phase !== 'idle' && (
        <div ref={groupRef} role="radiogroup" aria-label={t('chat.midStream.label')} className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/50 p-0.5" onKeyDown={onKeyDown}>
          {MID_STREAM_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              data-mode={m}
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              aria-description={t(`chat.midStream.${m}Hint`)}
              onClick={() => onModeChange(m)}
              className={cn('rounded px-1.5 py-0.5 text-caption', mode === m ? 'bg-surface-selected text-foreground' : 'hover:text-foreground')}
            >
              {t(`chat.midStream.${m}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
