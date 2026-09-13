import * as React from 'react'
import { Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  buildYearHeatmap,
  DEFAULT_COLLECTION_DISPLAY,
  dueBucket,
  type CollectionDisplay,
  type CollectionGroupBy,
  type CollectionProperty,
  type CollectionSessionMeta,
  type CollectionViewMode,
} from '@craft-agent/shared/sessions/collection'
import { cn } from '@/lib/utils'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import { ActionRegistryProvider } from '@/actions/registry'
import { CollectionDisplayPopover } from '@/components/app-shell/collection/CollectionDisplayPopover'
import { CollectionGroupByMenu } from '@/components/app-shell/collection/CollectionGroupByMenu'
import { CollectionViewCycleButton } from '@/components/app-shell/collection/CollectionViewCycleButton'
import { SessionTableGroupHeader } from '@/components/app-shell/session-table/SessionTableGroupHeader'
import { SessionTablePropertyHeader, SessionTableRow } from '@/components/app-shell/session-table/SessionTableRow'
import type { ComponentEntry } from './types'

const STATUSES: SessionStatus[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'closed',
  },
]

function sampleMeta(partial: Partial<SessionMeta> & Pick<SessionMeta, 'id' | 'name'>): SessionMeta {
  return {
    workspaceId: 'playground-workspace',
    lastMessageAt: Date.now() - 60_000,
    createdAt: Date.now() - 86_400_000,
    sessionStatus: 'todo',
    ...partial,
  }
}

const SAMPLE_ROWS: SessionMeta[] = [
  sampleMeta({
    id: 'row-1',
    name: 'Fix authentication in the login flow',
    sessionStatus: 'in-progress',
    priority: 'high',
    projectId: 'ops',
    labels: ['feature'],
    isFlagged: true,
    model: 'rox/standard',
  }),
  sampleMeta({
    id: 'row-2',
    name: 'Review heatmap empty-day copy',
    sessionStatus: 'todo',
    priority: 'medium',
    projectId: 'ops',
    dueDate: Date.now() + 86_400_000,
  }),
  sampleMeta({
    id: 'row-3',
    name: 'Ship notes formula columns',
    sessionStatus: 'done',
    priority: 'low',
    projectId: 'notes',
    isFlagged: false,
  }),
]

function playgroundGroupBucket(
  row: SessionMeta,
  groupBy: CollectionGroupBy,
  t: (key: string) => string,
  projectNameById: Map<string, string>,
  labelById: Map<string, string>,
): { key: string; label: string } {
  switch (groupBy) {
    case 'status': {
      const id = row.sessionStatus ?? 'todo'
      return { key: `status:${id}`, label: STATUSES.find((status) => status.id === id)?.label ?? id }
    }
    case 'priority': {
      const priority = row.priority ?? 'none'
      return { key: `priority:${priority}`, label: t(`priority.${priority}`) }
    }
    case 'project': {
      const projectId = row.projectId ?? ''
      return {
        key: `project:${projectId}`,
        label: projectId ? (projectNameById.get(projectId) ?? projectId) : t('collection.bulk.noProject'),
      }
    }
    case 'dueDate': {
      const bucket = dueBucket(row.dueDate ?? null, Date.now())
      return { key: `due:${bucket}`, label: t(`collection.display.dueBucket.${bucket}`) }
    }
    case 'label': {
      const first = [...(row.labels ?? [])].sort()[0]
      if (!first) return { key: 'label:none', label: t('collection.display.labelNone') }
      return { key: `label:${first}`, label: labelById.get(first) ?? first }
    }
    case 'none':
    default:
      return { key: '__all__', label: t('collection.display.groupBy.none') }
  }
}

function heatmapLevelClass(level: number): string {
  switch (level) {
    case 1: return 'bg-emerald-900/55'
    case 2: return 'bg-emerald-700/65'
    case 3: return 'bg-emerald-500/75'
    case 4: return 'bg-emerald-400'
    default: return 'bg-foreground/10'
  }
}

function CollectionChromePlayground() {
  const { t } = useTranslation()
  const [display, setDisplay] = React.useState<CollectionDisplay>(DEFAULT_COLLECTION_DISPLAY)
  const [viewMode, setViewMode] = React.useState<CollectionViewMode>('table')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [rows, setRows] = React.useState(SAMPLE_ROWS)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const projectNameById = React.useMemo(() => new Map([['ops', 'Ops'], ['notes', 'Notes']]), [])
  const labelById = React.useMemo(() => new Map([['feature', 'feature']]), [])
  const grouped = React.useMemo(() => {
    const buckets = new Map<string, { label: string; items: SessionMeta[] }>()
    for (const row of rows) {
      const bucket = playgroundGroupBucket(row, display.groupBy, t, projectNameById, labelById)
      const existing = buckets.get(bucket.key)
      if (existing) existing.items.push(row)
      else buckets.set(bucket.key, { label: bucket.label, items: [row] })
    }
    return [...buckets.entries()].map(([key, value]) => ({ key, ...value }))
  }, [display.groupBy, labelById, projectNameById, rows, t])
  const showCol = (id: CollectionProperty) => display.visibleProperties.includes(id)

  return (
    <ActionRegistryProvider>
    <div className="flex h-full min-h-[420px] flex-col bg-background" data-testid="playground-collection-chrome">
      <div className="flex items-center gap-1 border-b border-border/40 px-3 py-2">
        <CollectionViewCycleButton value={viewMode} onChange={setViewMode} />
        <CollectionGroupByMenu display={display} onDisplayChange={setDisplay} />
        <CollectionDisplayPopover display={display} onDisplayChange={setDisplay} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">
          <span className="w-6 shrink-0" />
          <span className="min-w-0 flex-1">{t('collection.table.column.title')}</span>
          <SessionTablePropertyHeader
            showStatus={showCol('status')}
            showLabels={showCol('labels')}
            showPriority={showCol('priority')}
            showDue={showCol('dueDate')}
            showModel={showCol('model')}
            showProject={showCol('project')}
          />
          {showCol('updated') && <span className="w-20 shrink-0">{t('collection.table.column.updated')}</span>}
          {showCol('flag') && <span className="w-8 shrink-0" />}
        </div>
        <ul>
          {grouped.map((group) => (
            <React.Fragment key={group.key}>
              {display.groupBy === 'none' ? null : (
                <SessionTableGroupHeader
                  bucket={{
                    key: group.key,
                    label: group.label,
                    count: group.items.length,
                  }}
                  collapsed={Boolean(collapsed[group.key])}
                  onToggle={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                  onSelectGroup={() => setSelected(new Set(group.items.map((item) => item.id)))}
                  onCollapseAll={() => {
                    const next: Record<string, boolean> = {}
                    for (const bucket of grouped) next[bucket.key] = true
                    setCollapsed(next)
                  }}
                  onExpandAll={() => setCollapsed({})}
                />
              )}
              {collapsed[group.key] ? null : group.items.map((meta) => (
                <SessionTableRow
                  key={meta.id}
                  meta={meta}
                  statuses={STATUSES}
                  projectNameById={projectNameById}
                  labelById={labelById}
                  projects={[...projectNameById.entries()].map(([id, name]) => ({ id, name }))}
                  labels={[...labelById.entries()].map(([id, name]) => ({ id, name }))}
                  selected={selected.has(meta.id)}
                  onSelect={(checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (checked) next.add(meta.id)
                      else next.delete(meta.id)
                      return next
                    })
                  }}
                  onOpen={() => undefined}
                  onUpdate={(partial) => {
                    setRows((prev) => prev.map((row) => (row.id === meta.id ? { ...row, ...partial } : row)))
                  }}
                  showGrip={false}
                  showStatus={showCol('status')}
                  showPriority={showCol('priority')}
                  showProject={showCol('project')}
                  showLabels={showCol('labels')}
                  showDue={showCol('dueDate')}
                  showModel={showCol('model')}
                  showUpdated={showCol('updated')}
                  showCreated={showCol('created')}
                  showFlag={showCol('flag')}
                  density={display.density}
                />
              ))}
            </React.Fragment>
          ))}
        </ul>
      </div>
    </div>
    </ActionRegistryProvider>
  )
}

function CollectionHeatmapPlayground({ emptyDay = false }: { emptyDay?: boolean }) {
  const { t } = useTranslation()
  const now = Date.now()
  const sessions: CollectionSessionMeta[] = emptyDay
    ? []
    : [
        { id: 'h1', name: 'Morning review', lastMessageAt: now, createdAt: now - 3_600_000, messageCount: 4 },
        { id: 'h2', name: 'Heatmap polish', lastMessageAt: now - 86_400_000, createdAt: now - 172_800_000, messageCount: 12 },
        { id: 'h3', name: 'Notes graph', lastMessageAt: now - 2 * 86_400_000, createdAt: now - 3 * 86_400_000, messageCount: 2 },
      ]
  const heatmap = React.useMemo(
    () => buildYearHeatmap(sessions, new Date().getFullYear(), now),
    [now, sessions],
  )
  const [focusedKey, setFocusedKey] = React.useState(heatmap.todayKey)
  const dayCount = sessions.filter((session) => {
    const ts = session.lastMessageAt ?? session.createdAt
    if (ts == null) return false
    const d = new Date(ts)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return key === focusedKey
  }).length

  return (
    <div className="space-y-4 p-4" data-testid="playground-collection-heatmap">
      <div className="flex gap-px overflow-x-auto">
        {heatmap.weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-px">
            {week.map((cell, row) => {
              if (!cell.inYear || !cell.key) {
                return <span key={`${weekIndex}-${row}`} className="h-3 w-3 rounded-[3px]" />
              }
              return (
                <button
                  key={cell.key}
                  type="button"
                  aria-label={t('collection.heatmap.cell', { date: cell.key, count: cell.count })}
                  className={cn(
                    'h-3 w-3 rounded-[3px]',
                    heatmapLevelClass(cell.level),
                    cell.key === focusedKey && 'ring-1 ring-foreground',
                  )}
                  onClick={() => setFocusedKey(cell.key!)}
                />
              )
            })}
          </div>
        ))}
      </div>
      {dayCount === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="playground-heatmap-empty">
          {t('collection.heatmap.emptyDay')}
        </p>
      ) : (
        <p className="text-sm">{t('collection.heatmap.sessionCount', { count: dayCount })}</p>
      )}
    </div>
  )
}

export const collectionComponents: ComponentEntry[] = [
  {
    id: 'collection-chrome',
    name: 'Collection chrome · table',
    category: 'Collection',
    level: 'Screens',
    description: 'Group, Display, view cycle, collapse-all, one-row flags, hover vs title',
    component: CollectionChromePlayground,
    props: [],
    layout: 'full',
    viewport: { id: 'desktop', name: 'Desktop', width: 1280, height: 800 },
  },
  {
    id: 'collection-chrome-narrow',
    name: 'Collection chrome · narrow',
    category: 'Collection',
    level: 'Screens',
    description: 'Same table chrome at a compact viewport',
    component: CollectionChromePlayground,
    props: [],
    layout: 'full',
    viewport: { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
  },
  {
    id: 'collection-heatmap',
    name: 'Collection heatmap',
    category: 'Collection',
    level: 'Patterns',
    description: 'Year heatmap with a populated day',
    component: CollectionHeatmapPlayground,
    props: [],
    layout: 'top',
  },
  {
    id: 'collection-heatmap-empty',
    name: 'Collection heatmap · empty day',
    category: 'Collection',
    level: 'Patterns',
    description: 'Empty-day copy for the heatmap day list',
    component: CollectionHeatmapPlayground,
    props: [
      { name: 'emptyDay', control: { type: 'boolean' }, defaultValue: true },
    ],
    layout: 'top',
  },
]
