/**
 * Sessions collection display / filter contracts (PRD §5).
 * Pure types only — no I/O.
 */

import type { SessionPriority } from '../protocol/dto.ts'
import type { CollectionAgentFamily } from './collection-agent-family.ts'

export type { SessionPriority, CollectionAgentFamily }

/** Collection surface mode (list navigator, kanban board, dense table, year heatmap). */
export type CollectionViewMode = 'list' | 'board' | 'table' | 'heatmap'

/** Grouping dimension for list/table (board uses this for secondary subsections). */
export type CollectionGroupBy =
  | 'none'
  | 'status'
  | 'priority'
  | 'project'
  | 'dueDate'
  | 'label'

/** Sort key for collection ordering. */
export type CollectionOrderBy =
  | 'rank'
  | 'priority'
  | 'dueDate'
  | 'lastMessageAt'
  | 'createdAt'
  | 'name'

/** Optional property columns / chips controllable via Display. */
export type CollectionProperty =
  | 'status'
  | 'priority'
  | 'project'
  | 'labels'
  | 'dueDate'
  | 'model'
  | 'updated'
  | 'created'
  | 'flag'
  | 'messages'
  | 'tokens'
  | 'duration'

export type CollectionOrderDir = 'asc' | 'desc'

/** Row spacing for list/table collection surfaces. */
export type CollectionDensity = 'compact' | 'comfortable'

/**
 * Workspace-persisted collection display settings.
 * Stored at `{workspace}/collection/display.json`.
 */
export interface CollectionDisplay {
  version: 1
  groupBy: CollectionGroupBy
  orderBy: CollectionOrderBy
  orderDir: CollectionOrderDir
  visibleProperties: CollectionProperty[]
  showEmptyGroups: boolean
  showCompleted: boolean
  density: CollectionDensity
  /** When false, session rows hide unread/flag/archive hover buttons (More remains). */
  hoverActions: boolean
}

/** Due-date filter chip value. */
export type DueRange =
  | { type: 'none' }
  | { type: 'overdue' }
  | { type: 'today' }
  | { type: 'next_n_days'; days: number }
  | { type: 'range'; start: number; end: number }

/**
 * Collection filter chips.
 * AND across dimensions; OR within each array dimension.
 */
export interface CollectionFilters {
  status?: string[]
  priority?: SessionPriority[]
  projectId?: string[]
  labels?: string[]
  due?: DueRange
  flagged?: boolean
  hasUnread?: boolean
  model?: string[]
  agentFamily?: CollectionAgentFamily[]
}

/** Default Display for new workspaces / missing files (plan B2.2). */
export const DEFAULT_COLLECTION_DISPLAY: CollectionDisplay = {
  version: 1,
  groupBy: 'none',
  orderBy: 'rank',
  orderDir: 'asc',
  visibleProperties: [
    'status',
    'priority',
    'project',
    'labels',
    'dueDate',
    'updated',
    'flag',
  ],
  showEmptyGroups: false,
  showCompleted: true,
  density: 'compact',
  hoverActions: true,
}

/** Default empty filters (no chips active). */
export const DEFAULT_COLLECTION_FILTERS: CollectionFilters = {}

/** Allowed enum values (shared by normalize). */
export const COLLECTION_GROUP_BY_VALUES: readonly CollectionGroupBy[] = [
  'none',
  'status',
  'priority',
  'project',
  'dueDate',
  'label',
] as const

export const COLLECTION_ORDER_BY_VALUES: readonly CollectionOrderBy[] = [
  'rank',
  'priority',
  'dueDate',
  'lastMessageAt',
  'createdAt',
  'name',
] as const

export const COLLECTION_DENSITY_VALUES: readonly CollectionDensity[] = [
  'compact',
  'comfortable',
] as const

export const COLLECTION_PROPERTY_VALUES: readonly CollectionProperty[] = [
  'status',
  'priority',
  'project',
  'labels',
  'dueDate',
  'model',
  'updated',
  'created',
  'flag',
  'messages',
  'tokens',
  'duration',
] as const
