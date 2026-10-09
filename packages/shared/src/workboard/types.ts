import type { WorkspaceTaskLink, WorkspaceTaskStatus } from '@rox/shared/workspace-work'

/** A board column is exactly a workspace task status (the frozen kanban-like board). */
export type WorkboardColumn = WorkspaceTaskStatus

/**
 * One card: a `WorkspaceTask` projected onto the work board.
 *
 * A superset of the frozen `WorkboardCardDto` (taskId/column/rank?/title?) so the
 * canonical projection can travel over `workboard:read|move` unchanged. `rank` is
 * intentionally absent: the canonical `WorkspaceTask` has no ordering column
 * (see `WorkboardMoveInput.rank`).
 */
export interface WorkboardCard {
  taskId: string
  column: WorkboardColumn
  title: string
  dueAt: number | null
  links: WorkspaceTaskLink[]
  /** Per-entity revision (not the board revision). */
  revision: number
  updatedAt: number
}

/** Result of `workboard:read`. `unchanged` short-circuits an already-current client. */
export interface WorkboardReadResult {
  revision: number
  cards: WorkboardCard[]
  /** True when `sinceRevision` matched the current revision (cards omitted). */
  unchanged?: boolean
}

/** Input of `workboard:move`; `expectedRevision` is the board revision, not the task's. */
export interface WorkboardMoveInput {
  expectedRevision: number
  taskId: string
  column: WorkboardColumn
  /** Optional fractional ordering key. The canonical task store has no rank field. */
  rank?: string
}

/** Result of `workboard:move`. */
export interface WorkboardMoveResult {
  revision: number
  task: WorkboardCard
}