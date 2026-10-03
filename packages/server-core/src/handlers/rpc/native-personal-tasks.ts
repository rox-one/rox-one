import { createHash } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { PersonalTask, PersonalTaskDeleteResult, PersonalTaskMeta, PersonalTaskPutResult, PersonalTasksMigrateInput, PersonalTasksMigrateResult, PersonalTasksSnapshot, VersionedPersonalTask } from '@rox/core/tasks/personal'
import { CodedError } from '@rox/shared/protocol'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import type { NativePrincipal } from '../../authority/native-authority'

export interface NativePersonalTaskScope {
  principal: NativePrincipal
  workspaceId: string
  rootPath: string
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 10000): value is string => typeof value === 'string' && value.length <= limit
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const list = (value: unknown, limit: number, valid: (value: unknown) => boolean): boolean => Array.isArray(value) && value.length <= limit && value.every(valid)
const link = (value: unknown): boolean => record(value) && ['note', 'session', 'message', 'workflowRun', 'meeting', 'feed', 'mail', 'decision'].includes(String(value.kind))
  && text(value.id, 2048) && !!value.id && (value.label === undefined || text(value.label))
  && Object.keys(value).every(key => ['kind', 'id', 'label'].includes(key))

const taskKeys = new Set(['id', 'title', 'notes', 'list', 'projectId', 'areaId', 'headingId', 'parentId', 'tags', 'priority', 'dueAt', 'startAt', 'evening', 'recurrence', 'links', 'order', 'createdAt', 'completedAt', 'cancelledAt', 'checklist', 'reminderAt', 'reminderTimeZone', 'reminderDeliveredFor', 'reminderRetryAt', 'reminderError', 'trashedAt', 'source', 'repeatOf', 'repeatOccurrenceAt', 'repeatNextId', 'updatedAt'])
function validTask(value: unknown): value is PersonalTask {
  if (!record(value) || !Object.keys(value).every(key => taskKeys.has(key)) || !id(value.id) || !text(value.title) || !value.title.trim()
    || !text(value.notes, 65536) || !['inbox', 'today', 'upcoming', 'anytime', 'someday'].includes(String(value.list))
    || !list(value.tags, 200, item => text(item, 200)) || !['none', 'low', 'medium', 'high'].includes(String(value.priority))
    || typeof value.evening !== 'boolean' || !list(value.links, 200, link) || !number(value.order) || !number(value.createdAt)) return false
  for (const key of ['projectId', 'areaId', 'headingId', 'parentId', 'repeatOf', 'repeatNextId']) if (value[key] !== undefined && !id(value[key])) return false
  for (const key of ['dueAt', 'startAt', 'completedAt', 'cancelledAt', 'reminderAt', 'reminderDeliveredFor', 'reminderRetryAt', 'trashedAt', 'repeatOccurrenceAt', 'updatedAt']) if (value[key] !== undefined && (!number(value[key]) || value[key] < 0)) return false
  if (value.checklist !== undefined && !list(value.checklist, 500, item => record(item) && id(item.id) && text(item.title) && typeof item.done === 'boolean' && Object.keys(item).every(key => ['id', 'title', 'done'].includes(key)))) return false
  if (value.source !== undefined && !link(value.source)) return false
  if (value.reminderTimeZone !== undefined && !text(value.reminderTimeZone, 200)) return false
  if (value.reminderError !== undefined && !['permission-denied', 'permission-required', 'presentation-failed'].includes(String(value.reminderError))) return false
  if (value.recurrence !== undefined) {
    const r = value.recurrence
    if (!record(r) || !['daily', 'weekly', 'monthly', 'yearly'].includes(String(r.rule)) || !revision(r.interval)
      || r.interval > 10000 || r.mode !== undefined && !['fixed', 'after'].includes(String(r.mode))
      || r.weekdays !== undefined && !list(r.weekdays, 7, day => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)
      || r.until !== undefined && (!number(r.until) || r.until < 0) || r.timeZone !== undefined && !text(r.timeZone, 200)
      || !Object.keys(r).every(key => ['rule', 'interval', 'weekdays', 'mode', 'until', 'timeZone'].includes(key))) return false
  }
  return true
}

function validMeta(value: unknown): value is PersonalTaskMeta {
  if (!record(value) || !Object.keys(value).every(key => ['projects', 'areas', 'headings', 'audit'].includes(key))) return false
  const entity = (kind: 'projects' | 'areas' | 'headings', value: unknown): boolean => {
    if (!record(value) || !id(value.id) || !number(value.order)) return false
    const keys = kind === 'projects' ? ['id', 'name', 'areaId', 'order', 'notes', 'deadlineAt', 'completedAt', 'trashedAt', 'createdAt']
      : kind === 'areas' ? ['id', 'name', 'order', 'collapsed', 'trashedAt'] : ['id', 'title', 'projectId', 'order']
    if (!Object.keys(value).every(key => keys.includes(key)) || !text(kind === 'headings' ? value.title : value.name)) return false
    if (kind === 'headings' && !id(value.projectId)) return false
    if (value.areaId !== undefined && !id(value.areaId) || value.notes !== undefined && !text(value.notes, 65536)
      || value.collapsed !== undefined && typeof value.collapsed !== 'boolean') return false
    return ['deadlineAt', 'completedAt', 'trashedAt', 'createdAt'].every(key => value[key] === undefined || number(value[key]) && value[key] >= 0)
  }
  return ['projects', 'areas', 'headings'].every(kind => list(value[kind], 2000, item => entity(kind as 'projects' | 'areas' | 'headings', item)))
    && list(value.audit, 2000, item => record(item) && number(item.at) && text(item.action, 200)
      && (item.taskId === undefined || id(item.taskId)) && (item.detail === undefined || text(item.detail))
      && Object.keys(item).every(key => ['at', 'action', 'taskId', 'detail'].includes(key)))
}

function invalid(): never { throw new CodedError('INVALID_PAYLOAD', 'Personal task payload is invalid') }
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
function privatePath(path: string, directory: boolean): boolean {
  try {
    const entry = lstatSync(path)
    if (entry.isSymbolicLink() || (entry.mode & 0o077) !== 0 || (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
      || typeof process.getuid === 'function' && entry.uid !== process.getuid()) throw new CodedError('FORBIDDEN', 'Personal task custody is unsafe')
    return true
  } catch (error) { if (absent(error)) return false; throw error }
}

/** Native custody is separate from the desktop profile. Opening/listing an empty store performs no filesystem writes. */
export class NativePersonalTasksStore {
  readonly directory: string
  readonly path: string
  constructor(private readonly stateDirectory: string) {
    this.directory = join(realpathSync(stateDirectory), 'native-personal-tasks')
    this.path = join(this.directory, 'tasks.sqlite')
  }

  private key(scope: NativePersonalTaskScope): string {
    return createHash('sha256').update(JSON.stringify(['native-personal-tasks-v1', scope.principal.issuer, scope.principal.subject, scope.workspaceId, scope.rootPath])).digest('hex')
  }

  private open(write: boolean): DatabaseSync | null {
    privatePath(this.stateDirectory, true)
    const exists = privatePath(this.directory, true)
    if (!write && !exists) return null
    if (write && !exists) mkdirSync(this.directory, { mode: 0o700 })
    privatePath(this.directory, true)
    for (const suffix of ['-journal', '-wal', '-shm']) privatePath(this.path + suffix, false)
    if (!write && !privatePath(this.path, false)) return null
    if (write) {
      chmodSync(this.directory, 0o700)
      try { closeSync(openSync(this.path, 'wx', 0o600)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      privatePath(this.path, false)
      chmodSync(this.path, 0o600)
    }
    const db = new DatabaseSync(this.path, { readOnly: !write })
    if (write) db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(scope TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,task TEXT,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS metadata(scope TEXT PRIMARY KEY,meta TEXT,migration TEXT)`)
    return db
  }

  private snapshot(db: DatabaseSync | null, key: string): PersonalTasksSnapshot {
    if (!db) return { tasks: [], revisions: {}, meta: null, migration: null }
    const rows = db.prepare('SELECT id,revision,task FROM tasks WHERE scope=? AND task IS NOT NULL ORDER BY id').all(key)
    const records = rows.map(row => this.parseRecord(row))
    const metadata = db.prepare('SELECT meta,migration FROM metadata WHERE scope=?').get(key)
    const meta: unknown = metadata?.meta == null ? null : JSON.parse(String(metadata.meta))
    if (meta !== null && !validMeta(meta)) throw new Error('Personal task metadata is invalid')
    const migration = metadata?.migration == null ? null : JSON.parse(String(metadata.migration)) as PersonalTasksSnapshot['migration']
    return { tasks: records.map(row => row.task), revisions: Object.fromEntries(records.map(row => [row.task.id, row.revision])), meta, migration }
  }

  private parseRecord(row: Record<string, unknown>): VersionedPersonalTask {
    const task: unknown = JSON.parse(String(row.task))
    if (!validTask(task) || task.id !== row.id || !revision(row.revision)) throw new Error('Personal task record is invalid')
    return { task, revision: row.revision }
  }

  read(scope: NativePersonalTaskScope, assertCurrent: () => void): PersonalTasksSnapshot {
    assertCurrent()
    const db = this.open(false)
    try { const snapshot = this.snapshot(db, this.key(scope)); assertCurrent(); return snapshot }
    finally { db?.close() }
  }

  private mutate<T>(scope: NativePersonalTaskScope, assertCurrent: () => void, operation: (db: DatabaseSync, key: string) => T): T {
    assertCurrent()
    const db = this.open(true)!
    try {
      db.exec('BEGIN IMMEDIATE')
      try { assertCurrent(); const result = operation(db, this.key(scope)); assertCurrent(); db.exec('COMMIT'); return result }
      catch (error) { db.exec('ROLLBACK'); throw error }
    } finally { db.close() }
  }

  put(scope: NativePersonalTaskScope, writes: unknown, meta: unknown, assertCurrent: () => void): PersonalTaskPutResult {
    if (!Array.isArray(writes) || writes.length > 500 || meta != null && !validMeta(meta) || JSON.stringify([writes, meta]).length > 4 * 1024 * 1024) invalid()
    return this.mutate(scope, assertCurrent, (db, key) => {
      const result: PersonalTaskPutResult = { accepted: [], conflicts: [], rejected: [] }
      for (const write of writes) {
        if (!record(write) || !validTask(write.task) || write.expectedRevision !== null && !revision(write.expectedRevision)) { result.rejected.push(record(write) && record(write.task) && text(write.task.id, 160) ? write.task.id : 'invalid'); continue }
        const row = db.prepare('SELECT id,revision,task FROM tasks WHERE scope=? AND id=?').get(key, write.task.id)
        const current = row?.task == null ? null : this.parseRecord(row)
        if ((current?.revision ?? null) !== write.expectedRevision) { result.conflicts.push({ id: write.task.id, current }); continue }
        const unchanged = current && JSON.stringify(current.task) === JSON.stringify(write.task)
        const next = { task: write.task, revision: unchanged ? current.revision : Number(row?.revision ?? 0) + 1 }
        if (!revision(next.revision)) throw new Error('Personal task revision is invalid')
        db.prepare('INSERT INTO tasks(scope,id,revision,task) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,task=excluded.task').run(key, next.task.id, next.revision, JSON.stringify(next.task))
        result.accepted.push(next)
      }
      if (meta != null) db.prepare('INSERT INTO metadata(scope,meta) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET meta=excluded.meta').run(key, JSON.stringify(meta))
      return result
    })
  }

  delete(scope: NativePersonalTaskScope, deletes: unknown, assertCurrent: () => void): PersonalTaskDeleteResult {
    if (!Array.isArray(deletes) || deletes.length > 500) invalid()
    return this.mutate(scope, assertCurrent, (db, key) => {
      const result: PersonalTaskDeleteResult = { removed: [], conflicts: [], rejected: [] }
      for (const item of deletes) {
        if (!record(item) || !id(item.id) || !revision(item.expectedRevision)) { result.rejected.push(record(item) && text(item.id, 160) ? item.id : 'invalid'); continue }
        const row = db.prepare('SELECT id,revision,task FROM tasks WHERE scope=? AND id=?').get(key, item.id)
        const current = row?.task == null ? null : this.parseRecord(row)
        if (!current || current.revision !== item.expectedRevision) { result.conflicts.push({ id: item.id, current }); continue }
        // Keep the monotonic revision after deletion so a recreated ID cannot accept an old update.
        db.prepare('UPDATE tasks SET task=NULL WHERE scope=? AND id=?').run(key, item.id)
        result.removed.push(item.id)
      }
      return result
    })
  }

  migrate(scope: NativePersonalTaskScope, input: unknown, assertCurrent: () => void): PersonalTasksMigrateResult {
    if (!record(input) || input.bundle !== null && (!record(input.bundle) || input.bundle.version !== 1 || !list(input.bundle.tasks, 10000, validTask)
      || !validMeta({ projects: input.bundle.projects, areas: input.bundle.areas, headings: input.bundle.headings, audit: input.bundle.audit }))
      || input.quarantined !== undefined && typeof input.quarantined !== 'boolean' || JSON.stringify(input).length > 4 * 1024 * 1024) invalid()
    return this.mutate(scope, assertCurrent, (db, key) => {
      const previous = this.snapshot(db, key)
      if (previous.migration) return { ...previous, status: 'already-migrated', imported: 0, skipped: 0 }
      const source = (input as unknown as PersonalTasksMigrateInput).bundle
      let imported = 0, skipped = 0
      for (const task of source?.tasks ?? []) {
        if (db.prepare('SELECT 1 FROM tasks WHERE scope=? AND id=?').get(key, task.id)) { skipped++; continue }
        db.prepare('INSERT INTO tasks(scope,id,revision,task) VALUES(?,?,1,?)').run(key, task.id, JSON.stringify(task)); imported++
      }
      const meta = previous.meta ?? (source ? { projects: source.projects, areas: source.areas, headings: source.headings, audit: source.audit.slice(-2000) } : null)
      const migration = { migratedAt: Date.now(), imported, skipped, source: 'localStorage', ...(input.quarantined ? { quarantined: true } : {}) }
      db.prepare('INSERT INTO metadata(scope,meta,migration) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET meta=excluded.meta,migration=excluded.migration').run(key, meta ? JSON.stringify(meta) : null, JSON.stringify(migration))
      return { ...this.snapshot(db, key), status: 'migrated', imported, skipped }
    })
  }
}
