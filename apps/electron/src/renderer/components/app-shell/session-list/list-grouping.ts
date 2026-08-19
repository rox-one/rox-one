/**
 * Sessions list grouping unification + FR-45 rank-drag helpers.
 *
 * Grouping: `CollectionDisplay.groupBy` drives the list when set to a real
 * dimension (status/project map onto the legacy list modes; priority/dueDate/
 * label are list-native modes). `groupBy === 'none'` (or unset) falls back to
 * the legacy per-view `ChatGroupingMode` from localStorage `view-filters`.
 *
 * Rank drag: pure helpers shared by SessionList's HTML5 DnD wiring — bucket
 * keys, FR-47 cross-group action mapping (delegates to the table's
 * `crossGroupDropAction` after key translation), and drop-neighbor computation
 * consumed with `retryStaleRankReorder` from `lib/collection-reorder`.
 */

import { startOfDay } from 'date-fns'
import type { SessionPriority } from '@craft-agent/shared/protocol/dto'
import { dueBucket, type CollectionGroupBy, type DueBucket } from '@craft-agent/shared/sessions/collection'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionStatus } from '@/utils/session'
import {
  crossGroupDropAction,
  type CrossGroupDropAction,
} from '../session-table/table-drag'

/** Legacy list grouping modes (per-view localStorage `view-filters`). */
export type ChatGroupingMode = 'date' | 'status' | 'unread' | 'project'

/** Effective list grouping: legacy modes + Display-driven modes. */
export type ListGroupingMode = ChatGroupingMode | 'priority' | 'dueDate' | 'label'

/** Fixed group order for priority mode (most urgent first). */
export const LIST_PRIORITY_ORDER: readonly SessionPriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const

/** Fixed group order for due-date mode (most pressing first). */
export const LIST_DUE_ORDER: readonly DueBucket[] = [
  'overdue',
  'today',
  'this_week',
  'later',
  'none',
] as const

/**
 * Display groupBy wins when it names a real dimension; 'none'/unset keeps the
 * legacy per-view grouping mode.
 */
export function resolveListGroupingMode(
  displayGroupBy: CollectionGroupBy | undefined,
  legacyMode: ChatGroupingMode,
): ListGroupingMode {
  switch (displayGroupBy) {
    case 'status':
    case 'project':
    case 'priority':
    case 'dueDate':
    case 'label':
      return displayGroupBy
    default:
      return legacyMode
  }
}

/**
 * Bucket key for one session under a grouping mode. Legacy modes keep their
 * historic key shapes (collapse persistence in localStorage depends on them);
 * Display-driven modes use the table's `dim:value` shapes.
 */
export function getListGroupKey(
  item: SessionMeta,
  mode: ListGroupingMode,
  now: number = Date.now(),
): string {
  switch (mode) {
    case 'status':
      return `status-${getSessionStatus(item)}`
    case 'unread':
      return item.hasUnread ? 'unread-yes' : 'unread-no'
    case 'project':
      return `project-${item.projectId ?? '__none__'}`
    case 'priority':
      return `priority:${item.priority ?? 'none'}`
    case 'dueDate':
      return `due:${dueBucket(item.dueDate ?? null, now)}`
    case 'label': {
      const first = (item.labels ?? []).slice().sort((a, b) => a.localeCompare(b))[0]
      return first ? `label:${first}` : 'label:none'
    }
    default:
      return startOfDay(new Date(item.lastMessageAt || 0)).toISOString()
  }
}

/**
 * FR-47 cross-group drop: translate the list bucket key to the table's key
 * shape and reuse the table's writable-field mapping. Non-writable dimensions
 * (date/unread/dueDate/label) reject the move.
 */
export function listCrossGroupDropAction(
  mode: ListGroupingMode,
  targetBucketKey: string,
): CrossGroupDropAction | null {
  switch (mode) {
    case 'status':
      return targetBucketKey.startsWith('status-')
        ? crossGroupDropAction('status', `status:${targetBucketKey.slice('status-'.length)}`)
        : null
    case 'project': {
      if (!targetBucketKey.startsWith('project-')) return null
      const id = targetBucketKey.slice('project-'.length)
      return crossGroupDropAction('project', `project:${id === '__none__' ? '' : id}`)
    }
    case 'priority':
      return crossGroupDropAction('priority', targetBucketKey)
    default:
      return null
  }
}

export interface ListRankReorderRequest {
  sessionId: string
  prevId?: string
  nextId?: string
  previous?: SessionMeta
  next?: SessionMeta
}

/**
 * Drop-neighbor computation for the list. `peers` are the visible sessions of
 * the target bucket in visual (rank) order, WITHOUT the dragged session.
 * Mirrors the table host's inline rankRequestFor.
 */
export function listRankReorderRequest(
  dragId: string,
  targetId: string,
  before: boolean,
  peers: SessionMeta[],
): ListRankReorderRequest | null {
  const targetIndex = peers.findIndex((item) => item.id === targetId)
  if (targetIndex < 0) return null
  const insertAt = before ? targetIndex : targetIndex + 1
  const previous = insertAt > 0 ? peers[insertAt - 1] : undefined
  const next = insertAt < peers.length ? peers[insertAt] : undefined
  return { sessionId: dragId, prevId: previous?.id, nextId: next?.id, previous, next }
}
