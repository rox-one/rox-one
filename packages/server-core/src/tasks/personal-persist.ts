/**
 * PersonalTaskPersistStore — durable canonical personal-task KV
 * (ROX-AUD-101 / #332, ROX-P0-TASK-KV).
 *
 * Layout: {root}/personal-tasks/<id>.json — one JSON document per task, same
 * per-file + tmp+rename pattern as KnowledgeMutationProposalsStore. Root is
 * caller-supplied (typically the config dir); this module does not replace
 * renderer localStorage.
 *
 * put/get/list carry a monotonic numeric revision (never a hardcoded `'1'`
 * string). put is idempotent by id: identical payload keeps the revision;
 * a changed payload rewrites the same file and increments revision.
 *
 * Reads are fail-soft: unknown/unsafe/corrupt ids yield null and are skipped
 * from list; corrupt sibling files are left on disk.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'

const TASK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export interface PersistedPersonalTask {
  task: PersonalTask
  revision: number
}

interface PersistFile {
  id: string
  revision: number
  task: PersonalTask
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersonalTask(value: unknown): value is PersonalTask {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || !TASK_ID_RE.test(value.id)) return false
  if (typeof value.title !== 'string') return false
  if (typeof value.notes !== 'string') return false
  if (typeof value.list !== 'string') return false
  if (!Array.isArray(value.tags)) return false
  if (typeof value.priority !== 'string') return false
  if (typeof value.evening !== 'boolean') return false
  if (!Array.isArray(value.links)) return false
  if (typeof value.order !== 'number') return false
  if (typeof value.createdAt !== 'number') return false
  return true
}

export function parsePersonalTaskPersistFile(content: string): PersistFile | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isPlainRecord(parsed)) return null
    if (typeof parsed.id !== 'string' || !TASK_ID_RE.test(parsed.id)) return null
    if (typeof parsed.revision !== 'number' || !Number.isInteger(parsed.revision) || parsed.revision < 1) return null
    if (!isPersonalTask(parsed.task) || parsed.task.id !== parsed.id) return null
    return { id: parsed.id, revision: parsed.revision, task: parsed.task }
  } catch {
    return null
  }
}

function tasksEqual(a: PersonalTask, b: PersonalTask): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class PersonalTaskPersistStore {
  /** {root}/personal-tasks — personal (config-dir) scope, not the DAG `tasks/` tree. */
  readonly dir: string

  constructor(rootDir: string) {
    this.dir = join(rootDir, 'personal-tasks')
    this.cleanupOrphanTmp()
  }

  put(task: PersonalTask): PersistedPersonalTask {
    if (!TASK_ID_RE.test(task.id)) {
      throw new TypeError(`Invalid personal-task id (refused for path safety): ${JSON.stringify(task.id)}`)
    }
    const existing = this.readRecord(task.id)
    if (existing && tasksEqual(existing.task, task)) {
      return { task: existing.task, revision: existing.revision }
    }
    const revision = (existing?.revision ?? 0) + 1
    const record: PersistFile = { id: task.id, revision, task }
    this.writeRecord(record)
    return { task, revision }
  }

  get(id: string): PersistedPersonalTask | null {
    const record = this.readRecord(id)
    if (!record) return null
    return { task: record.task, revision: record.revision }
  }

  list(): PersistedPersonalTask[] {
    return this.readAll().map((record) => ({ task: record.task, revision: record.revision }))
  }

  private readRecord(id: string): PersistFile | null {
    if (!TASK_ID_RE.test(id)) return null
    const path = this.recordPath(id)
    if (!existsSync(path)) return null
    return parsePersonalTaskPersistFile(readFileSync(path, 'utf8'))
  }

  private readAll(): PersistFile[] {
    let names: string[]
    try {
      names = readdirSync(this.dir).sort()
    } catch {
      return []
    }
    const records: PersistFile[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = parsePersonalTaskPersistFile(readFileSync(join(this.dir, name), 'utf8'))
      if (parsed) records.push(parsed)
    }
    return records
  }

  private writeRecord(record: PersistFile): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = join(this.dir, `.${Date.now()}-${process.pid}.${record.id}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(record)}\n`)
    renameSync(tmp, this.recordPath(record.id))
  }

  private recordPath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.dir)) return
      for (const entry of readdirSync(this.dir)) {
        if (!entry.endsWith('.tmp')) continue
        try { unlinkSync(join(this.dir, entry)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}
