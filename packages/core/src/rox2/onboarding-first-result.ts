/**
 * First useful result after onboarding (ROX-AUD-151 / #340).
 *
 * Note → session → Outcome → Task. Local profile is not account auth.
 * Offline Notes/Tasks remain usable. Import failure does not block.
 */

export const FIRST_RESULT_SCHEMA_VERSION = 1

export const FIRST_RESULT_STEPS = [
  'note',
  'session',
  'outcome',
  'task',
  'complete',
] as const

export type FirstResultStep = (typeof FIRST_RESULT_STEPS)[number]

export type FirstResultCheckpoint = {
  schemaVersion: number
  step: FirstResultStep
  skipped: boolean
  localProfileName?: string
  accountAuthenticated: boolean
  noteId?: string
  sessionId?: string
  outcomeId?: string
  taskId?: string
  error?: string
}

export type FirstResultStore = {
  get(): FirstResultCheckpoint | null
  set(value: FirstResultCheckpoint): void
}

export function emptyFirstResult(): FirstResultCheckpoint {
  return {
    schemaVersion: FIRST_RESULT_SCHEMA_VERSION,
    step: 'note',
    skipped: false,
    accountAuthenticated: false,
  }
}

export function parseFirstResultCheckpoint(raw: unknown): FirstResultCheckpoint {
  if (!raw || typeof raw !== 'object') return emptyFirstResult()
  const record = raw as Record<string, unknown>
  if (record.schemaVersion !== FIRST_RESULT_SCHEMA_VERSION) {
    return emptyFirstResult()
  }
  const step = FIRST_RESULT_STEPS.includes(record.step as FirstResultStep)
    ? (record.step as FirstResultStep)
    : 'note'
  return {
    schemaVersion: FIRST_RESULT_SCHEMA_VERSION,
    step,
    skipped: record.skipped === true,
    localProfileName: typeof record.localProfileName === 'string' ? record.localProfileName : undefined,
    accountAuthenticated: record.accountAuthenticated === true,
    noteId: typeof record.noteId === 'string' ? record.noteId : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    outcomeId: typeof record.outcomeId === 'string' ? record.outcomeId : undefined,
    taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

/** A saved local display name is never treated as a successful registration. */
export function isAccountRegistered(checkpoint: FirstResultCheckpoint): boolean {
  return checkpoint.accountAuthenticated === true
}

export function skipFirstResult(checkpoint: FirstResultCheckpoint): FirstResultCheckpoint {
  return { ...checkpoint, skipped: true, step: 'complete', error: undefined }
}

export function advanceFirstResult(
  checkpoint: FirstResultCheckpoint,
  created: { noteId?: string; sessionId?: string; outcomeId?: string; taskId?: string },
): FirstResultCheckpoint {
  const next: FirstResultCheckpoint = { ...checkpoint, ...created, error: undefined }
  if (!next.noteId) return { ...next, step: 'note' }
  if (!next.sessionId) return { ...next, step: 'session' }
  if (!next.outcomeId) return { ...next, step: 'outcome' }
  if (!next.taskId) return { ...next, step: 'task' }
  return { ...next, step: 'complete' }
}

export function resumeFirstResult(store: FirstResultStore): FirstResultCheckpoint {
  const current = store.get()
  if (!current) {
    const fresh = emptyFirstResult()
    store.set(fresh)
    return fresh
  }
  return parseFirstResultCheckpoint(current)
}

export function recordFirstResultError(checkpoint: FirstResultCheckpoint, error: string): FirstResultCheckpoint {
  return { ...checkpoint, error }
}

export type SeededFirstResult = {
  noteId: string
  sessionId: string
  outcomeId: string
  taskId: string
}

export function seedOfflineFirstResult(now = Date.now()): SeededFirstResult {
  const stamp = now.toString(16)
  return {
    noteId: `welcome-${stamp}`,
    sessionId: `session-${stamp}`,
    outcomeId: `outcome-${stamp}`,
    taskId: `task-${stamp}`,
  }
}
