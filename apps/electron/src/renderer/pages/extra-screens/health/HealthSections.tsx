/**
 * Presentation for «Состояние»: a flat status list (name + token dot) and the
 * click-through detail. The dot mirrors the feed health dot's token classes
 * (`success`/`warning`/`destructive`/muted) — imported from the feed is not
 * possible because its labels are feed-specific and it has no warning state.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Chip, ListRow, SectionLabel } from '../ui'
import type { HealthRow, HealthSection, HealthStatus } from './health-model'

const DOT_CLS: Record<HealthStatus, string> = {
  ok: 'bg-success',
  warn: 'bg-status-warning',
  error: 'bg-destructive',
  unknown: 'bg-text-muted',
}

const STATUS_KEY: Record<HealthStatus, string> = {
  ok: 'extraScreens.health.status.ok',
  warn: 'extraScreens.health.status.warn',
  error: 'extraScreens.health.status.error',
  unknown: 'extraScreens.health.status.unknown',
}

const STATUS_TONE: Record<HealthStatus, 'ok' | 'warn' | 'err' | 'neutral'> = {
  ok: 'ok',
  warn: 'warn',
  error: 'err',
  unknown: 'neutral',
}

export function HealthStatusDot({ status, className }: { status: HealthStatus; className?: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT_CLS[status], className)} />
}

export function HealthStatusChip({ status }: { status: HealthStatus }) {
  const { t } = useTranslation()
  return <Chip tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</Chip>
}

export function HealthSectionList({
  sections,
  selectedId,
  onSelect,
}: {
  sections: readonly HealthSection[]
  selectedId: string | null
  onSelect: (row: HealthRow) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="px-2 pb-4">
      {sections.map((section) => (
        <section key={section.id} className="mb-4">
          <div className="px-2">
            <SectionLabel>{t(`extraScreens.health.section.${section.id}`)}</SectionLabel>
          </div>
          {section.rows.map((row) => (
            <ListRow key={row.id} active={row.id === selectedId} onClick={() => onSelect(row)}>
              <HealthStatusDot status={row.status} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate" data-testid={`health-row-${row.id}`}>
                  {t(row.labelKey, row.labelParams)}
                </span>
                <span className="mt-0.5 block truncate text-small text-muted-foreground">
                  {t(row.detailKey, row.detailParams)}
                </span>
              </span>
            </ListRow>
          ))}
        </section>
      ))}
    </div>
  )
}

export function HealthRowDetail({
  row,
  onFix,
  extra,
}: {
  row: HealthRow
  onFix?: (row: HealthRow) => void
  extra?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 max-w-[720px]">
      <div className="flex flex-wrap items-center gap-2">
        <HealthStatusDot status={row.status} className="size-2.5" />
        <h2 className="text-title font-bold leading-tight">{t(row.labelKey, row.labelParams)}</h2>
        <HealthStatusChip status={row.status} />
        <span className="flex-1" />
        {row.fix && onFix && (
          <button
            type="button"
            onClick={() => onFix(row)}
            className="inline-flex h-7 items-center rounded-[var(--radius-control)] bg-surface-hover px-2.5 text-small text-foreground transition-colors hover:bg-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
          >
            {t('extraScreens.health.fix')}
          </button>
        )}
      </div>
      <p className="mt-2 text-text-secondary">{t(row.detailKey, row.detailParams)}</p>
      {row.rawDetail && (
        <pre className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[var(--radius-card)] bg-surface-hover px-3 py-2 font-mono text-small text-muted-foreground">
          {row.rawDetail}
        </pre>
      )}
      {extra && <div className="mt-4">{extra}</div>}
    </div>
  )
}