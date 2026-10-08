/**
 * MutationStore — JSONL of LearningMutation rows (PRD §3.6/§40).
 * Stored at {workspaceRoot}/memory/learning/mutations.jsonl.
 * Every durable change stays reversible until confirmed; reverted rows keep
 * their revert timestamp and reason.
 */
import { join } from 'path'
import type { LearningMutation } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class MutationStore extends LearningStore<LearningMutation> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'mutations.jsonl'))
  }

  listByCandidate(candidateId: string): LearningMutation[] {
    return this.list().filter((mutation) => mutation.candidateId === candidateId)
  }

  listApplied(): LearningMutation[] {
    return this.list().filter((mutation) => mutation.status === 'applied')
  }

  /** Mutations still in force: applied or confirmed (PRD §40 outcome evaluation). */
  listActive(): LearningMutation[] {
    return this.list().filter((mutation) => mutation.status === 'applied' || mutation.status === 'confirmed')
  }

  markConfirmed(id: string): LearningMutation | null {
    const mutation = this.get(id)
    if (!mutation) return null
    return this.save({ ...mutation, status: 'confirmed' })
  }

  markReverted(id: string, ts: string, reason?: string): LearningMutation | null {
    const mutation = this.get(id)
    if (!mutation) return null
    return this.save({ ...mutation, status: 'reverted', revertedAt: ts, ...(reason === undefined ? {} : { reason }) })
  }
}