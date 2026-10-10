import { z } from 'zod'
import { CodedError } from '@rox/shared/protocol'
import { WORKSPACE_TASK_STATUSES, type WorkspaceTask } from '@rox/shared/workspace-work'
import type { WorkboardCard, WorkboardMoveResult, WorkboardReadResult } from '@rox/shared/workboard'
import type { WorkspaceWorkActor } from '../workspace-work/service.ts'
import { WorkspaceWorkStore } from '../workspace-work/store.ts'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const moveSchema = z.object({
  expectedRevision: revision,
  taskId: id,
  column: z.enum(WORKSPACE_TASK_STATUSES),
  rank: z.string().min(1).max(256).optional(),
}).strict()
const optionsSchema = z.object({ sinceRevision: revision.optional() }).strict()

function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new CodedError('INVALID_PAYLOAD', 'Invalid workboard payload')
  return result.data as T
}
function forbidden(): never { throw new CodedError('FORBIDDEN', 'Workboard action denied') }
function missing(): never { throw new CodedError('NOT_FOUND', 'Workboard task unavailable') }

/**
 * The board is a projection over the canonical workspace-work store: a card is a
 * `WorkspaceTask`, its column is the task status. Writes go through the same
 * revision-guarded `WorkspaceWorkStore.commit`, so the board inherits the store's
 * CAS, actor re-validation and whole-state link/workspace validation.
 */
export class WorkboardService {
  constructor(readonly store: WorkspaceWorkStore) {}

  private card(task: WorkspaceTask): WorkboardCard {
    return {
      taskId: task.id,
      column: task.status,
      title: task.title,
      dueAt: task.dueAt,
      links: task.links.map(link => ({ ...link })),
      revision: task.revision,
      updatedAt: task.updatedAt,
    }
  }

  private board(tasks: WorkspaceTask[]): WorkboardCard[] {
    const order = Object.fromEntries(WORKSPACE_TASK_STATUSES.map((status, index) => [status, index])) as Record<string, number>
    return tasks
      .map(task => this.card(task))
      .sort((left, right) =>
        order[left.column]! - order[right.column]! ||
        right.updatedAt - left.updatedAt ||
        left.taskId.localeCompare(right.taskId))
  }

  /** Reads the board; an exact `sinceRevision` match short-circuits with no cards. */
  readBoard(actor: WorkspaceWorkActor, options: { sinceRevision?: number } = {}): WorkboardReadResult {
    const { sinceRevision } = parse<{ sinceRevision?: number }>(optionsSchema, options)
    actor.assertCurrent('read')
    const state = this.store.read()
    if (sinceRevision !== undefined && sinceRevision === state.revision) {
      return { revision: state.revision, cards: [], unchanged: true }
    }
    return { revision: state.revision, cards: this.board(state.tasks) }
  }

  /**
   * Moves one card to another column (task status) under the board revision.
   * A supplied `rank` is rejected: the canonical task store has no ordering
   * column, so honouring it would silently drop the requested order.
   */
  move(actor: WorkspaceWorkActor, input: unknown): WorkboardMoveResult {
    const command = parse<z.infer<typeof moveSchema>>(moveSchema, input)
    if (command.rank !== undefined) throw new CodedError('UNSUPPORTED_OPERATION', 'Workboard rank override is unavailable')
    if (!actor.canWrite) forbidden()
    const committed = this.store.commit(command.expectedRevision, state => {
      const task = state.tasks.find(task => task.id === command.taskId) ?? missing()
      if (!actor.canManage && actor.actorId !== task.authorId && actor.actorId !== task.assigneeId) forbidden()
      task.status = command.column
      task.revision++
      task.updatedAt = Date.now()
      return task.id
    }, () => actor.assertCurrent('write'))
    const task = committed.state.tasks.find(task => task.id === command.taskId)!
    return { revision: committed.state.revision, task: this.card(task) }
  }
}