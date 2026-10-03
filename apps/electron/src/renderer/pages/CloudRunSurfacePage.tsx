/**
 * CloudRunSurfacePage — MainContentPanel host for `cloud-run/{runId}`.
 *
 * Never mute-falls through to the sessions empty prompt. Loads an existing
 * run via cloud-runs RPC when available; otherwise shows an honest
 * unavailable / not-found state with a path to Settings → Cloud Runs.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'

export interface CloudRunSurfacePageProps {
  /** Run id from `cloud-run/{runId}` route details. Null = bare navigator. */
  runId: string | null
}

type RunRow = {
  id: string
  name: string
  provider: string
  createdAt: number
  sessionId?: string
  topic?: string
  status: {
    id: string
    state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
    failureReason?: string
    progress?: { completed: number; total: number }
  } | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: 'no-api' | 'disabled' | 'error'; message?: string }
  | { kind: 'empty' }
  | { kind: 'not-found' }
  | { kind: 'ready'; run: RunRow; enabled: boolean }

const CLOUD_RUN_REFRESH_INTERVAL_MS = 5_000

export default function CloudRunSurfacePage({ runId }: CloudRunSurfacePageProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = React.useState(0)
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])

  const openSettings = React.useCallback(() => {
    navigate(routes.view.settings('cloudRuns'))
  }, [navigate])

  React.useEffect(() => {
    if (!runId) return
    let cancelled = false
    let revision = 0
    let inFlight = false

    async function load(showLoading = false) {
      if (!runId || cancelled) return
      const request = ++revision
      const isCurrent = () => !cancelled && request === revision
      const publish = (next: LoadState) => { if (isCurrent()) setState(next) }
      inFlight = true
      if (showLoading) publish({ kind: 'loading' })

      const api = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (typeof api?.listCloudRuns !== 'function' || typeof api?.getCloudRunsConfig !== 'function') {
        publish({ kind: 'unavailable', reason: 'no-api' })
        inFlight = false
        return
      }

      try {
        const config = await api.getCloudRunsConfig()
        if (!isCurrent()) return
        if (!config?.enabled) {
          publish({ kind: 'unavailable', reason: 'disabled' })
          return
        }

        const listed = await api.listCloudRuns()
        if (!isCurrent()) return
        if (!listed.enabled) {
          publish({ kind: 'unavailable', reason: 'disabled' })
          return
        }
        const run = listed.runs.find((row) => row.id === runId) ?? null

        if (!run) {
          // Prefer status probe when list misses a still-owned run.
          try {
            const status = (await api.getCloudRunStatus?.(runId)) as RunRow['status'] | null
            if (!isCurrent()) return
            if (status && typeof status === 'object' && 'state' in status) {
              publish({
                kind: 'ready',
                enabled: true,
                run: {
                  id: runId,
                  name: runId,
                  provider: listed.provider,
                  createdAt: Date.now(),
                  status,
                },
              })
              return
            }
          } catch (error) {
            // Only a canonical missing result establishes deletion. A transport
            // or authorization failure must remain unavailable and retryable.
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
            if (code !== 'not_found' && code !== 'NOT_FOUND') throw error
          }
          publish({ kind: 'not-found' })
          return
        }

        publish({ kind: 'ready', run, enabled: listed.enabled })
      } catch (error) {
        publish({
          kind: 'unavailable',
          reason: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (isCurrent()) inFlight = false
      }
    }

    // The canonical API has no run-change subscription. Keep the selected run
    // current while visible; focus/visibility and Retry can recover a read that
    // was pending when the transport changed, without submitting a new run.
    const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const refresh = () => { if (isVisible()) void load() }
    void load(true)
    const timer = setInterval(() => { if (!inFlight) refresh() }, CLOUD_RUN_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      revision += 1
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [runId, attempt])

  if (!runId) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
        data-cloud-run-surface="empty"
        data-testid="cloud-run-surface-empty"
      >
        <p className="text-sm">{t('cloudRuns.surface.noRunSelected')}</p>
        <p className="max-w-md text-center text-xs text-muted-foreground/80">
          {t('cloudRuns.surface.useChipHint')}
        </p>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border/60 bg-foreground/[0.03] px-3 text-xs font-medium text-foreground hover:bg-foreground/5"
          data-cloud-run-surface-open-settings="true"
          onClick={openSettings}
        >
          {t('cloudRuns.surface.openSettings')}
        </button>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        data-cloud-run-surface="loading"
        data-cloud-run-id={runId}
        data-testid="cloud-run-surface-loading"
      >
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  if (state.kind === 'unavailable' || state.kind === 'empty' || state.kind === 'not-found') {
    const title =
      state.kind === 'not-found'
        ? t('cloudRuns.surface.notFound')
        : state.kind === 'empty'
          ? t('cloudRuns.empty')
          : t('cloudRuns.surface.unavailable')
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
        data-cloud-run-surface={state.kind}
        data-cloud-run-id={runId}
        data-testid={`cloud-run-surface-${state.kind}`}
      >
        <p className="text-sm">{title}</p>
        {state.kind === 'unavailable' && state.message ? (
          <p className="max-w-md text-center text-xs text-muted-foreground/80">{state.message}</p>
        ) : (
          <p className="max-w-md text-center text-xs text-muted-foreground/80">
            {t('cloudRuns.surface.useChipHint')}
          </p>
        )}
        <button type="button" data-testid="cloud-run-surface-retry" onClick={retry} className="rounded-md border border-border px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('common.retry')}
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border/60 bg-foreground/[0.03] px-3 text-xs font-medium text-foreground hover:bg-foreground/5"
          data-cloud-run-surface-open-settings="true"
          onClick={openSettings}
        >
          {t('cloudRuns.surface.openSettings')}
        </button>
      </div>
    )
  }

  const { run } = state
  const statusLabel = run.status?.state ?? t('common.unavailable')

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-cloud-run-surface="host"
      data-cloud-run-id={run.id}
      data-cloud-run-state={run.status?.state ?? 'unknown'}
      data-testid="cloud-run-surface-host"
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <span className="truncate text-[11px] font-medium text-foreground/80">
          {t('settings.cloudRuns.title')} · {run.name || run.id}
        </span>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          data-cloud-run-surface-open-settings="true"
          onClick={openSettings}
        >
          {t('cloudRuns.surface.openSettings')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="font-mono break-all">{run.id}</dd>
          <dt className="text-muted-foreground">{t('cloudRuns.open')}</dt>
          <dd>{statusLabel}</dd>
          {run.topic ? (
            <>
              <dt className="text-muted-foreground">{t('cloudRuns.sectionNewRun')}</dt>
              <dd className="break-words">{run.topic}</dd>
            </>
          ) : null}
          {run.status?.progress ? (
            <>
              <dt className="text-muted-foreground">Progress</dt>
              <dd>
                {run.status.progress.completed}/{run.status.progress.total}
              </dd>
            </>
          ) : null}
          {run.status?.failureReason ? (
            <>
              <dt className="text-muted-foreground">{t('cloudRuns.error')}</dt>
              <dd className="break-words text-destructive">{run.status.failureReason}</dd>
            </>
          ) : null}
        </dl>
        {run.sessionId ? (
          <button
            type="button"
            className="inline-flex h-8 w-fit items-center rounded-md border border-border/60 bg-foreground/[0.03] px-3 text-xs font-medium text-foreground hover:bg-foreground/5"
            data-cloud-run-surface-open-session="true"
            onClick={() => navigate(routes.view.allSessions(run.sessionId))}
          >
            {t('cloudRuns.surface.openSession')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
