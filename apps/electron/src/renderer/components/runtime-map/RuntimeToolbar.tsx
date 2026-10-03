import { Crosshair, Download, List, Maximize2, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeRunSummary, TraceCoverage } from '@rox/core/runtime-trace'
import { safePreview } from './measurements'
import { coverageMissingText } from './coverage-text'
import type { TimelineMode } from './layout/stable-layout'

export type RuntimeMapMode = 'execution' | 'context' | 'editor' | 'list'
export interface RuntimeToolbarProps {
  mode: RuntimeMapMode; onModeChange: (mode: RuntimeMapMode) => void; editorAvailable: boolean
  runs: RuntimeRunSummary[]; selectedRootRunId?: string; onRunChange?: (id: string) => void
  query: string; onQueryChange: (value: string) => void; filter: string; onFilterChange: (value: string) => void
  following: boolean; pending: number; onFollow: () => void; onFit: () => void; onClose?: () => void
  timelineMode: TimelineMode; onTimelineModeChange: (mode: TimelineMode) => void; comparableTime: boolean
  coverage: TraceCoverage; onExport: () => void
}
export function RuntimeToolbar(props: RuntimeToolbarProps) {
  const { t } = useTranslation()
  const filters = ['all', 'agent', 'tool', 'skill', 'terminal', 'plan', 'acceptance', 'memory', 'result', 'errors', 'waiting']
  return <div className="runtime-toolbar">
    <div className="runtime-toolbar-title"><strong>{t('runtimeMap.title')}</strong><span className={`runtime-coverage runtime-coverage-${props.coverage.state}`} title={coverageMissingText(props.coverage.missing, t)}>{t(`runtimeMap.coverage.${props.coverage.state}`)}</span><span className="runtime-toolbar-spacer" />{props.onClose && <button type="button" className="runtime-icon-button" title={t('runtimeMap.close')} aria-label={t('runtimeMap.close')} onClick={props.onClose}><X size={15} /></button>}</div>
    <div className="runtime-tabs" role="tablist" aria-label={t('runtimeMap.view')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const modes = ['execution', 'context', 'list', ...(props.editorAvailable ? ['editor'] : [])] as RuntimeMapMode[]
      const index = modes.indexOf(props.mode)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length
      props.onModeChange(modes[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus(); event.preventDefault()
    }}>
      {(['execution', 'context', 'list', ...(props.editorAvailable ? ['editor'] : [])] as RuntimeMapMode[]).map(mode => <button key={mode} role="tab" type="button" tabIndex={props.mode === mode ? 0 : -1} aria-selected={props.mode === mode} onClick={() => props.onModeChange(mode)}>{mode === 'list' && <List size={13} />}{t(`runtimeMap.mode.${mode}`)}</button>)}
    </div>
    {props.mode !== 'editor' && <div className="runtime-toolbar-controls">
      <label className="runtime-search"><Search size={13} /><input type="search" placeholder={t('runtimeMap.search')} aria-label={t('runtimeMap.search')} value={props.query} onChange={event => props.onQueryChange(event.target.value)} /></label>
      <select aria-label={t('runtimeMap.filter')} value={props.filter} onChange={event => props.onFilterChange(event.target.value)}>{filters.map(filter => <option key={filter} value={filter}>{t(`runtimeMap.filterKind.${filter}`)}</option>)}</select>
      <button type="button" className="runtime-icon-button" title={t('runtimeMap.fit')} aria-label={t('runtimeMap.fit')} onClick={props.onFit}><Maximize2 size={14} /></button>
      <button type="button" className="runtime-follow-button" data-active={props.following} title={t('runtimeMap.follow')} aria-label={t('runtimeMap.follow')} onClick={props.onFollow}><Crosshair size={14} />{props.pending ? <span>{props.pending}</span> : null}</button>
      <button type="button" className="runtime-icon-button" title={t('runtimeMap.export')} aria-label={t('runtimeMap.export')} onClick={props.onExport}><Download size={14} /></button>
    </div>}
    {props.mode !== 'editor' && <div className="runtime-toolbar-options">
      <select aria-label={t('runtimeMap.chooseRun')} value={props.selectedRootRunId || props.runs.at(-1)?.rootRunId || ''} onChange={event => props.onRunChange?.(event.target.value)} disabled={!props.runs.length}>{!props.runs.length && <option value="">{t('runtimeMap.noRuns')}</option>}{props.runs.map((run, index) => <option key={run.rootRunId} value={run.rootRunId}>{index + 1}. {safePreview(run.prompt, 66) || t('runtimeMap.title')} · {t(`runtimeMap.status.${run.status}`)}</option>)}</select>
      {props.mode === 'execution' && <select aria-label={t('runtimeMap.timeline')} value={props.timelineMode} onChange={event => props.onTimelineModeChange(event.target.value as TimelineMode)}><option value="compact">{t('runtimeMap.compactTimeline')}</option><option value="time" disabled={!props.comparableTime}>{t('runtimeMap.trueTimeline')}</option></select>}
    </div>}
  </div>
}
