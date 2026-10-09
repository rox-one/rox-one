import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserIntelState, PipelineProgress } from '@rox/browser-intel'
import { Spinner } from '@rox/ui'
import { cn } from '@/lib/utils'

/**
 * Renderer surface of the Browser Intelligence bridge. See BrowserIntelOptIn:
 * declared locally, every member optional, probed before use.
 */
interface BrowserIntelProgressBridge {
  onBrowserIntelProgress?: (callback: (progress: PipelineProgress) => void) => () => void
  onBrowserIntelStateChanged?: (callback: (state: BrowserIntelState) => void) => () => void
}

/**
 * A background indexing run outlives any single mount of this step, so the
 * "in flight" flag lives at module scope: a remount resumes the indicator
 * instead of losing the run it was reporting on.
 */
let active = false

function bridge(): BrowserIntelProgressBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api: unknown = window.electronAPI
  if (typeof api !== 'object' || api === null) return undefined
  // Each channel is probed and runtime-checked before the signature cast.
  const onBrowserIntelProgress = 'onBrowserIntelProgress' in api && typeof api.onBrowserIntelProgress === 'function'
    ? (api.onBrowserIntelProgress as (callback: (progress: PipelineProgress) => void) => () => void)
    : undefined
  const onBrowserIntelStateChanged = 'onBrowserIntelStateChanged' in api && typeof api.onBrowserIntelStateChanged === 'function'
    ? (api.onBrowserIntelStateChanged as (callback: (state: BrowserIntelState) => void) => () => void)
    : undefined
  return { onBrowserIntelProgress, onBrowserIntelStateChanged }
}

/**
 * Non-blocking "Indexing context..." row for the background intelligence run.
 * It never disables anything and renders nothing once the run finishes, so the
 * wizard stays fully usable while indexing happens.
 */
export function BrowserIntelProgress({ className }: { className?: string } = {}) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [visible, setVisible] = useState(active)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    const api = bridge()
    if (!api) return
    const show = (next: PipelineProgress | null) => { active = true; setProgress(next); setVisible(true) }
    const hide = () => { active = false; setProgress(null); setVisible(false) }

    const offProgress = api.onBrowserIntelProgress?.((next) => {
      // current >= total is the terminal event for a stage: nothing left to index there.
      if (next.total > 0 && next.current >= next.total) { hide(); return }
      show(next)
    })
    const offState = api.onBrowserIntelStateChanged?.((state) => {
      // A persisted run receipt means the pipeline finished.
      if (state.lastResult) { hide(); return }
      if (state.lastRunAt !== null && state.lastRunAt > mountedAt.current) show(null)
    })
    return () => { offProgress?.(); offState?.() }
  }, [])

  if (!visible) return null

  const total = progress?.total ?? 0
  const current = progress?.current ?? 0
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : null

  return (
    <div
      className={cn('space-y-2 text-left', className)}
      data-testid="browser-intel-progress"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="shrink-0" />
        <span>{t('onboarding.browserIntel.indexing')}</span>
        {percent !== null ? (
          <span className="ml-auto tabular-nums">{t('onboarding.browserIntel.progress', { done: current, total })}</span>
        ) : null}
      </div>
      {percent !== null ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-surface-pressed"
          role="progressbar"
          aria-label={t('onboarding.browserIntel.indexing')}
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}