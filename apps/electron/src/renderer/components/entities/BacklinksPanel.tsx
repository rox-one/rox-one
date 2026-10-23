/**
 * W1-08 (#1505) — «Упоминается в» / ReferencedIn panel.
 *
 * Lists entities that link to `entityRef`, grouped by kind. Rows are entity
 * chips (drag source + row menu) with the relation label. Presentational part
 * (`BacklinksList`) is separate so stories/tests can feed links directly.
 *
 * WP3.2: canvas `embeds` backlinks render as «На доске {board title}» and
 * open `canvas/board/{id}#{objectId}` via `openEntity` (focuses the card).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { EntityLink, EntityRef } from '@rox/core/entities'
import { FOCUS_RING, MOTION_FAST } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { EntityChip } from './EntityChip'
import { groupBacklinks, type BacklinkSource } from './backlink-groups'
import {
  canvasBacklinkBoardRef,
  canvasBacklinkOpenRef,
  formatOnBoardBacklinkLabel,
  isCanvasEmbedBacklink,
} from './canvas-backlink'
import { useEntityBacklinks, type EntityBacklinksState } from './use-entity-backlinks'
import { useEntityWorkspaceId } from './entity-context'
import { openEntity } from './open-entity'
import { useEntityPreview, type EntityPreviewView } from './use-entity-preview'
import { useEntityPreviewsEnabled } from './flags'

export const BACKLINKS_GROUP_PREVIEW = 5

export interface BacklinksListProps {
  state: EntityBacklinksState
  onRetry?: () => void
  onLoadMore?: () => void
  /** Controlled previews keyed by formatted ref (stories/tests). */
  previews?: Record<string, EntityPreviewView>
  previewsEnabled?: boolean
  workspaceId?: string | null
  className?: string
}

/** One `canvas:list` per panel — board id → title (fallback when resolve has no owner yet). */
function useCanvasBoardTitles(workspaceId: string | null | undefined): ReadonlyMap<string, string> {
  const [titles, setTitles] = React.useState<ReadonlyMap<string, string>>(() => new Map())
  React.useEffect(() => {
    if (!workspaceId) { setTitles(new Map()); return }
    const list = (window as unknown as { electronAPI?: { canvas?: { list?: (ws: string) => Promise<Array<{ id: string; title: string }>> } } }).electronAPI?.canvas?.list
    if (!list) return
    let cancelled = false
    void list(workspaceId).then((boards) => {
      if (cancelled) return
      setTitles(new Map(boards.map((b) => [b.id, b.title])))
    }).catch(() => { /* bridge unavailable — preview/fallback covers it */ })
    return () => { cancelled = true }
  }, [workspaceId])
  return titles
}

function titleOfPreview(view: EntityPreviewView | undefined): string | undefined {
  if (!view || view.restricted || !view.title) return undefined
  if (view.status === 'no_access' || view.status === 'tombstone' || view.status === 'unavailable') return undefined
  return view.title
}

/** True when resolve definitively denied / removed the board — do not fall back to canvas:list. */
function resolveDeniesTitle(view: EntityPreviewView | undefined): boolean {
  if (!view) return false
  return !!view.restricted || view.status === 'no_access' || view.status === 'tombstone'
}

function CanvasOnBoardRow({
  source,
  preview,
  previewsEnabled,
  workspaceId,
  listTitle,
}: {
  source: BacklinkSource
  preview?: EntityPreviewView
  previewsEnabled?: boolean
  workspaceId?: string | null
  listTitle?: string
}) {
  const { t } = useTranslation()
  const boardRef = canvasBacklinkBoardRef(source.link)
  const openRef = canvasBacklinkOpenRef(source.link)
  const flagOn = useEntityPreviewsEnabled()
  const enabled = previewsEnabled ?? flagOn
  const resolved = useEntityPreview(boardRef, workspaceId, enabled)
  const resolvedPreview = resolved.status === 'ready' ? resolved.preview : undefined
  // ACL: never use canvas:list after resolve said no_access / tombstone / restricted.
  const title = resolveDeniesTitle(preview) || resolveDeniesTitle(resolvedPreview)
    ? ''
    : (titleOfPreview(preview) || titleOfPreview(resolvedPreview) || listTitle || '')
  const label = formatOnBoardBacklinkLabel(t, title)
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm" data-canvas-backlink="">
      <button
        type="button"
        onClick={(event) => openEntity(openRef, { newPanel: event.metaKey || event.ctrlKey })}
        className={cn('min-w-0 truncate text-left text-accent hover:underline', MOTION_FAST, FOCUS_RING)}
        title={label}
        aria-label={label}
      >
        {label}
      </button>
    </li>
  )
}

export function BacklinksList({ state, onRetry, onLoadMore, previews, previewsEnabled, workspaceId, className }: BacklinksListProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const groups = React.useMemo(() => groupBacklinks(state.links), [state.links])
  const boardTitles = useCanvasBoardTitles(workspaceId)
  const total = groups.reduce((sum, group) => sum + group.sources.length, 0)
  const headingId = React.useId()

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)} data-entity-backlinks="">
      <h3 id={headingId} className="flex items-baseline gap-2 text-base font-semibold text-foreground">
        {t('entities.ui.backlinks.title')}
        {state.status === 'ready' && total > 0 && (
          <span className="text-sm font-normal text-text-muted">{t('entities.ui.backlinks.count', { count: total })}</span>
        )}
      </h3>
      {state.status === 'loading' && state.links.length === 0 && (
        <p className="text-sm text-text-muted" aria-busy="true">{t('entities.ui.backlinks.loading')}</p>
      )}
      {state.status === 'error' && (
        <button type="button" onClick={onRetry} className={cn('self-start text-sm text-status-danger underline-offset-2 hover:underline', FOCUS_RING)}>
          {t('entities.ui.backlinks.error')}
        </button>
      )}
      {state.status === 'ready' && total === 0 && (
        <p className="text-sm text-text-muted">{t('entities.ui.backlinks.empty')}</p>
      )}
      {groups.map(({ group, sources }) => {
        const open = expanded[group] ?? false
        const visible = open ? sources : sources.slice(0, BACKLINKS_GROUP_PREVIEW)
        return (
          <div key={group} className="flex flex-col gap-1" data-backlink-group={group}>
            <h4 className="text-xs font-medium uppercase caps-label text-text-muted">
              {t(`entities.ui.backlinks.group.${group}`)} · {sources.length}
            </h4>
            <ul className="flex flex-col gap-1">
              {visible.map((source) => (
                isCanvasEmbedBacklink(source.link) ? (
                  <CanvasOnBoardRow
                    key={source.key}
                    source={source}
                    preview={previews?.[source.key]}
                    previewsEnabled={previewsEnabled}
                    workspaceId={workspaceId}
                    listTitle={boardTitles.get(source.link.from.id)}
                  />
                ) : (
                  <li key={source.key} className="flex min-w-0 items-center gap-2 text-sm">
                    <EntityChip
                      entityRef={source.link.from}
                      preview={previews?.[source.key]}
                      previewsEnabled={previewsEnabled}
                      workspaceId={workspaceId ?? undefined}
                    />
                    <span className="truncate text-text-muted">
                      {source.relations.map((relation) => t(`entities.ui.backlinks.relation.${relation}`)).join(', ')}
                    </span>
                  </li>
                )
              ))}
            </ul>
            {sources.length > visible.length && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [group]: true }))}
                className={cn('self-start text-sm text-accent hover:underline', MOTION_FAST, FOCUS_RING)}
              >
                {t('entities.ui.backlinks.showAll')}
              </button>
            )}
          </div>
        )
      })}
      {state.status === 'ready' && state.nextCursor && (
        <button type="button" onClick={onLoadMore} className={cn('self-start text-sm text-accent hover:underline', FOCUS_RING)}>
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
  return (
    <BacklinksList
      state={state}
      onRetry={retry}
      onLoadMore={loadMore}
      workspaceId={workspaceId}
      className={className}
    />
  )
}

export type { EntityLink }
