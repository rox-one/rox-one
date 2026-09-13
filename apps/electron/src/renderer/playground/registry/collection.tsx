import * as React from 'react'
import { Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  buildYearHeatmap,
  DEFAULT_COLLECTION_DISPLAY,
  type CollectionDisplay,
  type CollectionSessionMeta,
  type CollectionViewMode,
} from '@craft-agent/shared/sessions/collection'
import { cn } from '@/lib/utils'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatusConfig } from '@/config/session-status-config'
import { CollectionDisplayPopover } from '@/components/app-shell/collection/CollectionDisplayPopover'
import { CollectionGroupByMenu } from '@/components/app-shell/collection/CollectionGroupByMenu'
import { CollectionViewCycleButton } from '@/components/app-shell/collection/CollectionViewCycleButton'
import { SessionTableGroupHeader } from '@/components/app-shell/session-table/SessionTableGroupHeader'
import { SessionTableRow } from '@/components/app-shell/session-table/SessionTableRow'
import type { ComponentEntry } from './types'

const STATUSES: SessionStatusConfig[] = [
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
  const [display, setDisplay] = React.useState<CollectionDisplay>(DEFAULT_COLLECTION_DISPLAY)
  const [viewMode, setViewMode] = React.useState<CollectionViewMode>('table')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [rows, setRows] = React.useState(SAMPLE_ROWS)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const projectNameById = React.useMemo(() => new Map([['ops', 'Ops'], ['notes', 'Notes']]), [])
  const labelById = React.useMemo(() => new Map([['feature', 'feature']]), [])
  const grouped = React.useMemo(() => {
    const buckets = new Map<string, SessionMeta[]>()
    for (const row of rows) {
      const key = display.groupBy === 'status' ? (row.sessionStatus ?? 'todo') : 'all'
      const list = buckets.get(key) ?? []
      list.push(row)
      buckets.set(key, list)
    }
    return [...buckets.entries()]
  }, [display.groupBy, rows])

  return (
    <div className="flex h-full min-h-[420px] flex-col bg-background" data-testid="playground-collection-chrome">
      <div className="flex items-center gap-1 border-b border-border/40 px-3 py-2">
        <CollectionViewCycleButton value={viewMode} onChange={setViewMode} />
        <CollectionGroupByMenu display={display} onDisplayChange={setDisplay} />
        <CollectionDisplayPopover display={display} onDisplayChange={setDisplay} />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {grouped.map(([key, items]) => (
          <React.Fragment key={key}>
            <SessionTableGroupHeader
              bucket={{
                key,
                label: key === 'all' ? 'All' : key,
                count: items.length,
              }}
              collapsed={Boolean(collapsed[key])}
              onToggle={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
              onSelectGroup={() => setSelected(new Set(items.map((item) => item.id)))}
              onCollapseAll={() => {
                const next: Record<string, boolean> = {}
                for (const [bucketKey] of grouped) next[bucketKey] = true
                setCollapsed(next)
              }}
              onExpandAll={() => setCollapsed({})}
            />
            {collapsed[key] ? null : items.map((meta) => (
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
                showStatus={display.visibleProperties.includes('status')}
                showPriority={display.visibleProperties.includes('priority')}
                showProject={display.visibleProperties.includes('project')}
                showLabels={display.visibleProperties.includes('labels')}
                showDue={display.visibleProperties.includes('dueDate')}
                showModel={display.visibleProperties.includes('model')}
                showUpdated={display.visibleProperties.includes('updated')}
                showCreated={display.visibleProperties.includes('created')}
                showFlag={display.visibleProperties.includes('flag')}
                density={display.density}
              />
            ))}
          </React.Fragment>
        ))}
      </ul>
    </div>
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
