/**
 * OutcomeStore — JSONL of TaskOutcome rows (PRD §3.5/§19).
 * Stored at {workspaceRoot}/memory/learning/outcomes.jsonl.
 */
import { join } from 'path'
import type { TaskOutcome } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class OutcomeStore extends LearningStore<TaskOutcome> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'outcomes.jsonl'))
  }

  append(outcome: TaskOutcome): TaskOutcome {
    return this.save(outcome)
  }

  /** Oldest first (file order); `limit` returns the most recent N. */
  list(limit?: number): TaskOutcome[] {
    const items = this.readAll()
    if (limit === undefined || limit >= items.length) return items
    return items.slice(items.length - limit)
  }

  listBySession(sessionId: string): TaskOutcome[] {
    return this.readAll().filter((outcome) => outcome.sessionId === sessionId)
  }

  listByFingerprint(fingerprint: string): TaskOutcome[] {
    return this.readAll().filter((outcome) => outcome.taskFingerprint === fingerprint)
  }
}