import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { CollectionFilters, DueRange } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import { resolveStatusDisplayLabel } from '@/config/session-status-config'
import { cn } from '@/lib/utils'

const PRIORITIES: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

type SimpleDue = 'overdue' | 'today' | 'none'

export interface CollectionFilterChipsProps {
  filters: CollectionFilters
  onFiltersChange: (next: CollectionFilters) => void
  statuses?: SessionStatus[]
  priorities?: SessionPriority[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
  layout?: 'inline' | 'stacked'
}

function dueType(filters: CollectionFilters): SimpleDue | null {
  if (!filters.due) return null
  if (filters.due.type === 'overdue' || filters.due.type === 'today' || filters.due.type === 'none') {
    return filters.due.type
  }
  return null
}

function hasActiveFilters(filters: CollectionFilters): boolean {
  return Boolean(
    (filters.status && filters.status.length > 0) ||
      (filters.priority && filters.priority.length > 0) ||
      (filters.projectId && filters.projectId.length > 0) ||
      (filters.labels && filters.labels.length > 0) ||
      filters.due ||
      typeof filters.flagged === 'boolean' ||
      typeof filters.hasUnread === 'boolean' ||
      (filters.model && filters.model.length > 0),
  )
}

export function CollectionFilterChips({
  filters,
  onFiltersChange,
  statuses = [],
  priorities = PRIORITIES,
  projects = [],
  labels = [],
  className,
  layout = 'inline',
}: CollectionFilterChipsProps) {
  const { t } = useTranslation()
  const stacked = layout === 'stacked'

  const toggleStatus = (id: string) => {
    const current = new Set(filters.status ?? [])
    if (current.has(id)) current.delete(id)
    else current.add(id)
    const next = Array.from(current)
    onFiltersChange({
      ...filters,
      status: next.length > 0 ? next : undefined,
    })
  }

  const toggleProject = (id: string) => {
    const current = new Set(filters.projectId ?? [])
    if (current.has(id)) current.delete(id)
    else current.add(id)
    const next = Array.from(current)
    onFiltersChange({
      ...filters,
      projectId: next.length > 0 ? next : undefined,
    })
  }

  const toggleLabel = (id: string) => {
    const current = new Set(filters.labels ?? [])
    if (current.has(id)) current.delete(id)
    else current.add(id)
    const next = Array.from(current)
    onFiltersChange({
      ...filters,
      labels: next.length > 0 ? next : undefined,
    })
  }

  const togglePriority = (p: SessionPriority) => {
    const current = new Set(filters.priority ?? [])
    if (current.has(p)) current.delete(p)
    else current.add(p)
    const next = Array.from(current)
    onFiltersChange({
      ...filters,
      priority: next.length > 0 ? next : undefined,
    })
  }

  const toggleDue = (type: SimpleDue) => {
    const current = dueType(filters)
    if (current === type) {
      const { due: _due, ...rest } = filters
      onFiltersChange(rest)
      return
    }
    const due: DueRange = { type }
    onFiltersChange({ ...filters, due })
  }

  const clearAll = () => onFiltersChange({})

  const activeDue = dueType(filters)
  const active = hasActiveFilters(filters)

  return (
    <div
      className={cn(
        'flex min-w-0',
        stacked ? 'flex-col gap-2' : 'flex-wrap items-center gap-1.5',
        className,
      )}
    >
      {statuses.length > 0 && (
        <ChipGroup label={t('collection.filter.status')} stacked={stacked}>
          {statuses.map((state) => {
            const selected = (filters.status ?? []).includes(state.id)
            return (
              <FilterOption
                key={state.id}
                stacked={stacked}
                selected={selected}
                label={resolveStatusDisplayLabel(state, t)}
                onClick={() => toggleStatus(state.id)}
              />
            )
          })}
        </ChipGroup>
      )}

      <ChipGroup label={t('collection.filter.priority')} stacked={stacked}>
        {priorities.map((p) => {
          const selected = (filters.priority ?? []).includes(p)
          return (
            <FilterChip
              key={p}
              selected={selected}
              label={t(`priority.${p}`)}
              onClick={() => togglePriority(p)}
            />
          )
        })}
      </ChipGroup>

      {projects.length > 0 && (
        <ChipGroup label={t('collection.filter.project', { defaultValue: 'Project' })} stacked={stacked}>
          {projects.map((project) => (
            <FilterOption
              key={project.id}
              stacked={stacked}
              selected={(filters.projectId ?? []).includes(project.id)}
              label={project.name}
              onClick={() => toggleProject(project.id)}
            />
          ))}
        </ChipGroup>
      )}

      {labels.length > 0 && (
        <ChipGroup label={t('collection.filter.label', { defaultValue: 'Label' })} stacked={stacked}>
          {labels.map((label) => (
            <FilterOption
              key={label.id}
              stacked={stacked}
              selected={(filters.labels ?? []).includes(label.id)}
              label={label.name}
              onClick={() => toggleLabel(label.id)}
            />
          ))}
        </ChipGroup>
      )}

      <ChipGroup label={t('collection.filter.due')} stacked={stacked}>
        {(['overdue', 'today', 'none'] as SimpleDue[]).map((type) => (
          <FilterOption
            key={type}
            stacked={stacked}
            selected={activeDue === type}
            label={t(`collection.filter.due.${type}`)}
            onClick={() => toggleDue(type)}
          />
        ))}
      </ChipGroup>

      {active && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <X className="h-3 w-3" />
          {t('collection.filter.clear')}
        </button>
      )}
    </div>
  )
}

function ChipGroup({
  label,
  children,
  stacked,
}: {
  label: string
  children: React.ReactNode
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0',
        stacked ? 'flex-col gap-1' : 'flex-wrap items-center gap-1',
      )}
    >
      <span className="mr-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </span>
      {stacked ? (
        <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

function FilterOption({
  stacked,
  selected,
  label,
  onClick,
}: {
  stacked: boolean
  selected: boolean
  label: string
  onClick: () => void
}) {
  if (stacked) {
    return (
      <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-[12px] hover:bg-foreground/[0.04]">
        <input
          type="checkbox"
          checked={selected}
          onChange={onClick}
          className="h-3.5 w-3.5 shrink-0 accent-foreground"
        />
        <span className="min-w-0 truncate">{label}</span>
      </label>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-6 max-w-[10rem] items-center truncate rounded-full border px-2 text-[11px] transition-colors',
        selected
          ? 'border-foreground/25 bg-foreground/[0.1] font-medium text-foreground'
          : 'border-border/50 bg-transparent text-foreground/55 hover:border-border hover:bg-foreground/[0.04] hover:text-foreground/80',
      )}
    >
      {label}
    </button>
  )
}
