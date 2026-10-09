import { useTranslation } from 'react-i18next'
import { FolderGit2, FolderOpen, RefreshCw, Trash2, X } from 'lucide-react'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DEV_SPACE_PHASE_KEYS, DEV_SPACE_SOURCE_KEYS, DEV_SPACE_STATUS_KEYS, DEV_SPACE_STATUS_VARIANT, isRepositoryOutdated } from './status'

export interface CloneProgress { phase: string; receivedBytes?: number; totalBytes?: number }

export interface RepositoryCardProps {
  record: DevSpaceRepositoryRecord
  progress?: CloneProgress
  busy?: boolean
  onOpen: (record: DevSpaceRepositoryRecord) => void
  onRefresh: (record: DevSpaceRepositoryRecord) => void
  onRemove: (record: DevSpaceRepositoryRecord) => void
  onCancel: (record: DevSpaceRepositoryRecord) => void
}

/** One catalog card (С-01 §B.1): name/source, status, freshness badge, actions. */
export function RepositoryCard({ record, progress, busy, onOpen, onRefresh, onRemove, onCancel }: RepositoryCardProps) {
  const { t } = useTranslation()
  const outdated = isRepositoryOutdated(record)
  const active = record.status === 'cloning' || record.status === 'analyzing'
  const determinate = progress?.totalBytes !== undefined && progress.totalBytes > 0
  const percent = determinate && progress ? Math.round((progress.receivedBytes ?? 0) / progress.totalBytes! * 100) : 0
  const phase = progress ? t(DEV_SPACE_PHASE_KEYS[progress.phase] ?? 'devSpace.progress.working') : null
  const source = record.origin.kind === 'git-url' ? record.origin.url : record.origin.path

  return (
    <article
      data-testid={`dev-space-repo-${record.id}`}
      onClick={() => onOpen(record)}
      className={cn(
        'group flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border-subtle p-4 text-left transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
        'cursor-pointer bg-surface-elevated hover:bg-surface-hover',
      )}
      aria-busy={busy === true || active}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 text-muted-foreground" aria-hidden>{record.origin.kind === 'git-url' ? <FolderGit2 className="icon-inline" /> : <FolderOpen className="icon-inline" />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0">
            <button type="button" onClick={() => onOpen(record)} className="block max-w-full truncate text-left text-sm font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring">{record.displayName}</button>
          </h3>
          <p className="truncate text-xs text-muted-foreground">{t(DEV_SPACE_SOURCE_KEYS[record.origin.kind])} · <span className="font-mono">{source}</span></p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={DEV_SPACE_STATUS_VARIANT[record.status]}>{t(DEV_SPACE_STATUS_KEYS[record.status])}</Badge>
          {outdated ? <Badge variant="outline" data-testid="dev-space-outdated">{t('devSpace.repository.outdated')}</Badge> : null}
        </div>
      </div>

      {progress && active ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{phase}</span>
            {determinate ? <span className="tabular-nums">{t('devSpace.progress.bytes', { done: progress.receivedBytes ?? 0, total: progress.totalBytes })}</span> : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-pressed" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} {...(determinate ? { 'aria-valuenow': percent } : {})}>
            <div className={cn('h-full rounded-full bg-accent transition-[width] duration-[var(--motion-fast)] motion-reduce:transition-none', !determinate && 'w-1/3 animate-pulse motion-reduce:animate-none')} style={determinate ? { width: `${percent}%` } : undefined} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onRefresh(record)}>
          <RefreshCw className="icon-caption" aria-hidden />{t('devSpace.repository.refresh')}
        </Button>
        {active ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(record)}>
            <X className="icon-caption" aria-hidden />{t('devSpace.repository.cancel')}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(record)}>
            <Trash2 className="icon-caption" aria-hidden />{t('devSpace.repository.remove')}
          </Button>
        )}
      </div>
    </article>
  )
}