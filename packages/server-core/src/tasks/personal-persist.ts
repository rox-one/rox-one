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
 *
 * W1-06 (#1503) — schema v3 (WorkItem, DATA-MODEL §5.1): the file becomes
 * `{id, revision, schemaVersion: 3, task, work}`. `task` stays the v2
 * PersonalTask the Tasks UI reads and writes (get/list/put are unchanged);
 * `work` holds the v3-only WorkItem fields (derived ones are recomputed from
 * `task` on every write, v3-only ones survive UI writes). v2 files are read
 * as before (backward compatible) and upgraded in place by MIG-01 without a
 * revision bump; meta gains a derived `work` block (MIG-02).
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'fs'
import { basename, join } from 'path'
import type { PersonalTask, PersonalTaskMeta, PersonalTaskMigrationMarker, PersonalTaskWorkMeta, PersonalTaskWrite, TaskStatusDefinition, WorkItem, WorkItemExtension } from '@rox/core/tasks/personal'
import { LOCAL_PRINCIPAL_ID, PERSONAL_TASK_SCHEMA_VERSION_V3, deriveWorkItemExtension, deriveWorkMeta, fromWorkItem, toWorkItem } from '@rox/core/tasks/personal'

const TASK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/**
 * v2 = Things-style fields (checklist, trashedAt, reminderAt, source, repeat modes).
 * v3 = WorkItem (`work` half beside the v2 task; W1-06 #1503).
 */
export const PERSONAL_TASK_SCHEMA_VERSION = PERSONAL_TASK_SCHEMA_VERSION_V3

export type { PersonalTaskMeta, PersonalTaskMigrationMarker } from '@rox/core/tasks/personal'

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

export interface PersistedWorkItem {
  item: WorkItem
  revision: number
}

export type WorkItemWriteResult =
  | { status: 'accepted'; record: PersistedWorkItem }
  | { status: 'conflict'; current: PersistedWorkItem | null }

export interface PersonalTaskPersistStoreOptions {
  /** Owner written into v3 records created from v2 data (default: the local principal). */
  ownerPrincipalId?: string
}

interface PersistFile {
  id: string
  revision: number
  task: PersonalTask
  /** 3 once the `work` half has been written (absent on v2 files). */
  schemaVersion?: number
  work?: WorkItemExtension
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

function isWorkItemExtension(value: unknown): value is WorkItemExtension {
  if (!isPlainRecord(value)) return false
  if (typeof value.statusKey !== 'string' || value.statusKey.length === 0) return false
  if (typeof value.ownerPrincipalId !== 'string' || value.ownerPrincipalId.length === 0) return false
  if (value.authority !== 'local' && value.authority !== 'workspace') return false
  if (!Array.isArray(value.assigneeIds) || !value.assigneeIds.every((id) => typeof id === 'string')) return false
  return true
}

export function parsePersonalTaskPersistFile(content: string): PersistFile | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isPlainRecord(parsed)) return null
    if (typeof parsed.id !== 'string' || !TASK_ID_RE.test(parsed.id)) return null
    if (typeof parsed.revision !== 'number' || !Number.isInteger(parsed.revision) || parsed.revision < 1) return null
    if (!isPersonalTask(parsed.task) || parsed.task.id !== parsed.id) return null
    const file: PersistFile = { id: parsed.id, revision: parsed.revision, task: parsed.task }
    // A malformed `work` half is ignored (re-derived), never a reason to drop the task.
    if (typeof parsed.schemaVersion === 'number' && isWorkItemExtension(parsed.work)) {
      file.schemaVersion = parsed.schemaVersion
      file.work = parsed.work
    }
    return file
  } catch {
    return null
  }
}

function tasksEqual(a: PersonalTask, b: PersonalTask): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function workEqual(a: WorkItemExtension | undefined, b: WorkItemExtension | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export interface PersonalTaskV3MigrationReport {
  id: 'MIG-01' | 'MIG-02'
  dryRun: boolean
  at: number
  scanned: number
  upgraded: number
  alreadyCurrent: number
  failed: string[]
}

export class PersonalTaskPersistStore {
  /** {root}/personal-tasks — personal (config-dir) scope, not the DAG `tasks/` tree. */
  readonly dir: string

  readonly ownerPrincipalId: string

  constructor(rootDir: string, options: PersonalTaskPersistStoreOptions = {}) {
    this.dir = join(rootDir, 'personal-tasks')
    this.ownerPrincipalId = options.ownerPrincipalId ?? LOCAL_PRINCIPAL_ID
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

  /** v3 view of one task (WorkItem; v2 files answer through read aliases). */
  getWorkItem(id: string): PersistedWorkItem | null {
    const record = this.readRecord(id)
    if (!record) return null
    return { item: this.toItem(record), revision: record.revision }
  }

  listWorkItems(): PersistedWorkItem[] {
    return this.readAll().map((record) => ({ item: this.toItem(record), revision: record.revision }))
  }

  /**
   * Command-path write (reference handlers): the full WorkItem, CAS on the
   * file revision (`null` = create-only). Any change bumps the revision.
   */
  putWorkItem(item: WorkItem, expectedRevision: number | null): WorkItemWriteResult {
    this.assertSafeId(item.id)
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      throw new TypeError('Expected task revision must be null or a positive integer')
    }
    return this.withRecordLock(item.id, () => {
      const current = this.readRecord(item.id)
      if ((current?.revision ?? null) !== expectedRevision) {
        return { status: 'conflict', current: current ? { item: this.toItem(current), revision: current.revision } : null }
      }
      const { task, work } = fromWorkItem(item, current?.task ?? null)
      if (current && tasksEqual(current.task, task) && workEqual(current.work, work)) {
        return { status: 'accepted', record: { item: this.toItem(current), revision: current.revision } }
      }
      const revision = (current?.revision ?? 0) + 1
      const file: PersistFile = { id: task.id, revision, schemaVersion: PERSONAL_TASK_SCHEMA_VERSION_V3, task, work }
      this.writeRecord(file)
      return { status: 'accepted', record: { item: this.toItem(file), revision } }
    })
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
    const previous = this.readJson(this.metaPath)
    const statusSets = isPlainRecord(previous) && isPlainRecord(previous.work) && isPlainRecord(previous.work.statusSets)
      ? previous.work.statusSets as Record<string, TaskStatusDefinition[]>
      : undefined
    this.writeJsonAtomic(this.metaPath, {
      projects: meta.projects ?? [],
      areas: meta.areas ?? [],
      headings: meta.headings ?? [],
      // Audit is append-only history; keep it bounded on disk.
      audit: (meta.audit ?? []).slice(-2000),
      // MIG-02: v3 lists / sections / groups, derived from the v2 arrays (same ids).
      work: deriveWorkMeta(meta, this.ownerPrincipalId, statusSets),
    })
  }

  /** v3 meta view (MIG-02): task lists, sections and list groups; derived when the file predates v3. */
  readWorkMeta(): PersonalTaskWorkMeta {
    const parsed = this.readJson(this.metaPath)
    const meta = this.readMeta()
    const statusSets = isPlainRecord(parsed) && isPlainRecord(parsed.work) && isPlainRecord(parsed.work.statusSets)
      ? parsed.work.statusSets as Record<string, TaskStatusDefinition[]>
      : undefined
    return deriveWorkMeta(meta ?? {}, this.ownerPrincipalId, statusSets)
  }

  /**
   * MIG-01 (task files) + MIG-02 (meta): write the v3 `work` half in place.
   * Idempotent (v3 files are skipped), never bumps a revision, never deletes;
   * run after `ensureSchemaBackup(3)`. `dryRun` only counts.
   */
  migrateToV3(options: { dryRun?: boolean; now?: number } = {}): PersonalTaskV3MigrationReport[] {
    const now = options.now ?? Date.now()
    const dryRun = options.dryRun === true
    const tasks: PersonalTaskV3MigrationReport = { id: 'MIG-01', dryRun, at: now, scanned: 0, upgraded: 0, alreadyCurrent: 0, failed: [] }
    let names: string[] = []
    try { names = readdirSync(this.dir).filter((name) => name.endsWith('.json')).sort() } catch { names = [] }
    for (const name of names) {
      const id = name.slice(0, -'.json'.length)
      if (!TASK_ID_RE.test(id)) continue
      tasks.scanned += 1
      try {
        const upgraded = this.withRecordLock(id, () => {
          const record = this.readRecord(id)
          if (!record) return null
          if (record.schemaVersion === PERSONAL_TASK_SCHEMA_VERSION_V3 && record.work) return false
          if (!dryRun) {
            this.writeRecord({ ...record, schemaVersion: PERSONAL_TASK_SCHEMA_VERSION_V3, work: deriveWorkItemExtension(record.task, record.work, { ownerPrincipalId: this.ownerPrincipalId }) })
          }
          return true
        })
        if (upgraded === null) tasks.failed.push(id)
        else if (upgraded) tasks.upgraded += 1
        else tasks.alreadyCurrent += 1
      } catch {
        tasks.failed.push(id)
      }
    }
    const meta: PersonalTaskV3MigrationReport = { id: 'MIG-02', dryRun, at: now, scanned: 0, upgraded: 0, alreadyCurrent: 0, failed: [] }
    const rawMeta = this.readJson(this.metaPath)
    if (isPlainRecord(rawMeta)) {
      meta.scanned = 1
      const current = isPlainRecord(rawMeta.work) && rawMeta.work.schemaVersion === PERSONAL_TASK_SCHEMA_VERSION_V3
      if (current) meta.alreadyCurrent = 1
      else {
        meta.upgraded = 1
        if (!dryRun) {
          const parsed = this.readMeta()
          if (parsed) this.writeMeta(parsed)
        }
      }
    }
    if (!dryRun) {
      this.writeMigrationReport(tasks)
      this.writeMigrationReport(meta)
    }
    return [tasks, meta]
  }

  /** Whether a non-dry MIG-01 + MIG-02 run already completed without failures (skips the startup scan). */
  isMigratedToV3(): boolean {
    const done = (id: string) => {
      const report = this.readJson(this.migrationReportPath(id))
      return isPlainRecord(report) && report.dryRun === false && Array.isArray(report.failed) && report.failed.length === 0
    }
    return done('MIG-01') && done('MIG-02')
  }

  /** `{root}/.craft/migrations/<id>.json` (DATA-MODEL §6.2 report location, root = config dir). */
  migrationReportPath(id: string): string {
    return join(this.dir, '..', '.craft', 'migrations', `${id}.json`)
  }

  private writeMigrationReport(report: PersonalTaskV3MigrationReport): void {
    const path = this.migrationReportPath(report.id)
    mkdirSync(join(path, '..'), { recursive: true })
    const tmp = `${path}.${Date.now()}-${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(report)}\n`)
    renameSync(tmp, path)
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

  /** Whether the schema marker (written after a successful backup) is at `version` or newer. */
  hasSchemaBackup(version = PERSONAL_TASK_SCHEMA_VERSION): boolean {
    const marker = this.readJson(this.schemaPath)
    return isPlainRecord(marker) && typeof marker.version === 'number' && marker.version >= version
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

  private toItem(record: PersistFile): WorkItem {
    return toWorkItem(record.task, record.revision, record.work ?? null, { ownerPrincipalId: this.ownerPrincipalId })
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
    // v2 (UI) write: derived v3 fields follow `task`; v3-only fields survive.
    const work = deriveWorkItemExtension(task, existing?.work, { ownerPrincipalId: this.ownerPrincipalId })
    if (existing && tasksEqual(existing.task, task)) {
      // Same task payload: never bump the revision. A v2 file is upgraded in place (MIG-01 semantics).
      if (existing.schemaVersion !== PERSONAL_TASK_SCHEMA_VERSION_V3 || !workEqual(existing.work, work)) {
        this.writeRecord({ ...existing, schemaVersion: PERSONAL_TASK_SCHEMA_VERSION_V3, work })
      }
      return { task: existing.task, revision: existing.revision }
    }
    const revision = (existing?.revision ?? 0) + 1
    this.writeRecord({ id: task.id, revision, schemaVersion: PERSONAL_TASK_SCHEMA_VERSION_V3, task, work })
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
