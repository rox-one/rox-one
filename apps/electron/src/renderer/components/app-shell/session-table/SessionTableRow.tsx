import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Flag as FlagIcon, GripVertical } from 'lucide-react'
import { PremiumMenu, type PremiumMenuItem } from '@craft-agent/ui'
import type { SessionPriority } from '@craft-agent/shared/sessions/collection'
import { ModelChip } from '../kanban/ModelChip'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatusConfig } from '@/config/session-status-config'
import { getSessionTitle } from '@/utils/session'
import { cn } from '@/lib/utils'
import { isDueOverdue } from './table-due'
import { collectionTableRowClass } from './table-density'
import type { CollectionDensity } from '@craft-agent/shared/sessions/collection'
import { formatTranscriptSize } from '@craft-agent/shared/sessions/collection'

export interface SessionTableRowProps {
  meta: SessionMeta
  statuses?: SessionStatusConfig[]
  projectNameById: Map<string, string>
  labelById: Map<string, string>
  selected: boolean
  onSelect: (checked: boolean, shiftKey: boolean) => void
  onOpen: (sessionId: string) => void
  onUpdate: (partial: Partial<SessionMeta>) => void
  showGrip: boolean
  showStatus: boolean
  showPriority: boolean
  showProject: boolean
  showLabels: boolean
  showDue: boolean
  showModel: boolean
  showUpdated: boolean
  showCreated: boolean
  showFlag: boolean
  showMessages?: boolean
  showTokens?: boolean
  showDuration?: boolean
  showSize?: boolean
  showToolCalls?: boolean
  showCommits?: boolean
  showParallelAgents?: boolean
  parallelAgentCount?: number
  /** B5: HTML5 drag reorder callbacks (table host wires when showGrip). */
  onDragStartRow?: (sessionId: string) => void
  onDragOverRow?: (sessionId: string, event: React.DragEvent) => void
  dropIndicator?: 'before' | 'after' | null
  style?: React.CSSProperties
  density?: CollectionDensity
}

const PRIORITY_ORDER: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

function SessionRowCompactMenu({
  label,
  value,
  items,
  onPick,
}: {
  label: string
  value: string
  items: PremiumMenuItem[]
  onPick: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const selectedLabel = items.find((item) => item.id === value)?.label ?? value

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selectedLabel}`}
        title={selectedLabel}
        className="w-full truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-left text-xs hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((next) => !next)}
      >
        {selectedLabel}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        items={items}
        selectedId={value}
        onSelect={(item) => onPick(item.id)}
        variant="compact"
      />
    </>
  )
}

function formatRelative(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function formatDate(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleDateString()
}


function formatDue(
  dueDate: number | null | undefined,
  sessionStatus: string | null | undefined,
): { text: string; overdue: boolean } {
  if (dueDate == null || !Number.isFinite(dueDate)) return { text: '—', overdue: false }
  const d = new Date(dueDate)
  return {
    text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: isDueOverdue(dueDate, sessionStatus),
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function sessionDuration(meta: SessionMeta): number | null {
  if (meta.createdAt == null || meta.lastMessageAt == null) return null
  const duration = meta.lastMessageAt - meta.createdAt
  return duration >= 0 ? duration : null
}

export function SessionTableRow({
  meta,
  statuses = [],
  projectNameById,
  labelById,
  selected,
  onSelect,
  onOpen,
  onUpdate,
  showGrip,
  showStatus,
  showPriority,
  showProject,
  showLabels,
  showDue,
  showModel,
  showUpdated,
  showCreated,
  showFlag,
  showMessages = false,
  showTokens = false,
  showDuration = false,
  showSize = false,
  showToolCalls = false,
  showCommits = false,
  showParallelAgents = false,
  parallelAgentCount = 0,
  onDragStartRow,
  onDragOverRow,
  dropIndicator,
  style,
  density = 'compact',
}: SessionTableRowProps) {
  const { t } = useTranslation()
  const title = getSessionTitle(meta as never) || meta.id.slice(0, 8)
  const due = formatDue(meta.dueDate, meta.sessionStatus)
  const priority = meta.priority ?? 'none'
  const sessionStatus: string = meta.sessionStatus ?? 'todo'

  const projectName = meta.projectId ? (projectNameById.get(meta.projectId) ?? meta.projectId) : ''
  const labelNames = (meta.labels ?? []).map((id) => labelById.get(id) ?? id).join(', ')

  const onPickDue = (v: string | null) => {
    if (v === null) {
      onUpdate({ dueDate: null })
      return
    }
    // Store UTC noon of picked local calendar day (PRD FR-16).
    const [y, m, d] = v.split('-').map(Number)
    const noon = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0)
    onUpdate({ dueDate: noon })
  }

  const dueInputValue = React.useMemo(() => {
    if (meta.dueDate == null || !Number.isFinite(meta.dueDate)) return ''
    const d = new Date(meta.dueDate)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }, [meta.dueDate])

  return (
    <li
      className={cn(
        'group flex items-center gap-2 border-b border-border/30 px-3 text-sm hover:bg-foreground/[0.02] focus-within:bg-foreground/[0.03]',
        collectionTableRowClass(density),
        selected && 'bg-foreground/[0.05]',
        dropIndicator === 'before' && 'border-t-2 border-t-foreground/40',
        dropIndicator === 'after' && 'border-b-2 border-b-foreground/40',
      )}
      style={style}
      aria-selected={selected}
      draggable={showGrip}
      onDragStart={() => onDragStartRow?.(meta.id)}
      onDragOver={(e) => {
        if (!onDragOverRow) return
        e.preventDefault()
        onDragOverRow(meta.id, e)
      }}
    >
      <span className="w-6 shrink-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}
          aria-label={t('collection.table.select', { title })}
          data-selected={selected}
        />
      </span>
      {showGrip && (
        <span className="w-4 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}

      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 rounded-[3px]"
        onClick={() => onOpen(meta.id)}
        title={title}
      >
        {title}
      </button>

      {showStatus && (
        <span className="w-28 shrink-0">
          <SessionRowCompactMenu
            label={t('collection.table.column.status')}
            value={sessionStatus}
            items={(statuses.length > 0 ? statuses : [{ id: sessionStatus, label: sessionStatus }]).map((s) => ({
              id: s.id,
              label: s.label ?? s.id,
            }))}
            onPick={(id) => onUpdate({ sessionStatus: id })}
          />
        </span>
      )}

      {showPriority && (
        <span className="w-20 shrink-0">
          <SessionRowCompactMenu
            label={t('collection.table.column.priority')}
            value={priority}
            items={PRIORITY_ORDER.map((p) => ({
              id: p,
              label: t(`priority.${p}`),
            }))}
            onPick={(id) => onUpdate({ priority: id as SessionPriority })}
          />
        </span>
      )}

      {showProject && (
        <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{projectName || '—'}</span>
      )}

      {showLabels && (
        <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{labelNames || '—'}</span>
      )}

      {showDue && (
        <span className={cn('w-24 shrink-0', due.overdue && 'text-red-500 font-medium')}>
          <input
            type="date"
            className="w-full rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px]"
            value={dueInputValue}
            onChange={(e) => {
              if (!e.target.value) onPickDue(null)
              else onPickDue(e.target.value)
            }}
          />
        </span>
      )}

      {showModel && (
        <span className="w-24 shrink-0">
          {meta.model ? (
            <ModelChip model={meta.model} llmConnection={meta.llmConnection} short className="w-full max-w-full" />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
      )}
      {showUpdated && (
        <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatRelative(meta.lastMessageAt)}</span>
      )}
      {showCreated && (
        <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(meta.createdAt)}</span>
      )}
      {showMessages && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{meta.messageCount ?? '—'}</span>
      )}
      {showTokens && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{meta.tokenUsage?.totalTokens ?? '—'}</span>
      )}
      {showDuration && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(sessionDuration(meta))}</span>
      )}
      {showSize && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTranscriptSize(meta.transcriptBytes)}</span>
      )}
      {showToolCalls && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{meta.toolCallCount ?? '—'}</span>
      )}
      {showCommits && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{meta.commitCount ?? '—'}</span>
      )}
      {showParallelAgents && (
        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{parallelAgentCount}</span>
      )}

      {showFlag && (
        <button
          type="button"
          className={cn(
            'w-8 shrink-0 text-muted-foreground/50 hover:text-amber-400',
            meta.isFlagged && 'text-amber-500',
          )}
          aria-pressed={Boolean(meta.isFlagged)}
          onClick={() => onUpdate({ isFlagged: !meta.isFlagged })}
        >
          <FlagIcon className="h-3.5 w-3.5" fill={meta.isFlagged ? 'currentColor' : 'none'} />
        </button>
      )}
    </li>
  )
}
