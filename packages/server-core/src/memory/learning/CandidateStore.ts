/**
 * CandidateStore — JSONL of LearningCandidate rows (PRD §3.2/§34).
 * Stored at {workspaceRoot}/memory/learning/candidates.jsonl.
 */
import { join } from 'path'
import type { LearningCandidate, LearningCandidateStatus } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class CandidateStore extends LearningStore<LearningCandidate> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'candidates.jsonl'))
  }

  getByFingerprint(fingerprint: string): LearningCandidate | null {
    return this.list().find((candidate) => candidate.fingerprint === fingerprint) ?? null
  }

  listByStatus(status: LearningCandidateStatus): LearningCandidate[] {
    return this.list().filter((candidate) => candidate.status === status)
  }

  listActive(): LearningCandidate[] {
    return this.listByStatus('active')
  }
}