/**
 * LearningAudit — append-only JSONL record of learning-layer actions.
 * Stored at {workspaceRoot}/memory/learning/learning-audit.jsonl.
 * Fail-soft: a failed append never throws (audits must not break the caller).
 */
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { learningDirFor } from './learning-types'

export interface LearningAuditEntry {
  ts: string
  actor: string
  action: string
  target: string
  detail?: string
}

export class LearningAudit {
  readonly filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = join(learningDirFor(workspaceRoot), 'learning-audit.jsonl')
  }

  /** Append one entry; never throws (fail-soft by design). */
  append(entry: LearningAuditEntry): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n')
    } catch {
      // audit is best-effort: a failed write must not break the learning flow
    }
  }
}