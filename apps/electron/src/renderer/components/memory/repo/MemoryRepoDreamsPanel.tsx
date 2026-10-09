/**
 * Память → Репозиторий → Сны.
 *
 * Last-run card, interval/next-run, `[Собрать сейчас]` (disabled while
 * running) and the live dream-event stream (auto-scrolled to the newest
 * entry), plus the runs derived from the journal. Pure props from the shell;
 * the button only calls `onRunNow`.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Play, TriangleAlert } from 'lucide-react'
import type { MemoryDreamEvent, MemoryDreamRun, MemoryDreamStatus } from '@rox/shared/memory/repo'
import { cn } from '@/lib/utils'

export interface MemoryRepoDreamsPanelProps {
  bankId: string
  status: MemoryDreamStatus | null
  log: MemoryDreamEvent[]
  running: boolean
  onRunNow(): void
}

const RUN_STATUS_TONE: Record<MemoryDreamRun['status'], string> = {
  running: 'bg-accent/12 text-accent',
  ok: 'bg-success/12 text-success',
  error: 'bg-destructive/12 text-destructive',
  skipped: 'bg-foreground/8 text-text-muted',
}

const RUN_STATUS_KEY: Record<MemoryDreamRun['status'], string> = {
  running: 'memory.repo.dreams.statusRunning',
  ok: 'memory.repo.dreams.statusOk',
  error: 'memory.repo.dreams.statusError',
  skipped: 'memory.repo.dreams.statusSkipped',
}

/** `2026-10-09T08:00:00.000Z` → `08:00:00` (stable, UTC, no locale). */
function formatEventTime(ts: string): string {
  return ts.slice(11, 19)
}

/** Distinct runs in first-seen journal order, newest state per run. */
export function groupDreamRuns(log: MemoryDreamEvent[]): MemoryDreamRun[] {
  const byId = new Map<string, MemoryDreamRun>()
  for (const event of log) {
    const existing = byId.get(event.dreamId)
    if (!existing) {
      byId.set(event.dreamId, {
        dreamId: event.dreamId,
        bankId: event.bankId,
        startedAt: event.ts,
        endedAt: event.kind === 'end' || event.kind === 'error' ? event.ts : null,
        status: event.kind === 'error' ? 'error' : event.kind === 'end' ? 'ok' : 'running',
        model: event.model,
        costUsd: event.costUsd ?? 0,
        costIsEstimate: false,
      })
      continue
    }
    if (event.model && !existing.model) existing.model = event.model
    if (event.costUsd) existing.costUsd += event.costUsd
    if (event.kind === 'error') {
      existing.status = 'error'
      existing.endedAt = event.ts
      existing.error = event.message
    } else if (event.kind === 'end') {
      if (existing.status !== 'error') existing.status = 'ok'
      existing.endedAt = event.ts
    }
  }
  return [...byId.values()]
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 4 : 3)}`
}

export function MemoryRepoDreamsPanel({ status, log, running, onRunNow }: MemoryRepoDreamsPanelProps) {
  const { t } = useTranslation()
  const streamRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const element = streamRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [log.length])

  if (!status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center" data-testid="memory-repo-dreams-empty">
        <span className="grid size-12 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
          <Moon aria-hidden="true" className="size-6" />
        </span>
        <p className="text-sm text-text-secondary">{t('memory.repo.dreams.empty')}</p>
      </div>
    )
  }

  const lastRun = status.lastRun
  const runs = groupDreamRuns(log)
  const busy = running || lastRun?.status === 'running'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" data-testid="memory-repo-dreams-panel">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
          <Moon aria-hidden="true" className="size-5" />
        </span>
        <h2 className="text-sm font-semibold">{t('memory.repo.tab.dreams')}</h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRunNow}
          disabled={busy}
          data-testid="memory-repo-dreams-run"
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3 text-[13px] font-medium text-[var(--accent-foreground,white)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play aria-hidden="true" className="size-4" />
          {busy ? t('memory.repo.state.dreamRunning') : t('memory.repo.action.dreamNow')}
        </button>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] border border-foreground/8 bg-background px-3 py-2" data-testid="memory-repo-dreams-last-run">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted/70">{t('memory.repo.lastDream')}</div>
          {lastRun ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <span className={cn('rounded-[var(--radius-control)] px-1.5 py-px text-[10px] leading-4', RUN_STATUS_TONE[lastRun.status])} data-testid={`memory-repo-dreams-status-${lastRun.status}`}>
                {t(RUN_STATUS_KEY[lastRun.status])}
              </span>
              <span className="text-text-muted">{formatEventTime(lastRun.startedAt)}</span>
              {lastRun.model ? <span className="text-text-secondary" data-testid="memory-repo-dreams-model">{lastRun.model}</span> : null}
              <span className="tabular-nums text-text-secondary" data-testid="memory-repo-dreams-last-cost">
                {fmtUsd(lastRun.costUsd)}
                {lastRun.costIsEstimate ? <span className="ml-1 text-text-muted">({t('memory.repo.costEstimate')})</span> : null}
              </span>
            </div>
          ) : (
            <p className="text-[12px] text-text-muted">{t('memory.repo.dreams.empty')}</p>
          )}
        </div>

        <div className="rounded-[var(--radius-control)] border border-foreground/8 bg-background px-3 py-2" data-testid="memory-repo-dreams-schedule">
          <dl className="flex flex-col gap-1 text-[12px]">
            <div className="flex items-center gap-2">
              <dt className="text-text-muted">{t('memory.repo.dreams.interval')}</dt>
              <dd className="ml-auto tabular-nums">{status.intervalHours} {t('memory.repo.dreams.hours')}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-text-muted">{t('memory.repo.nextDream')}</dt>
              <dd className="ml-auto tabular-nums" data-testid="memory-repo-dreams-next">{status.nextRunAt ? formatEventTime(status.nextRunAt) : '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-text-muted">{t('memory.repo.costToday')}</dt>
              <dd className="ml-auto tabular-nums" data-testid="memory-repo-dreams-cost-today">
                {fmtUsd(status.costTodayUsd)}
                {status.costIsEstimate ? <span className="ml-1 text-text-muted">({t('memory.repo.costEstimate')})</span> : null}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {lastRun?.status === 'error' ? (
        <div className="rounded-[var(--radius-control)] border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-text-secondary" data-testid="memory-repo-dreams-failed" role="alert">
          <span className="mr-1 inline-flex items-center gap-1 font-medium text-destructive">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            {t('memory.repo.state.dreamFailed')}
          </span>
          {lastRun.error}
        </div>
      ) : null}

      <div className="min-h-[160px] rounded-[var(--radius-control)] border border-foreground/8 bg-background">
        <div className="border-b border-foreground/8 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted/70">{t('memory.repo.dreams.stream')}</div>
        <div ref={streamRef} className="max-h-[280px] overflow-y-auto px-3 py-1.5" data-testid="memory-repo-dreams-stream">
          {log.length === 0 ? (
            <p className="py-2 text-[12px] text-text-muted">{t('memory.repo.dreams.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] leading-5">
              {log.map((event, index) => (
                <li key={`${event.dreamId}:${index}`} className="flex min-w-0 items-baseline gap-2" data-testid="memory-repo-dreams-event" data-kind={event.kind}>
                  <span className="shrink-0 tabular-nums text-text-muted">{formatEventTime(event.ts)}</span>
                  <span className="shrink-0 rounded-[var(--radius-control)] bg-foreground/5 px-1 text-[10px] text-text-secondary">{t(`memory.repo.dreams.kind.${event.kind}`)}</span>
                  <span className="min-w-0 flex-1 truncate" title={event.message}>{event.message}</span>
                  {typeof event.inputTokens === 'number' || typeof event.outputTokens === 'number' ? (
                    <span className="shrink-0 tabular-nums text-text-muted">
                      {event.inputTokens ?? 0}/{event.outputTokens ?? 0}
                    </span>
                  ) : null}
                  {typeof event.costUsd === 'number' ? <span className="shrink-0 tabular-nums text-text-muted">{fmtUsd(event.costUsd)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="rounded-[var(--radius-control)] border border-foreground/8 bg-background" data-testid="memory-repo-dreams-runs">
          <div className="border-b border-foreground/8 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted/70">{t('memory.repo.dreams.runs')}</div>
          <ul className="flex flex-col gap-0.5 px-2 py-1.5 text-[12px]">
            {runs.map((run) => (
              <li key={run.dreamId} className="flex min-w-0 items-center gap-2" data-testid="memory-repo-dreams-run-row">
                <span className={cn('shrink-0 rounded-[var(--radius-control)] px-1.5 py-px text-[10px] leading-4', RUN_STATUS_TONE[run.status])}>{t(RUN_STATUS_KEY[run.status])}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{formatEventTime(run.startedAt)}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={run.dreamId}>{run.dreamId}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{fmtUsd(run.costUsd)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
