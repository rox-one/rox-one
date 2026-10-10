/**
 * CloudVmSurface — web-only «Облачная ВМ» surface (R16 remainder).
 *
 * Rendered as an overlay above the mounted renderer (apps/webui/App.tsx) after
 * the user picks the cloud-VM mode on the entry landing. The desktop app never
 * imports this file, so the desktop flow is unchanged.
 *
 * Honest by construction: it reuses the landing's availability probe
 * (web-modes.ts) and never fakes a run or a success — a failed list/submit
 * shows the concrete error, and cancel re-reads the list from the host.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cloudVmStateMessageKey, probeCloudVmState, type CloudVmState } from './web-modes'
import {
  CLOUD_VM_REFRESH_MS,
  buildSubmitArgs,
  canCancelRun,
  hasActiveRuns,
  runStateMessageKey,
  sortRunsNewestFirst,
  type CloudRunListItem,
  type CloudVmSurfaceHost,
} from './cloud-vm-runs'

export interface CloudVmSurfaceProps {
  /** Host RPC surface (the web adapter's `window.electronAPI`). */
  host: CloudVmSurfaceHost
  /** Open one run in the shared renderer (`cloud-run/{runId}`). */
  onOpenRun: (runId: string) => void
  /** Leave the cloud surface for the chat/workspace mode. */
  onGoToChat: () => void
}

const CARD_CLASS =
  'flex flex-col gap-3 rounded-lg border border-border/60 bg-background p-5 shadow-minimal'
const PRIMARY_BUTTON_CLASS =
  'self-start rounded-md bg-foreground px-4 py-1.5 text-body font-medium text-background hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BUTTON_CLASS =
  'rounded-md bg-background px-4 py-1.5 text-body text-text-secondary shadow-minimal hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'

/** Short, stable display id for a run row. */
function shortRunId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

export function CloudVmSurface({ host, onOpenRun, onGoToChat }: CloudVmSurfaceProps) {
  const { t } = useTranslation()
  const [cloud, setCloud] = React.useState<CloudVmState>({ status: 'loading' })
  const [runs, setRuns] = React.useState<CloudRunListItem[]>([])
  const [listError, setListError] = React.useState<string | null>(null)
  const [listLoading, setListLoading] = React.useState(true)
  const [topic, setTopic] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [cancelingId, setCancelingId] = React.useState<string | null>(null)

  /** Read the list and publish it (newest first). Never fabricates rows. */
  const loadRuns = React.useCallback(async () => {
    setListLoading(true)
    try {
      const result = await host.listCloudRuns()
      setRuns(sortRunsNewestFirst(result.runs))
      setListError(null)
    } catch {
      setRuns([])
      setListError(t('webui.cloudVm.listFailed'))
    } finally {
      setListLoading(false)
    }
  }, [host, t])

  /** Full refresh: re-probe availability, then re-read the list. */
  const refresh = React.useCallback(async () => {
    setCloud({ status: 'loading' })
    const next = await probeCloudVmState(host)
    setCloud(next)
    if (next.status !== 'available') {
      setRuns([])
      setListLoading(false)
      setListError(null)
      return
    }
    await loadRuns()
  }, [host, loadRuns])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Silent background refresh used only by the auto-poll below: re-reads the
   * list without toggling `listLoading` (no spinner flicker, buttons stay
   * live) and without surfacing a poll error — a transient RPC blip keeps the
   * last known rows instead of blanking them. Manual refresh still reports
   * failures honestly.
   */
  const pollRuns = React.useCallback(async () => {
    try {
      const result = await host.listCloudRuns()
      setRuns(sortRunsNewestFirst(result.runs))
    } catch {
      // Best-effort poll; keep the last known list.
    }
  }, [host])

  // Auto-refresh the list while any run is still active, so progress is
  // visible without pressing «Обновить». `hasActive` is a boolean, so a poll
  // that only changes row data does not restart the 5 s timer; when the last
  // active run reaches a terminal state the dependency flips and the cleanup
  // clears the interval — the poll stops on its own.
  const hasActive = hasActiveRuns(runs)
  React.useEffect(() => {
    if (cloud.status !== 'available' || !hasActive) return
    const timer = window.setInterval(() => {
      void pollRuns()
    }, CLOUD_VM_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [cloud.status, hasActive, pollRuns])

  const submit = React.useCallback(async () => {
    const args = buildSubmitArgs(topic)
    if (!args || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await host.submitCloudRun(args)
      setTopic('')
      // The new run is in the registry — re-read the list from the host.
      await loadRuns()
    } catch {
      setSubmitError(t('webui.cloudVm.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [host, topic, submitting, loadRuns, t])

  const cancel = React.useCallback(
    async (runId: string) => {
      setCancelingId(runId)
      try {
        await host.cancelCloudRun(runId)
      } catch {
        // Cancel is best-effort; the refresh below shows the host's real state
        // rather than a fabricated success.
      } finally {
        setCancelingId(null)
        await loadRuns()
      }
    },
    [host, loadRuns],
  )

  const canSubmitTopic = topic.trim().length > 0 && !submitting
  const cloudProvider =
    cloud.status === 'available' || cloud.status === 'unavailable' ? cloud.provider : undefined

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-6 py-10 font-sans text-foreground">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold">{t('webui.cloudVm.title')}</h1>
              <p className="text-body text-text-secondary">{t('webui.cloudVm.subtitle')}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => void refresh()}
                disabled={cloud.status === 'loading' && listLoading}
              >
                {t('webui.cloudVm.refresh')}
              </button>
              <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onGoToChat}>
                {t('webui.cloudVm.goToChat')}
              </button>
            </div>
          </div>
        </header>

        {cloud.status === 'loading' && (
          <p role="status" className="text-sm text-text-muted">
            {t('webui.cloudVm.loading')}
          </p>
        )}

        {cloud.status === 'error' && (
          <div role="alert" className={`${CARD_CLASS} text-destructive`}>
            <p className="text-sm">{t('webui.cloudVm.unavailable')}</p>
            <p className="text-xs text-destructive/90">{t(cloudVmStateMessageKey(cloud))}</p>
          </div>
        )}

        {cloud.status === 'unavailable' && (
          <div role="alert" className={CARD_CLASS}>
            <p className="text-sm text-destructive/90">
              {t(cloudVmStateMessageKey(cloud), { provider: cloudProvider ?? '' })}
            </p>
            <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => void refresh()}>
              {t('webui.cloudVm.refresh')}
            </button>
          </div>
        )}

        {cloud.status === 'available' && (
          <>
            <section className={CARD_CLASS} aria-label={t('webui.cloudVm.newRun')}>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor="cloud-vm-topic">
                  {t('webui.cloudVm.topicLabel')}
                </label>
                <input
                  id="cloud-vm-topic"
                  className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  value={topic}
                  disabled={submitting}
                  placeholder={t('webui.cloudVm.topicPlaceholder')}
                  onChange={(event) => setTopic(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canSubmitTopic) void submit()
                  }}
                />
              </div>
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                disabled={!canSubmitTopic}
                onClick={() => void submit()}
              >
                {submitting ? t('webui.cloudVm.submitting') : t('webui.cloudVm.submit')}
              </button>
              {submitError && (
                <p role="alert" className="text-xs text-destructive/90">
                  {submitError}
                </p>
              )}
            </section>

            {listLoading && (
              <p role="status" className="text-sm text-text-muted">
                {t('webui.cloudVm.loading')}
              </p>
            )}

            {listError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <span className="min-w-0 whitespace-normal break-words">{listError}</span>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => void loadRuns()}>
                  {t('webui.cloudVm.refresh')}
                </button>
              </div>
            )}

            {!listLoading && !listError && runs.length === 0 && (
              <p className="text-sm text-text-secondary">{t('webui.cloudVm.empty')}</p>
            )}

            {runs.length > 0 && (
              <ul className="flex flex-col gap-2">
                {runs.map((run) => {
                  const state = run.status?.state
                  const progress = run.status?.progress
                  return (
                    <li key={run.id} className={`${CARD_CLASS} gap-2 p-4`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs text-text-muted" title={run.id}>
                          {shortRunId(run.id)}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {t('webui.cloudVm.stateLabel')}: {t(runStateMessageKey(state))}
                        </span>
                      </div>
                      <p className="min-w-0 whitespace-normal break-words text-sm" title={run.topic ?? run.name}>
                        {run.topic ?? run.name ?? run.id}
                      </p>
                      {progress && (
                        <p aria-live="polite" className="text-xs text-text-muted">
                          {progress.completed}/{progress.total}
                        </p>
                      )}
                      {run.status?.failureReason && (
                        <p className="whitespace-normal break-words text-xs text-destructive/90">
                          {run.status.failureReason}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={PRIMARY_BUTTON_CLASS}
                          onClick={() => {
                            onOpenRun(run.id)
                          }}
                        >
                          {t('webui.cloudVm.open')}
                        </button>
                        {canCancelRun(run) && (
                          <button
                            type="button"
                            className={SECONDARY_BUTTON_CLASS}
                            disabled={cancelingId === run.id}
                            onClick={() => void cancel(run.id)}
                          >
                            {cancelingId === run.id ? t('webui.cloudVm.canceling') : t('webui.cloudVm.cancel')}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}