/**
 * Память → Репозиторий → История.
 *
 * Left: commit list (short sha, ISO-UTC time, message, `+N/−M`). Right: the
 * selected commit's changed files with `added`/`modified`/`deleted` badges.
 * `mode:'snapshots'` (git unavailable) shows an explicit banner. The frozen
 * DTO carries ops + line stats only (no patch/contents), so no raw-diff viewer
 * is mounted here — see `deviations` in the A6 report.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CircleDot, GitCommitHorizontal, TriangleAlert } from 'lucide-react'
import type { MemoryRepoCommit, MemoryRepoCommitFile } from '@rox/shared/memory/repo'
import { cn } from '@/lib/utils'

export interface MemoryRepoHistoryPanelProps {
  bankId: string
  commits: MemoryRepoCommit[]
  selectedSha: string | null
  onSelect(sha: string): void
  diff: MemoryRepoCommitFile[]
  loading: boolean
  mode: 'git' | 'snapshots'
}

const OP_TONE: Record<MemoryRepoCommitFile['op'], string> = {
  added: 'bg-success/12 text-success',
  modified: 'bg-accent/12 text-accent',
  deleted: 'bg-destructive/12 text-destructive',
}

/** `2026-10-09T08:00:00.000Z` → `2026-10-09 08:00` (stable, UTC, no locale). */
export function formatCommitTime(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ')
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function MemoryRepoHistoryPanel({
  commits,
  selectedSha,
  onSelect,
  diff,
  loading,
  mode,
}: MemoryRepoHistoryPanelProps) {
  const { t } = useTranslation()
  const selectedCommit = commits.find((commit) => commit.sha === selectedSha) ?? null

  const list = (
    <div
      data-testid="memory-repo-history-list"
      className="flex min-h-0 w-[268px] shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-foreground-2 py-2"
    >
      {loading ? (
        <div className="px-4 py-4 text-body text-text-muted" data-testid="memory-repo-history-loading">{t('memory.repo.state.loading')}</div>
      ) : commits.length === 0 ? (
        <div className="mx-3 mt-2 flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-border-strong bg-background/60 px-4 py-8 text-center" data-testid="memory-repo-history-empty">
          <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
            <GitCommitHorizontal aria-hidden="true" className="icon-rail" />
          </span>
          <p className="text-body font-medium">{t('memory.repo.history.empty')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-px px-1.5">
          {commits.map((commit) => {
            const selected = commit.sha === selectedSha
            return (
              <li key={commit.sha}>
                <button
                  type="button"
                  onClick={() => onSelect(commit.sha)}
                  aria-current={selected ? 'true' : undefined}
                  data-testid={`memory-repo-commit-${commit.sha}`}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected ? 'bg-accent/10' : 'hover:bg-surface-hover',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <CircleDot aria-hidden="true" className="icon-status shrink-0 text-text-muted" />
                    <code className={cn('text-caption', selected ? 'font-semibold text-accent' : 'text-text-secondary')}>{shortSha(commit.sha)}</code>
                    <span className="ml-auto text-caption text-text-muted">{formatCommitTime(commit.ts)}</span>
                  </span>
                  <span className="line-clamp-2 text-small text-foreground-90">{commit.message}</span>
                  <span className="flex items-center gap-2 text-caption tabular-nums">
                    <span className="text-success">+{commit.stats.added}</span>
                    <span className="text-destructive">−{commit.stats.deleted}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const detail = (() => {
    if (mode === 'snapshots') {
      return (
        <div className="mb-3 rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/10 px-3 py-2 text-small text-text-secondary" data-testid="memory-repo-history-snapshots" role="status">
          {t('memory.repo.history.snapshots')}
        </div>
      )
    }
    return null
  })()

  const diffBody = (() => {
    if (loading) return null
    if (!selectedSha) {
      return <div className="px-5 py-6 text-body text-text-muted" data-testid="memory-repo-history-no-selection">{t('memory.repo.history.selectCommit')}</div>
    }
    // A non-empty diff wins over the commit list: a deep-linked sha older than
    // the newest-100 window is not in `commits` but its diff is fetched fine.
    if (diff.length > 0) {
      return (
        <ul className="flex flex-col gap-1" data-testid="memory-repo-history-diff">
          {diff.map((change) => (
            <li key={`${change.op}:${change.path}`} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-background px-2.5 py-1.5">
              <span className={cn('shrink-0 rounded-[var(--radius-control)] px-1.5 py-px text-caption leading-4', OP_TONE[change.op])} data-testid={`memory-repo-diff-op-${change.op}`}>
                {t(`memory.repo.history.op.${change.op}`)}
              </span>
              <span className="min-w-0 flex-1 truncate text-small" title={change.path}>{change.path}</span>
              <span className="shrink-0 text-caption tabular-nums">
                <span className="text-success">+{change.additions}</span>{' '}
                <span className="text-destructive">−{change.deletions}</span>
              </span>
            </li>
          ))}
        </ul>
      )
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center" data-testid="memory-repo-history-no-changes" role="alert">
        <TriangleAlert aria-hidden="true" className="icon-rail text-status-warning" />
        <p className="text-body text-text-secondary">{selectedCommit ? t('memory.repo.history.noChanges') : t('memory.repo.state.commitNotFound')}</p>
      </div>
    )
  })()

  return (
    <div className="flex min-h-0 flex-1" data-testid="memory-repo-history-panel">
      {list}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedCommit ? (
          <header className="shrink-0 px-5 pt-4 pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="text-caption text-text-secondary">{shortSha(selectedCommit.sha)}</code>
              <span className="text-caption text-text-muted">{formatCommitTime(selectedCommit.ts)}</span>
              <span className="flex items-center gap-2 text-caption tabular-nums">
                <span className="text-success">+{selectedCommit.stats.added}</span>
                <span className="text-destructive">−{selectedCommit.stats.deleted}</span>
              </span>
            </div>
            <p className="mt-1 text-body font-medium">{selectedCommit.message}</p>
          </header>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {detail}
          {diffBody}
        </div>
      </section>
    </div>
  )
}
