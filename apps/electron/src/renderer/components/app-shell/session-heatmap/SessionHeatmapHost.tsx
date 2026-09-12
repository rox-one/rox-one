import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_COLLECTION_FILTERS,
  buildYearHeatmap,
  classifyAgentFamily,
  compareDaySessions,
  countChildSessionsByParent,
  heatmapEndKey,
  heatmapHomeKey,
  heatmapNavigate,
  querySessionMetas,
  sessionsOnDay,
  sessionDurationMs,
  sessionTokenTotal,
  formatTranscriptSize,
  type CollectionFilters,
  type CollectionSessionMeta,
  type HeatmapDayOrderBy,
  type HeatmapNavDir,
  type SessionPriority,
} from '@craft-agent/shared/sessions/collection'
import { useNavigation } from '@/contexts/NavigationContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { sessionSelection } from '@/hooks/useEntitySelection'
import {
  collectionDisplayAtom,
  loadCollectionDisplayAtom,
  replaceCollectionDisplayAtom,
  setCollectionDisplayAtom,
} from '@/atoms/collection-display'
import {
  collectionFiltersAtom,
  loadCollectionFiltersAtom,
  replaceCollectionFiltersMapAtom,
} from '@/atoms/collection-filters'
import { CollectionViewCycleButton } from '../collection/CollectionViewCycleButton'
import { collectionViewRoute } from '../collection/collection-view-cycle'
import { CollectionOpsBar } from '../collection/CollectionOpsBar'
import { CollectionBulkBar } from '../collection/CollectionBulkBar'
import { skipRailChipClearOnce, userSliceNavigation } from '../collection/collection-rail-filters'
import type { SessionStatus } from '@/config/session-status-config'
import { cn } from '@/lib/utils'

const PRIORITIES: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
const DAY_COLUMNS: Array<{ id: HeatmapDayOrderBy; labelKey: string }> = [
  { id: 'name', labelKey: 'collection.table.column.title' },
  { id: 'messages', labelKey: 'collection.table.column.messages' },
  { id: 'tokens', labelKey: 'collection.table.column.tokens' },
  { id: 'duration', labelKey: 'collection.table.column.duration' },
  { id: 'size', labelKey: 'collection.table.column.size' },
  { id: 'toolCalls', labelKey: 'collection.table.column.toolCalls' },
  { id: 'commits', labelKey: 'collection.table.column.commits' },
  { id: 'parallelAgents', labelKey: 'collection.table.column.parallelAgents' },
  { id: 'createdAt', labelKey: 'collection.table.column.created' },
  { id: 'lastMessageAt', labelKey: 'collection.table.column.updated' },
]

function toCollectionMeta(meta: SessionMeta): CollectionSessionMeta {
  return {
    id: meta.id,
    name: meta.name,
    sessionStatus: meta.sessionStatus,
    priority: meta.priority,
    dueDate: meta.dueDate,
    projectId: meta.projectId,
    labels: meta.labels,
    isFlagged: meta.isFlagged,
    hasUnread: meta.hasUnread,
    model: meta.model,
    llmConnection: meta.llmConnection,
    rank: meta.rank,
    lastMessageAt: meta.lastMessageAt,
    createdAt: meta.createdAt,
    messageCount: meta.messageCount,
    tokenUsage: meta.tokenUsage,
    transcriptBytes: meta.transcriptBytes,
    toolCallCount: meta.toolCallCount,
    commitCount: meta.commitCount,
    parentSessionId: meta.parentSessionId,
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatRelative(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function formatDate(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dayMetricValue(session: CollectionSessionMeta, id: HeatmapDayOrderBy): string {
  switch (id) {
    case 'name':
      return session.name || session.id.slice(0, 8)
    case 'messages':
      return session.messageCount != null ? String(session.messageCount) : '—'
    case 'tokens': {
      const total = sessionTokenTotal(session)
      return total == null ? '—' : String(total)
    }
    case 'duration':
      return formatDuration(sessionDurationMs(session))
    case 'size':
      return formatTranscriptSize(session.transcriptBytes)
    case 'toolCalls':
      return session.toolCallCount != null ? String(session.toolCallCount) : '—'
    case 'commits':
      return session.commitCount != null ? String(session.commitCount) : '—'
    case 'parallelAgents':
      return String(session.parallelAgentCount ?? 0)
    case 'createdAt':
      return formatDate(session.createdAt)
    case 'lastMessageAt':
      return formatRelative(session.lastMessageAt)
    default: {
      const _never: never = id
      void _never
      return '—'
    }
  }
}

function levelClass(level: number): string {
  switch (level) {
    case 1:
      return 'bg-emerald-900/55'
    case 2:
      return 'bg-emerald-700/65'
    case 3:
      return 'bg-emerald-500/75'
    case 4:
      return 'bg-emerald-400'
    default:
      return 'bg-foreground/8'
  }
}

export function SessionHeatmapHost() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { activeWorkspaceId, sessionStatuses = [], projects = [], labels: labelConfigs } =
    useAppShellContext()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const display = useAtomValue(collectionDisplayAtom)
  const setDisplay = useSetAtom(setCollectionDisplayAtom)
  const replaceDisplay = useSetAtom(replaceCollectionDisplayAtom)
  const loadDisplay = useSetAtom(loadCollectionDisplayAtom)
  const filters = useAtomValue(collectionFiltersAtom)
  const setFilters = useSetAtom(collectionFiltersAtom)
  const loadFilters = useSetAtom(loadCollectionFiltersAtom)
  const replaceFiltersMap = useSetAtom(replaceCollectionFiltersMapAtom)

  const now = Date.now()
  const today = new Date(now)
  const [year, setYear] = React.useState(today.getFullYear())
  const [focusedKey, setFocusedKey] = React.useState(() => {
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    return key
  })
  const [orderBy, setOrderBy] = React.useState<HeatmapDayOrderBy>('lastMessageAt')
  const [orderDir, setOrderDir] = React.useState<'asc' | 'desc'>('desc')
  const gridRef = React.useRef<HTMLDivElement>(null)
  const { toggle, selectRange, isSelected } = sessionSelection.useSelection()

  React.useEffect(() => {
    void loadDisplay(activeWorkspaceId)
  }, [activeWorkspaceId, loadDisplay])

  React.useEffect(() => {
    void loadFilters(activeWorkspaceId)
  }, [activeWorkspaceId, loadFilters])

  React.useEffect(() => {
    if (!activeWorkspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionDisplayChanged) return
    return api.onCollectionDisplayChanged((workspaceId, next) => {
      if (workspaceId !== activeWorkspaceId) return
      replaceDisplay(next)
    })
  }, [activeWorkspaceId, replaceDisplay])

  React.useEffect(() => {
    if (!activeWorkspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionFiltersChanged) return
    return api.onCollectionFiltersChanged((workspaceId, next) => {
      if (workspaceId !== activeWorkspaceId) return
      replaceFiltersMap(next)
    })
  }, [activeWorkspaceId, replaceFiltersMap])

  const handleDisplayChange = React.useCallback(
    (next: typeof display) => {
      void setDisplay({ display: next, workspaceId: activeWorkspaceId })
    },
    [setDisplay, activeWorkspaceId],
  )

  const filtered = React.useMemo(() => {
    const metas = [...metaMap.values()].map(toCollectionMeta)
    const childCounts = countChildSessionsByParent(metas)
    const withChildren = metas.map((meta) => ({
      ...meta,
      parallelAgentCount: childCounts.get(meta.id) ?? 0,
    }))
    return querySessionMetas(withChildren, filters, display, now)
  }, [metaMap, filters, display, now])

  const heatmap = React.useMemo(
    () => buildYearHeatmap(filtered, year, now),
    [filtered, year, now],
  )

  React.useEffect(() => {
    if (focusedKey.startsWith(`${year}-`)) return
    setFocusedKey(heatmapHomeKey(year, heatmap.todayKey))
  }, [year, focusedKey, heatmap.todayKey])

  const daySessions = React.useMemo(() => {
    return [...sessionsOnDay(filtered, focusedKey)].sort((a, b) =>
      compareDaySessions(a, b, orderBy, orderDir),
    )
  }, [filtered, focusedKey, orderBy, orderDir])
  const visibleIds = React.useMemo(() => daySessions.map((session) => session.id), [daySessions])

  const projectOptions = React.useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  )
  const labelOptions = React.useMemo(
    () => (labelConfigs ?? []).map((l) => ({ id: l.id, name: l.name })),
    [labelConfigs],
  )

  const moveFocus = React.useCallback((dir: HeatmapNavDir) => {
    setFocusedKey((current) => heatmapNavigate(current, dir, year))
  }, [year])

  const toggleSort = (next: HeatmapDayOrderBy) => {
    if (orderBy === next) {
      setOrderDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setOrderBy(next)
    setOrderDir(next === 'name' ? 'asc' : 'desc')
  }

  const focusedDateLabel = React.useMemo(() => {
    const [y, m, d] = focusedKey.split('-').map(Number)
    if (!y || !m || !d) return focusedKey
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }, [focusedKey])

  return (
    <div className="flex h-full flex-col bg-background">
      <CollectionOpsBar
        display={display}
        filters={filters}
        onDisplayChange={handleDisplayChange}
        onFiltersChange={(next: CollectionFilters) => setFilters(next)}
        statuses={sessionStatuses as unknown as SessionStatus[]}
        priorities={PRIORITIES}
        projects={projectOptions}
        labels={labelOptions}
        workspaceId={activeWorkspaceId}
        onApplyUserSlice={(viewId, sliceFilters) => {
          const nav = userSliceNavigation({ id: viewId, filters: sliceFilters })
          skipRailChipClearOnce.current = nav.skipChipClear
          void setFilters({ ...nav.filters })
          navigate(nav.route)
        }}
        trailing={
          <CollectionViewCycleButton
            value="heatmap"
            onChange={(view) => {
              navigate(collectionViewRoute(view))
            }}
          />
        }
        className="border-b border-border/50"
      />

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label={t('collection.heatmap.prevYear')}
            onClick={() => setYear((value) => value - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <h2 className="min-w-16 text-center text-sm font-semibold tabular-nums">
            {t('collection.heatmap.year', { year })}
          </h2>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label={t('collection.heatmap.nextYear')}
            onClick={() => setYear((value) => value + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          <div className="flex flex-col justify-end gap-[3px] pt-5">
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                className="h-3 text-[9px] leading-3 text-muted-foreground"
                aria-hidden={day % 2 === 1}
              >
                {day % 2 === 0 ? t(`collection.heatmap.weekday.${day}`) : ''}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            role="grid"
            aria-label={t('collection.view.heatmap')}
            tabIndex={0}
            className="outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Home') {
                event.preventDefault()
                setFocusedKey(heatmapHomeKey(year, heatmap.todayKey))
                return
              }
              if (event.key === 'End') {
                event.preventDefault()
                setFocusedKey(heatmapEndKey(year))
                return
              }
              const dir: HeatmapNavDir | null =
                event.key === 'ArrowLeft'
                  ? 'left'
                  : event.key === 'ArrowRight'
                    ? 'right'
                    : event.key === 'ArrowUp'
                      ? 'up'
                      : event.key === 'ArrowDown'
                        ? 'down'
                        : null
              if (!dir) return
              event.preventDefault()
              moveFocus(dir)
            }}
          >
            <div className="mb-1 flex">
              {heatmap.weeks.map((_, weekIndex) => {
                const label = heatmap.monthLabels.find((item) => item.weekIndex === weekIndex)
                return (
                  <span
                    key={weekIndex}
                    className="w-[15px] shrink-0 text-[9px] text-muted-foreground"
                  >
                    {label ? t(`collection.heatmap.month.${String(label.month).padStart(2, '0')}`) : ''}
                  </span>
                )
              })}
            </div>
            <div className="flex gap-px">
              {heatmap.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-px">
                  {week.map((cell, row) => {
                    if (!cell.inYear || !cell.key) {
                      return <span key={`${weekIndex}-${row}`} className="h-3 w-3 rounded-[3px]" />
                    }
                    const focused = cell.key === focusedKey
                    const isToday = cell.key === heatmap.todayKey
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        role="gridcell"
                        aria-selected={focused}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={t('collection.heatmap.cell', {
                          date: cell.key,
                          count: cell.count,
                        })}
                        title={t('collection.heatmap.cell', { date: cell.key, count: cell.count })}
                        className={cn(
                          'h-3 w-3 rounded-[3px] outline-none',
                          levelClass(cell.level),
                          focused && 'ring-1 ring-foreground ring-offset-1 ring-offset-background',
                          isToday && !focused && 'ring-1 ring-foreground/40',
                        )}
                        onClick={() => {
                          setFocusedKey(cell.key!)
                          gridRef.current?.focus()
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="mt-4" aria-label={focusedDateLabel}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{focusedDateLabel}</h3>
            <span className="text-xs text-muted-foreground">
              {t('collection.heatmap.sessionCount', { count: daySessions.length })}
            </span>
          </div>

          {daySessions.length === 0 ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
              <p className="text-sm">{t('collection.heatmap.emptyDay')}</p>
              {Object.keys(filters).length > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.03]"
                  onClick={() => setFilters({ ...DEFAULT_COLLECTION_FILTERS })}
                >
                  {t('collection.table.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex items-center gap-2 border-b border-border/40 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                <span className="w-6 shrink-0" />
                {DAY_COLUMNS.map((column) => (
                  <button
                    key={column.id}
                    type="button"
                    className={cn(
                      'text-left hover:text-foreground',
                      column.id === 'name' ? 'min-w-0 flex-1' : 'w-24 shrink-0',
                      orderBy === column.id && 'text-foreground',
                    )}
                    onClick={() => toggleSort(column.id)}
                  >
                    {t(column.labelKey)}
                    {orderBy === column.id ? (orderDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
                <span className="w-24 shrink-0">{t('collection.filter.agentFamily')}</span>
              </div>
              <ul>
                {daySessions.map((session, index) => (
                  <li
                    key={session.id}
                    className="flex items-center gap-2 border-b border-border/30 px-2 py-1.5 text-sm hover:bg-foreground/[0.02]"
                  >
                    <span className="w-6 shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected(session.id)}
                        onChange={(event) => {
                          if ((event.nativeEvent as MouseEvent).shiftKey) selectRange(index, visibleIds)
                          else toggle(session.id, index)
                        }}
                        aria-label={t('collection.table.select', {
                          title: session.name || session.id.slice(0, 8),
                        })}
                      />
                    </span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => navigate(routes.view.allSessions(session.id))}
                    >
                      {session.name || session.id.slice(0, 8)}
                    </button>
                    {DAY_COLUMNS.filter((column) => column.id !== 'name').map((column) => (
                      <span
                        key={column.id}
                        className="w-24 shrink-0 truncate text-xs tabular-nums text-muted-foreground"
                      >
                        {dayMetricValue(session, column.id)}
                      </span>
                    ))}
                    <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                      {t(`collection.filter.agentFamily.${classifyAgentFamily(session)}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <CollectionBulkBar
        workspaceId={activeWorkspaceId}
        visibleSessionIds={visibleIds}
        statuses={sessionStatuses as unknown as SessionStatus[]}
        projects={projectOptions}
        labels={labelOptions}
      />
    </div>
  )
}
