/**
 * RollbackManager — undoes LearningMutation rows (PRD §40): every durable
 * change stays reversible, and the rollback itself is recorded (PRD §41).
 *
 * Semantics:
 * - `revert(mutationId)` looks the mutation up, refuses unknown/already-reverted/
 *   non-rollbackable rows, then undoes the matching target change. A skill whose
 *   queue entry is gone was already approved into `skills/<slug>` — that rollback
 *   is refused (`'skill already approved'`) rather than ripping out a live skill.
 * - On success the mutation row is marked `'reverted'` (ts + reason), the owning
 *   candidate flips to `'rolled_back'`, and a `action: 'rollback'` audit line is
 *   appended (fail-soft store).
 * - `revertCandidate` reverts every non-reverted mutation of a candidate,
 *   reporting how many succeeded and the first refusal reason.
 */
import type { LearningMutation } from '@rox/shared/memory/learning'
import type { LearningTargetStores, RollbackResult } from './learning-types'
import type { CandidateStore } from './CandidateStore'
import type { LearningAudit } from './LearningAudit'
import type { MutationStore } from './MutationStore'

export interface RollbackManagerDeps {
  targets: LearningTargetStores
  mutationStore: MutationStore
  candidateStore?: CandidateStore
  audit?: LearningAudit
  clock?: () => number
}

export class RollbackManager {
  private readonly deps: RollbackManagerDeps

  constructor(deps: RollbackManagerDeps) {
    this.deps = deps
  }

  revert(mutationId: string, reason?: string): RollbackResult {
    const mutation = this.deps.mutationStore.get(mutationId)
    if (!mutation) return { reverted: false, mutationIds: [], reason: 'unknown mutation' }
    if (mutation.status === 'reverted') return { reverted: false, mutationIds: [], reason: 'already reverted' }
    if (!mutation.rollbackAvailable) return { reverted: false, mutationIds: [], reason: 'rollback unavailable' }
    const refuse = (why: string): RollbackResult => ({ reverted: false, mutationIds: [], reason: why })

    const after = asRecord(mutation.after)
    if (mutation.targetType === 'lesson') {
      const rule = typeof after?.rule === 'string' && after.rule ? after.rule : mutation.targetId
      if (!this.deps.targets.removeLesson(rule, after?.scope === 'global' ? 'global' : 'workspace')) {
        return refuse('lesson not found')
      }
    } else if (mutation.targetType === 'skill') {
      const slug = typeof after?.slug === 'string' && after.slug ? after.slug : mutation.targetId
      if (!this.deps.targets.removeQueuedSkill(slug)) {
        return refuse('skill already approved')
      }
    } else if (mutation.targetType === 'policy') {
      const policyId = typeof after?.id === 'string' && after.id ? after.id : mutation.targetId
      if (!this.deps.targets.removePolicy(policyId)) {
        return refuse('policy not found')
      }
    } else {
      return refuse('unsupported target')
    }

    const ts = new Date(this.deps.clock ? this.deps.clock() : Date.now()).toISOString()
    this.deps.mutationStore.markReverted(mutation.id, ts, reason)
    const candidateStore = this.deps.candidateStore
    const candidate = candidateStore?.get(mutation.candidateId)
    if (candidateStore && candidate && candidate.status !== 'rolled_back') {
      candidateStore.save({ ...candidate, status: 'rolled_back', updatedAt: ts })
    }
    this.deps.audit?.append({
      ts,
      actor: 'learning',
      action: 'rollback',
      target: mutation.targetId,
      detail: `mutation ${mutation.id} (${mutation.targetType})${reason === undefined ? '' : `: ${reason}`}`,
    })
    return { reverted: true, mutationIds: [mutation.id] }
  }

  revertCandidate(candidateId: string, reason?: string): RollbackResult {
    const mutationIds: string[] = []
    let succeeded = 0
    let firstReason: string | undefined
    for (const mutation of this.deps.mutationStore.listByCandidate(candidateId)) {
      if (mutation.status === 'reverted') continue
      const result = this.revert(mutation.id, reason)
      if (result.reverted) {
        succeeded += 1
        mutationIds.push(...result.mutationIds)
      } else {
        firstReason ??= result.reason
      }
    }
    if (succeeded === 0) {
      return { reverted: false, mutationIds: [], reason: firstReason ?? 'no revertible mutations' }
    }
    return { reverted: true, mutationIds, ...(firstReason === undefined ? {} : { reason: firstReason }) }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}