/**
 * W1-06 (#1503) — Local reference backend.
 *
 * - `task` → the PersonalTask v3 store (`putWorkItem`, CAS on the file
 *   revision), so tasks created through the bus show up in the Tasks UI;
 *   every field the bus writes is passed through (none is dropped);
 * - `task-list` → the PersonalTask meta projects (the lists the Tasks UI
 *   shows): `listId` == v2 `projectId`, no separate list store;
 * - `entity-link` → `{workspaceRoot}/work/links/` plus the W1-02 link index
 *   (`.rox/entity-links.sqlite`) so backlinks resolve;
 * - everything else → `LocalWorkStore` (`{workspaceRoot}/work/<dir>/`).
 *
 * Local writes are file writes outside the command-store SQLite transaction;
 * each record carries the command id that last wrote it so a retried command
 * whose receipt was lost finds its own effect instead of applying twice.
 */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef, EntityRelation } from '@rox/core/entities'
import type { WorkItem } from '@rox/core/tasks/personal'
import { collectionSpec } from '../collections'
import type { RecordBackend, RecordData, RecordWrite, StoredRecord } from '../types'
import type { LocalWorkStore } from '../../local-work-store'
import type { PersonalTaskPersistStore } from '../../../tasks/personal-persist'

/** The slice of `EntityLinkStore` the backend mirrors links into. */
export interface LocalLinkIndex {
  add(input: { from: EntityRef; to: EntityRef; relation: EntityRelation; role?: string; anchor?: Record<string, unknown>; createdBy: string }): unknown
  remove(input: { from: EntityRef; to: EntityRef; relation: EntityRelation }): boolean
}

function itemToData(item: WorkItem): RecordData {
  const data: RecordData = {}
  for (const [key, value] of Object.entries(item)) if (key !== 'id' && key !== 'revision' && value !== undefined) data[key] = value
  if (item.trashedAt) data.deletedAt = item.trashedAt
  return data
}

function dataToItem(id: string, data: RecordData, revision: number): WorkItem {
  // Full passthrough: every field the bus wrote reaches `fromWorkItem`, which
  // keeps the v2 task fields (reminder delivery, repeat chain…) and the work half.
  const item: Record<string, unknown> = { id, revision }
  for (const [key, value] of Object.entries(data)) if (key !== 'id' && key !== 'revision' && key !== 'deletedAt' && value !== undefined && value !== null) item[key] = value
  if (typeof data.deletedAt === 'string' && !item.trashedAt) item.trashedAt = data.deletedAt
  if (!data.deletedAt && !data.trashedAt) delete item.trashedAt
  return item as unknown as WorkItem
}

export interface LocalBackendOptions {
  work: LocalWorkStore
  tasks?: PersonalTaskPersistStore | null
  /** The task store is not available to this session (thrown on any `task` / `task-list` access). */
  tasksUnavailable?: unknown
  links?: LocalLinkIndex | null
  /** Called once per backend (= per command) after the first `task` / `task-list` write. */
  onTasksChanged?: () => void
}

const PERSONAL_TASK_COLLECTIONS = new Set(['task', 'task-list'])

export class LocalRecordBackend implements RecordBackend {
  readonly name = 'local' as const
  private tasksChanged = false

  constructor(private readonly options: LocalBackendOptions) {}

  private assertTasksAvailable(collection: string): void {
    if (this.options.tasksUnavailable !== undefined && PERSONAL_TASK_COLLECTIONS.has(collection)) throw this.options.tasksUnavailable
  }

  private markTasksChanged(): void {
    if (this.tasksChanged) return
    this.tasksChanged = true
    try { this.options.onTasksChanged?.() } catch { /* a refresh push never fails the command */ }
  }

  private dir(collection: string): string {
    return collectionSpec(collection).localDir ?? collection
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    this.assertTasksAvailable(collection)
    if (collection === 'task' && this.options.tasks) {
      let persisted
      try { persisted = this.options.tasks.getWorkItem(id) } catch { return null }
      return persisted ? { id, revision: persisted.revision, data: itemToData(persisted.item) } : null
    }
    if (collection === 'task-list' && this.options.tasks) {
      let list
      try { list = this.options.tasks.getTaskList(id) } catch { return null }
      return list ? { id, revision: list.revision, data: list.data } : null
    }
    let file
    try { file = this.options.work.get(this.dir(collection), id) } catch { return null }
    return file ? { id, revision: file.revision, data: file.record } : null
  }

  async put(write: RecordWrite) {
    this.assertTasksAvailable(write.collection)
    if (write.collection === 'task' && this.options.tasks) {
      let result
      try {
        result = this.options.tasks.putWorkItem(dataToItem(write.id, write.data, (write.expectedRevision ?? 0) + 1), write.expectedRevision)
      } catch (error) {
        if (error instanceof TypeError) throw new CommandRejection('VALIDATION', error.message)
        throw error
      }
      if (result.status === 'conflict') {
        return { status: 'conflict' as const, current: result.current ? { id: write.id, revision: result.current.revision, data: write.expectedRevision === null ? {} : itemToData(result.current.item) } : null }
      }
      this.markTasksChanged()
      return { status: 'accepted' as const, revision: result.record.revision }
    }
    if (write.collection === 'task-list' && this.options.tasks) {
      let result
      try {
        result = this.options.tasks.putTaskList(write.id, write.data, write.expectedRevision)
      } catch (error) {
        if (error instanceof TypeError) throw new CommandRejection('VALIDATION', error.message)
        throw error
      }
      if (result.status === 'conflict') return { status: 'conflict' as const, current: result.current ? { id: write.id, revision: result.current.revision, data: write.expectedRevision === null ? {} : result.current.data } : null }
      this.markTasksChanged()
      return { status: 'accepted' as const, revision: result.revision }
    }
    let result
    try {
      result = this.options.work.put(this.dir(write.collection), write.id, write.data, write.expectedRevision)
    } catch (error) {
      if (error instanceof TypeError) throw new CommandRejection('VALIDATION', error.message)
      throw error
    }
    // A create conflict carries the revision only (the existing record may be outside the caller's ACL).
    if (result.status === 'conflict') return { status: 'conflict' as const, current: result.current ? { id: write.id, revision: result.current.revision, data: write.expectedRevision === null ? {} : result.current.record } : null }
    if (write.collection === 'entity-link') this.mirrorLink(write.data)
    return { status: 'accepted' as const, revision: result.file.revision }
  }

  async remove(collection: string, id: string): Promise<boolean> {
    this.assertTasksAvailable(collection)
    if (PERSONAL_TASK_COLLECTIONS.has(collection) && this.options.tasks) {
      const removed = collection === 'task' ? this.options.tasks.delete(id) : this.options.tasks.removeTaskList(id)
      if (removed) this.markTasksChanged()
      return removed
    }
    const current = await this.get(collection, id)
    const removed = this.options.work.remove(this.dir(collection), id)
    if (removed && collection === 'entity-link' && current) this.mirrorLink({ ...current.data, deletedAt: 'removed' })
    return removed
  }

  private mirrorLink(data: RecordData): void {
    const links = this.options.links
    if (!links) return
    const from = { kind: data.fromKind, id: data.fromId, ...(data.fromFragment ? { fragment: data.fromFragment } : {}) } as EntityRef
    const to = { kind: data.toKind, id: data.toId, ...(data.toFragment ? { fragment: data.toFragment } : {}) } as EntityRef
    const relation = data.relation as EntityRelation
    if (data.deletedAt) links.remove({ from, to, relation })
    else links.add({ from, to, relation, ...(data.role ? { role: String(data.role) } : {}), ...(data.anchor ? { anchor: data.anchor as Record<string, unknown> } : {}), createdBy: String(data.createdBy ?? 'local') })
  }
}
