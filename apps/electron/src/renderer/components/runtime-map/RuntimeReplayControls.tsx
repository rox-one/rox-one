import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Replay changes only the read cursor; there are no model/tool invocation callbacks. */
export function RuntimeReplayControls({ minimum, maximum, cursor, onChange }: { minimum: number; maximum: number; cursor?: number; onChange?: (cursor: number | undefined) => void }) {
  const { t } = useTranslation()
  if (!onChange || maximum < minimum) return null
  const value = cursor ?? maximum
  return <div className="runtime-replay" data-testid="runtime-replay">
    <button type="button" className="runtime-icon-button" title={t('runtimeMap.previousEvent')} aria-label={t('runtimeMap.previousEvent')} disabled={value <= minimum} onClick={() => onChange(Math.max(minimum, value - 1))}><ChevronLeft size={14} /></button>
    <input type="range" min={minimum} max={maximum} value={value} aria-label={t('runtimeMap.replay')} aria-valuetext={t('runtimeMap.replayPosition', { sequence: value })} onChange={event => onChange(Number(event.target.value))} />
    <button type="button" className="runtime-icon-button" title={t('runtimeMap.nextEvent')} aria-label={t('runtimeMap.nextEvent')} disabled={value >= maximum} onClick={() => onChange(Math.min(maximum, value + 1))}><ChevronRight size={14} /></button>
    <small>#{value}</small><button type="button" data-active={cursor === undefined} onClick={() => onChange(undefined)}><Radio size={13} />{t('runtimeMap.live')}</button>
  </div>
}
