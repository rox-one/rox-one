import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, RefreshCw } from 'lucide-react'
import type { NoteIndexHealth } from '../../../shared/types'

export const EMPTY_NOTE_INDEX_HEALTH: NoteIndexHealth = {
  ok: false,
  available: false,
  dbPath: '',
  schemaVersion: null,
  documentCount: 0,
  recovered: false,
  indexed: 0,
  unchanged: 0,
  skipped: 0,
  truncated: false,
  watching: false,
  lastExternalChangeAt: null,
}

export function VaultIndexHealthPanel({
  health,
  rebuilding,
  onRebuild,
}: {
  health: NoteIndexHealth
  rebuilding: boolean
  onRebuild(): void
}) {
  const { t } = useTranslation()
  const lastChange = health.lastExternalChangeAt
    ? new Date(health.lastExternalChangeAt).toLocaleTimeString()
    : null

  return (
    <section className="mb-5" data-testid="notes-index-health">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        {t('notes.inspector.indexHealth')}
      </div>
      <div className="space-y-1 rounded-[6px] border border-border/60 px-2 py-1.5">
        <div className="text-xs font-medium">
          {health.ok ? t('notes.inspector.indexOk') : t('notes.inspector.indexUnavailable')}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('notes.inspector.indexSchema', { version: health.schemaVersion ?? '—' })}
          {' · '}
          {t('notes.inspector.indexDocuments', { count: health.documentCount })}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('notes.inspector.indexStats', {
            indexed: health.indexed,
            unchanged: health.unchanged,
            skipped: health.skipped,
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {health.watching ? t('notes.inspector.indexWatching') : t('notes.inspector.indexNotWatching')}
          {lastChange ? ` · ${t('notes.inspector.indexLastChange', { time: lastChange })}` : null}
        </div>
        {health.recovered ? (
          <div className="text-[11px] text-muted-foreground">{t('notes.inspector.indexRecovered')}</div>
        ) : null}
        {health.truncated ? (
          <div className="text-[11px] text-muted-foreground">{t('notes.inspector.indexTruncated')}</div>
        ) : null}
        <button
          type="button"
          className="mt-1 inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]"
          onClick={onRebuild}
          disabled={rebuilding}
        >
          <RefreshCw className={`h-3 w-3 ${rebuilding ? 'animate-spin' : ''}`} />
          {rebuilding ? t('notes.inspector.indexRebuilding') : t('notes.inspector.indexRebuild')}
        </button>
      </div>
    </section>
  )
}
