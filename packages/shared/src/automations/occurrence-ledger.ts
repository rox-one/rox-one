import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from '../utils/sqlite-runtime.ts'

export type AutomationOccurrenceState = 'claimed' | 'succeeded' | 'failed' | 'unknown_external_outcome'
export type AutomationOccurrenceOutcome = Exclude<AutomationOccurrenceState, 'claimed'>

export interface AutomationOccurrenceContext {
  workspaceId: string
  matcherId: string
  matcherRevision: string
  scheduledAt: string
  scheduledTimezone?: string
  actionIndex: number
  targetSessionId?: string
}

export interface AutomationOccurrenceClaim {
  claimed: boolean
  runId: string
  state: AutomationOccurrenceState
}

const DATABASE_FILE = 'automations-occurrences.sqlite'

function canonicalContext(context: AutomationOccurrenceContext): string {
  if (!context || typeof context !== 'object') throw new Error('occurrence context is required')
  for (const [name, value] of Object.entries({
    workspaceId: context.workspaceId,
    matcherId: context.matcherId,
    matcherRevision: context.matcherRevision,
  })) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error(`${name} is invalid`)
  }
  if (typeof context.scheduledAt !== 'string' || !Number.isFinite(Date.parse(context.scheduledAt))) {
    throw new Error('scheduledAt must be a valid UTC instant')
  }
  if (!context.scheduledAt.endsWith('Z')) throw new Error('scheduledAt must be a UTC instant')
  if (!Number.isSafeInteger(context.actionIndex) || context.actionIndex < 0) throw new Error('actionIndex is invalid')
  if (context.scheduledTimezone !== undefined && (typeof context.scheduledTimezone !== 'string' || context.scheduledTimezone.length > 128)) {
    throw new Error('scheduledTimezone is invalid')
  }
  if (context.targetSessionId !== undefined && (typeof context.targetSessionId !== 'string' || context.targetSessionId.length === 0 || context.targetSessionId.length > 256)) {
    throw new Error('targetSessionId is invalid')
  }
  return JSON.stringify({
    workspaceId: context.workspaceId,
    matcherId: context.matcherId,
    matcherRevision: context.matcherRevision,
    scheduledAt: new Date(context.scheduledAt).toISOString(),
    ...(context.scheduledTimezone === undefined ? {} : { scheduledTimezone: context.scheduledTimezone }),
    actionIndex: context.actionIndex,
    ...(context.targetSessionId === undefined ? {} : { targetSessionId: context.targetSessionId }),
  })
}

function openLedger(workspaceRootPath: string): DatabaseSync {
  if (!workspaceRootPath) throw new Error('workspaceRootPath is required')
  const root = resolve(workspaceRootPath)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const databasePath = join(root, DATABASE_FILE)
  try {
    const descriptor = openSync(databasePath, 'wx', 0o600)
    closeSync(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = lstatSync(databasePath)
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1 || (uid !== undefined && existing.uid !== uid)) {
      throw new Error('automation occurrence database must be a private regular file')
    }
  }
  chmodSync(databasePath, 0o600)
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS automation_occurrences (
      workspace_id TEXT NOT NULL,
      occurrence_key TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL UNIQUE,
      context_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('claimed','succeeded','failed','unknown_external_outcome')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(workspace_id, occurrence_key)
    );
  `)
  return db
}

function withTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Atomically claim a scheduled action before dispatch; duplicate claims reuse its durable runId. */
export function claimAutomationOccurrence(
  workspaceRootPath: string,
  occurrenceKey: string,
  context: AutomationOccurrenceContext,
  now = Date.now(),
): AutomationOccurrenceClaim {
  if (typeof occurrenceKey !== 'string' || occurrenceKey.length === 0 || occurrenceKey.length > 512) {
    throw new Error('occurrenceKey is invalid')
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('claim time is invalid')
  const contextJson = canonicalContext(context)
  const db = openLedger(workspaceRootPath)
  try {
    return withTransaction(db, () => {
      const runId = randomUUID()
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO automation_occurrences
          (workspace_id, occurrence_key, run_id, context_json, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'claimed', ?, ?)
      `).run(context.workspaceId, occurrenceKey, runId, contextJson, now, now)
      const row = db.prepare(`
        SELECT run_id, context_json, state FROM automation_occurrences
        WHERE workspace_id=? AND occurrence_key=?
      `).get(context.workspaceId, occurrenceKey) as { run_id: string; context_json: string; state: AutomationOccurrenceState } | undefined
      if (!row) throw new Error('automation occurrence claim was not persisted')
      if (row.context_json !== contextJson) throw new Error('occurrence key was reused with different automation context')
      return { claimed: Number(inserted.changes) === 1, runId: row.run_id, state: row.state }
    })
  } finally {
    db.close()
  }
}

/** Mark a claim terminal after dispatch; the same terminal transition is idempotent. */
export function setAutomationOccurrenceOutcome(
  workspaceRootPath: string,
  occurrenceKey: string,
  runId: string,
  outcome: AutomationOccurrenceOutcome,
  now = Date.now(),
): void {
  if (!occurrenceKey || !runId) throw new Error('occurrenceKey and runId are required')
  if (!['succeeded', 'failed', 'unknown_external_outcome'].includes(outcome)) throw new Error('invalid occurrence outcome')
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('outcome time is invalid')
  const db = openLedger(workspaceRootPath)
  try {
    withTransaction(db, () => {
      const row = db.prepare(`
        SELECT run_id, state FROM automation_occurrences WHERE occurrence_key=?
      `).get(occurrenceKey) as { run_id: string; state: AutomationOccurrenceState } | undefined
      if (!row || row.run_id !== runId) throw new Error('automation occurrence claim not found')
      if (row.state === outcome) return
      if (row.state !== 'claimed') throw new Error(`cannot change terminal occurrence outcome from ${row.state} to ${outcome}`)
      db.prepare(`
        UPDATE automation_occurrences SET state=?, updated_at=?
        WHERE occurrence_key=? AND run_id=? AND state='claimed'
      `).run(outcome, now, occurrenceKey, runId)
    })
  } finally {
    db.close()
  }
}

/** Fail closed after restart: claimed effects become ambiguous, never eligible for automatic redispatch. */
export function recoverAutomationOccurrences(workspaceRootPath: string, now = Date.now()): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('recovery time is invalid')
  const db = openLedger(workspaceRootPath)
  try {
    return withTransaction(db, () => Number(db.prepare(`
      UPDATE automation_occurrences SET state='unknown_external_outcome', updated_at=?
      WHERE state='claimed'
    `).run(now).changes))
  } finally {
    db.close()
  }
}
