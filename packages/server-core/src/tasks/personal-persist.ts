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
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'fs'
import { basename, join } from 'path'
import type { PersonalTask, PersonalTaskMeta, PersonalTaskMigrationMarker, PersonalTaskWrite } from '@craft-agent/core/tasks/personal'

const TASK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** v2 = Things-style fields (checklist, trashedAt, reminderAt, source, repeat modes). */
export const PERSONAL_TASK_SCHEMA_VERSION = 2

export type { PersonalTaskMeta, PersonalTaskMigrationMarker } from '@craft-agent/core/tasks/personal'

export interface PersistedPersonalTask {
  task: PersonalTask
  revision: number
}

export type PersonalTaskWriteResult =
  | { status: 'accepted'; record: PersistedPersonalTask }
  | { status: 'conflict'; current: PersistedPersonalTask | null }

export type PersonalTaskDeleteResult =
  | { status: 'removed' }
  | { status: 'conflict'; current: PersistedPersonalTask | null }

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
    this.assertSafeId(task.id)
    return this.withRecordLock(task.id, () => this.putUnlocked(task))
  }

  putIfRevision(write: PersonalTaskWrite): PersonalTaskWriteResult {
    this.assertSafeId(write.task.id)
    if (write.expectedRevision !== null && (!Number.isInteger(write.expectedRevision) || write.expectedRevision < 1)) {
      throw new TypeError('Expected task revision must be null or a positive integer')
    }
    return this.withRecordLock(write.task.id, () => {
      const current = this.readRecord(write.task.id)
      if ((current?.revision ?? null) !== write.expectedRevision) {
        return { status: 'conflict', current: current ? { task: current.task, revision: current.revision } : null }
      }
      return { status: 'accepted', record: this.putUnlocked(write.task) }
    })
  }

  get(id: string): PersistedPersonalTask | null {
    const record = this.readRecord(id)
    if (!record) return null
    return { task: record.task, revision: record.revision }
  }

  list(): PersistedPersonalTask[] {
    return this.readAll().map((record) => ({ task: record.task, revision: record.revision }))
  }

  /** Remove one task file. Unknown/unsafe ids are a no-op (false). */
  delete(id: string): boolean {
    if (!TASK_ID_RE.test(id)) return false
    return this.withRecordLock(id, () => {
      const path = this.recordPath(id)
      if (!existsSync(path)) return false
      unlinkSync(path)
      return true
    })
  }

  deleteIfRevision(id: string, expectedRevision: number): PersonalTaskDeleteResult {
    this.assertSafeId(id)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('Expected task revision must be a positive integer')
    return this.withRecordLock(id, () => {
      const current = this.readRecord(id)
      if (!current || current.revision !== expectedRevision) {
        return { status: 'conflict', current: current ? { task: current.task, revision: current.revision } : null }
      }
      unlinkSync(this.recordPath(id))
      return { status: 'removed' }
    })
  }

  /** {root}/personal-tasks-meta.json — projects/areas/headings/audit (fail-soft). */
  readMeta(): PersonalTaskMeta | null {
    const parsed = this.readJson(this.metaPath)
    if (!isPlainRecord(parsed)) return null
    const arr = (key: string) => (Array.isArray(parsed[key]) ? parsed[key] : [])
    return {
      projects: arr('projects') as PersonalTaskMeta['projects'],
      areas: arr('areas') as PersonalTaskMeta['areas'],
      headings: arr('headings') as PersonalTaskMeta['headings'],
      audit: arr('audit') as PersonalTaskMeta['audit'],
    }
  }

  writeMeta(meta: PersonalTaskMeta): void {
    this.writeJsonAtomic(this.metaPath, {
      projects: meta.projects ?? [],
      areas: meta.areas ?? [],
      headings: meta.headings ?? [],
      // Audit is append-only history; keep it bounded on disk.
      audit: (meta.audit ?? []).slice(-2000),
    })
  }

  /**
   * Things-style schema (v2) marker. Before the first run of a build that
   * writes v2 fields (checklist, trash, reminders, source…), copy every task
   * file plus meta/migration markers verbatim into
   * {root}/personal-tasks-backups/<stamp>-v1/. Idempotent; never deletes.
   * Returns the backup dir when one was made in this call.
   */
  ensureSchemaBackup(version = PERSONAL_TASK_SCHEMA_VERSION, now: number = Date.now()): string | null {
    const marker = this.readJson(this.schemaPath)
    if (isPlainRecord(marker) && typeof marker.version === 'number' && marker.version >= version) return null
    const root = join(this.dir, '..')
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const backupDir = join(root, 'personal-tasks-backups', `${stamp}-v${isPlainRecord(marker) && typeof marker.version === 'number' ? marker.version : 1}`)
    let copied = 0
    try {
      mkdirSync(join(backupDir, 'personal-tasks'), { recursive: true })
      if (existsSync(this.dir)) {
        for (const name of readdirSync(this.dir)) {
          if (!name.endsWith('.json')) continue
          copyFileSync(join(this.dir, name), join(backupDir, 'personal-tasks', name))
          copied += 1
        }
      }
      for (const path of [this.metaPath, this.migrationPath]) {
        if (existsSync(path)) copyFileSync(path, join(backupDir, basename(path)))
      }
    } catch {
      // A failed backup must not flip the marker: retry next launch.
      return null
    }
    this.writeJsonAtomic(this.schemaPath, { version, migratedAt: now, backupDir, copied })
    return backupDir
  }

  readMigration(): PersonalTaskMigrationMarker | null {
    const parsed = this.readJson(this.migrationPath)
    if (!isPlainRecord(parsed) || typeof parsed.migratedAt !== 'number') return null
    return parsed as unknown as PersonalTaskMigrationMarker
  }

  writeMigration(marker: PersonalTaskMigrationMarker): void {
    this.writeJsonAtomic(this.migrationPath, marker)
  }

  private get metaPath(): string {
    return join(this.dir, '..', 'personal-tasks-meta.json')
  }

  private get schemaPath(): string {
    return join(this.dir, '..', 'personal-tasks-schema.json')
  }

  private get migrationPath(): string {
    return join(this.dir, '..', 'personal-tasks-migration.json')
  }

  private readJson(path: string): unknown {
    try {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  }

  private writeJsonAtomic(path: string, value: unknown): void {
    mkdirSync(join(this.dir, '..'), { recursive: true })
    const tmp = `${path}.${Date.now()}-${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value)}\n`)
    renameSync(tmp, path)
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

  private assertSafeId(id: string): void {
    if (!TASK_ID_RE.test(id)) {
      throw new TypeError(`Invalid personal-task id (refused for path safety): ${JSON.stringify(id)}`)
    }
  }

  private putUnlocked(task: PersonalTask): PersistedPersonalTask {
    const existing = this.readRecord(task.id)
    if (existing && tasksEqual(existing.task, task)) return { task: existing.task, revision: existing.revision }
    const revision = (existing?.revision ?? 0) + 1
    this.writeRecord({ id: task.id, revision, task })
    return { task, revision }
  }

  private withRecordLock<T>(id: string, operation: () => T): T {
    mkdirSync(this.dir, { recursive: true })
    const lockPath = `${this.recordPath(id)}.lock`
    const deadline = Date.now() + 10_000
    const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    while (true) {
      let fd: number
      try {
        fd = openSync(lockPath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        this.removeDeadLock(lockPath)
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for personal-task writer lock: ${id}`)
        Atomics.wait(wait, 0, 0, 20)
        continue
      }
      try {
        writeSync(fd, String(process.pid))
        return operation()
      } finally {
        closeSync(fd)
        try { unlinkSync(lockPath) } catch { /* an owner may already have removed a stale lock */ }
      }
    }
  }

  private removeDeadLock(lockPath: string): void {
    let pid: number
    try {
      pid = Number(readFileSync(lockPath, 'utf8').trim())
    } catch {
      return
    }
    if (!Number.isSafeInteger(pid) || pid <= 0) return
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        try { unlinkSync(lockPath) } catch { /* another contender already removed it */ }
      }
    }
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
