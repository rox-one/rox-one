/**
 * EvidenceStore — JSONL of StoredEvidence rows (PRD §3.3), append-only.
 * Stored at {workspaceRoot}/memory/learning/evidence.jsonl.
 * `add` is idempotent by id: an existing row wins.
 */
import { join } from 'path'
import type { StoredEvidence } from './learning-types'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class EvidenceStore extends LearningStore<StoredEvidence> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'evidence.jsonl'))
  }

  add(evidence: StoredEvidence): StoredEvidence {
    const existing = this.get(evidence.id)
    if (existing) return existing
    return this.save(evidence)
  }

  addMany(items: StoredEvidence[]): StoredEvidence[] {
    return items.map((item) => this.add(item))
  }

  listByIds(ids: string[]): StoredEvidence[] {
    const wanted = new Set(ids)
    return this.list().filter((evidence) => wanted.has(evidence.id))
  }
}