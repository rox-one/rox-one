/**
 * Diff artifact: token-tinted rows, mono, its own header with counts.
 * Ported from the G5 kit (`G5Diff`).
 */
import * as React from 'react'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ArtifactShell } from './ArtifactShell'
import { ContinuumBadge } from './primitives'

export interface ContinuumDiffRow {
  kind: 'context' | 'add' | 'remove' | 'hunk'
  oldLine?: number
  newLine?: number
  text: string
}

export interface DiffArtifactProps {
  path: string
  added: number
  removed: number
  rows: ContinuumDiffRow[]
  /** Controlled expansion; when omitted the artifact owns its toggle. */
  expanded?: boolean
  defaultExpanded?: boolean
  onToggle?: () => void
}

/** Rows rendered while collapsed — the kit keeps the first six in view. */
const COLLAPSED_ROWS = 6

export function DiffArtifact({
  path,
  added,
  removed,
  rows,
  expanded,
  defaultExpanded = true,
  onToggle,
}: DiffArtifactProps) {
  const { t } = useTranslation()
  const headingId = React.useId()
  const [internalExpanded, setInternalExpanded] = React.useState(defaultExpanded)
  const isExpanded = expanded ?? internalExpanded
  const visible = isExpanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  const handleToggle = () => {
    if (onToggle) onToggle()
    else setInternalExpanded((value) => !value)
  }

  return (
    <ArtifactShell
      labelledBy={headingId}
      icon={<FileText className="icon-toolbar" />}
      title={t('chat.continuum.diff.title', { defaultValue: 'Правка' })}
      subtitle={path}
      headerActions={
        <>
          <ContinuumBadge tone="success" mono>
            +{added}
          </ContinuumBadge>
          <ContinuumBadge tone="danger" mono>
            −{removed}
          </ContinuumBadge>
          {rows.length > COLLAPSED_ROWS && (
            <button
              type="button"
              onClick={handleToggle}
              aria-expanded={isExpanded}
              className="inline-flex min-h-[28px] items-center rounded-[var(--radius-control)] px-1.5 text-caption text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring motion-reduce:transition-none"
            >
              {isExpanded
                ? t('chat.continuum.diff.collapse', { defaultValue: 'Свернуть' })
                : t('chat.continuum.diff.expand', { defaultValue: 'Показать всё' })}
            </button>
          )}
        </>
      }
    >
      <div className="overflow-x-auto py-1 font-mono text-caption leading-[var(--text-body-leading)]">
        {visible.map((row, index) => (
          <div
            key={`${index}-${row.kind}-${row.text}`}
            data-g05-diff-row={row.kind}
            className={cn(
              'grid grid-cols-[52px_minmax(0,1fr)] gap-2 whitespace-pre px-3',
              row.kind === 'add' && 'bg-[color-mix(in_oklab,var(--status-success)_12%,transparent)]',
              row.kind === 'remove' && 'bg-[color-mix(in_oklab,var(--status-danger)_12%,transparent)]',
              row.kind === 'hunk' && 'text-text-muted',
            )}
          >
            <span className="select-none text-right numeric text-text-secondary">
              {row.kind === 'hunk' ? '' : (row.newLine ?? row.oldLine ?? '')}
            </span>
            <span className="min-w-0 text-text-primary">
              <span
                aria-hidden
                className={cn(
                  'mr-1.5 select-none',
                  row.kind === 'add' && 'text-success-text',
                  row.kind === 'remove' && 'text-destructive-text',
                  row.kind === 'context' && 'text-text-muted',
                  row.kind === 'hunk' && 'text-info-text',
                )}
              >
                {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : row.kind === 'hunk' ? '@@' : ' '}
              </span>
              {row.text}
            </span>
          </div>
        ))}
        {!isExpanded && rows.length > visible.length && (
          <div className="px-3 py-1 text-text-secondary">
            {t('chat.continuum.diff.more', { count: rows.length - visible.length, defaultValue: 'ещё {{count}} строк' })}
          </div>
        )}
      </div>
    </ArtifactShell>
  )
}