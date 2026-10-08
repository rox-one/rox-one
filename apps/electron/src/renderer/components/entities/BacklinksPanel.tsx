/**
 * W1-08 (#1505) — «Упоминается в» / ReferencedIn panel.
 *
 * Lists entities that link to `entityRef`, grouped by kind. Rows are entity
 * chips (drag source + row menu) with the relation label. Presentational part
 * (`BacklinksList`) is separate so stories/tests can feed links directly.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { EntityLink, EntityRef } from '@rox/core/entities'
import { FOCUS_RING, MOTION_FAST } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { EntityChip } from './EntityChip'
import { groupBacklinks } from './backlink-groups'
import { useEntityBacklinks, type EntityBacklinksState } from './use-entity-backlinks'
import { useEntityWorkspaceId } from './entity-context'
import type { EntityPreviewView } from './use-entity-preview'

export const BACKLINKS_GROUP_PREVIEW = 5

export interface BacklinksListProps {
  state: EntityBacklinksState
  onRetry?: () => void
  onLoadMore?: () => void
  /** Controlled previews keyed by formatted ref (stories/tests). */
  previews?: Record<string, EntityPreviewView>
  previewsEnabled?: boolean
  className?: string
}

export function BacklinksList({ state, onRetry, onLoadMore, previews, previewsEnabled, className }: BacklinksListProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const groups = React.useMemo(() => groupBacklinks(state.links), [state.links])
  const total = groups.reduce((sum, group) => sum + group.sources.length, 0)
  const headingId = React.useId()

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)} data-entity-backlinks="">
      <h3 id={headingId} className="flex items-baseline gap-2 text-[13px] font-semibold text-foreground">
        {t('entities.ui.backlinks.title')}
        {state.status === 'ready' && total > 0 && (
          <span className="text-[12px] font-normal text-text-muted">{t('entities.ui.backlinks.count', { count: total })}</span>
        )}
      </h3>
      {state.status === 'loading' && state.links.length === 0 && (
        <p className="text-[12px] text-text-muted" aria-busy="true">{t('entities.ui.backlinks.loading')}</p>
      )}
      {state.status === 'error' && (
        <button type="button" onClick={onRetry} className={cn('self-start text-[12px] text-status-danger underline-offset-2 hover:underline', FOCUS_RING)}>
          {t('entities.ui.backlinks.error')}
        </button>
      )}
      {state.status === 'ready' && total === 0 && (
        <p className="text-[12px] text-text-muted">{t('entities.ui.backlinks.empty')}</p>
      )}
      {groups.map(({ group, sources }) => {
        const open = expanded[group] ?? false
        const visible = open ? sources : sources.slice(0, BACKLINKS_GROUP_PREVIEW)
        return (
          <div key={group} className="flex flex-col gap-1" data-backlink-group={group}>
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {t(`entities.ui.backlinks.group.${group}`)} · {sources.length}
            </h4>
            <ul className="flex flex-col gap-1">
              {visible.map((source) => (
                <li key={source.key} className="flex min-w-0 items-center gap-2 text-[12px]">
                  <EntityChip
                    entityRef={source.link.from}
                    preview={previews?.[source.key]}
                    previewsEnabled={previewsEnabled}
                  />
                  <span className="truncate text-text-muted">
                    {source.relations.map((relation) => t(`entities.ui.backlinks.relation.${relation}`)).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            {sources.length > visible.length && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [group]: true }))}
                className={cn('self-start text-[12px] text-accent hover:underline', MOTION_FAST, FOCUS_RING)}
              >
                {t('entities.ui.backlinks.showAll')}
              </button>
            )}
          </div>
        )
      })}
      {state.status === 'ready' && state.nextCursor && (
        <button type="button" onClick={onLoadMore} className={cn('self-start text-[12px] text-accent hover:underline', FOCUS_RING)}>
          {t('entities.ui.backlinks.showAll')}
        </button>
      )}
    </section>
  )
}

export interface BacklinksPanelProps {
  entityRef: EntityRef
  workspaceId?: string | null
  /** Caller-resolved gate; the panel never fetches while false. */
  enabled: boolean
  className?: string
}

/** Data-bound panel (uses the entity data source). */
export function BacklinksPanel({ entityRef, workspaceId: explicit, enabled, className }: BacklinksPanelProps) {
  const workspaceId = useEntityWorkspaceId(explicit)
  const { state, retry, loadMore } = useEntityBacklinks(entityRef, workspaceId, enabled)
  if (!enabled) return null
  return <BacklinksList state={state} onRetry={retry} onLoadMore={loadMore} className={className} />
}

export type { EntityLink }
