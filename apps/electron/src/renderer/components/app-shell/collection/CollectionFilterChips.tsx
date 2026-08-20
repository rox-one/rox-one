import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { CollectionFilters, DueRange } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import { resolveStatusDisplayLabel } from '@/config/session-status-config'
import { cn } from '@/lib/utils'
import { CollectionMenuRadioRow, CollectionMenuRow, CollectionMenuSection } from './collection-menu-row'

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

  const statusOptions = statuses.map((state) => ({
    key: state.id,
    selected: (filters.status ?? []).includes(state.id),
    label: resolveStatusDisplayLabel(state, t),
    onClick: () => toggleStatus(state.id),
    radio: false,
  }))
  const priorityOptions = priorities.map((p) => ({
    key: p,
    selected: (filters.priority ?? []).includes(p),
    label: t(`priority.${p}`),
    onClick: () => togglePriority(p),
    radio: false,
  }))
  const projectOptions = projects.map((project) => ({
    key: project.id,
    selected: (filters.projectId ?? []).includes(project.id),
    label: project.name,
    onClick: () => toggleProject(project.id),
    radio: false,
  }))
  const labelOptions = labels.map((label) => ({
    key: label.id,
    selected: (filters.labels ?? []).includes(label.id),
    label: label.name,
    onClick: () => toggleLabel(label.id),
    radio: false,
  }))
  const dueOptions = (['overdue', 'today', 'none'] as SimpleDue[]).map((type) => ({
    key: type,
    selected: activeDue === type,
    label: t(`collection.filter.due.${type}`),
    onClick: () => toggleDue(type),
    radio: true,
  }))

  const groups = [
    statuses.length > 0 ? { label: t('collection.filter.status'), options: statusOptions } : null,
    { label: t('collection.filter.priority'), options: priorityOptions },
    projects.length > 0 ? { label: t('collection.filter.project', { defaultValue: 'Project' }), options: projectOptions } : null,
    labels.length > 0 ? { label: t('collection.filter.label', { defaultValue: 'Label' }), options: labelOptions } : null,
    { label: t('collection.filter.due'), options: dueOptions },
  ].filter(Boolean) as Array<{
    label: string
    options: Array<{ key: string; selected: boolean; label: string; onClick: () => void; radio: boolean }>
  }>

  return (
    <div
      className={cn(
        'flex min-w-0',
        stacked ? 'flex-col gap-1' : 'flex-wrap items-center gap-1.5',
        className,
      )}
    >
      {groups.map((group) => (
        stacked ? (
          <CollectionMenuSection key={group.label} label={group.label}>
            {group.options.map((option) =>
              option.radio ? (
                <CollectionMenuRadioRow
                  key={option.key}
                  selected={option.selected}
                  label={option.label}
                  onClick={option.onClick}
                />
              ) : (
                <CollectionMenuRow
                  key={option.key}
                  selected={option.selected}
                  label={option.label}
                  onClick={option.onClick}
                />
              ),
            )}
          </CollectionMenuSection>
        ) : (
          <ChipGroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <FilterChip
                key={option.key}
                selected={option.selected}
                label={option.label}
                onClick={option.onClick}
              />
            ))}
          </ChipGroup>
        )
      ))}

      {active && stacked && <div className="mx-1 my-1 h-px bg-foreground/8" />}
      {active && (
        <button
          type="button"
          onClick={clearAll}
          className={cn(
            'inline-flex items-center gap-1 rounded-[4px] text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground',
            stacked ? 'mx-1 h-7 px-2' : 'h-6 px-1.5',
          )}
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
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterChip({
  selected,
  label,
  onClick,
}: {
  selected: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-6 max-w-[10rem] items-center truncate rounded-full border px-2 text-[11px] transition-colors',
        selected
          ? 'border-foreground/20 bg-foreground/[0.08] font-medium text-foreground'
          : 'border-transparent bg-foreground/[0.03] text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80',
      )}
    >
      {label}
    </button>
  )
}
