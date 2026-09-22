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

export default function CloudRunSurfacePage({ runId }: CloudRunSurfacePageProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })

  const openSettings = React.useCallback(() => {
    navigate(routes.view.settings('cloudRuns'))
  }, [navigate])

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      if (!runId) return

      const api = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (!api?.listCloudRuns || !api?.getCloudRunsConfig) {
        if (!cancelled) setState({ kind: 'unavailable', reason: 'no-api' })
        return
      }

      try {
        const config = await api.getCloudRunsConfig()
        if (!config?.enabled) {
          if (!cancelled) setState({ kind: 'unavailable', reason: 'disabled' })
          return
        }

        const listed = await api.listCloudRuns()
        const run = listed.runs.find((row) => row.id === runId) ?? null

        if (!run) {
          // Prefer status probe when list misses a still-owned run.
          try {
            const status = (await api.getCloudRunStatus?.(runId)) as RunRow['status'] | null
            if (status && typeof status === 'object' && 'state' in status) {
              if (!cancelled) {
                setState({
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
              }
              return
            }
          } catch {
            // fall through to not-found
          }
          if (!cancelled) setState({ kind: 'not-found' })
          return
        }

        if (!cancelled) setState({ kind: 'ready', run, enabled: listed.enabled })
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: 'unavailable',
            reason: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [runId])

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
