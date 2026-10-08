/**
 * PolicyStore — durable `LearningPolicy` rows (PRD §3.7/§13) at
 * {workspaceRoot}/memory/learning/policies.jsonl, via the generic LearningStore.
 *
 * Every learned policy lives here (`candidate` → `active` → `rolled_back`); the
 * promotion path writes through `LearningTargetStores.savePolicy`, and the
 * rollback path removes by id. Fail-soft like every other learning store:
 * corrupt lines are skipped, rewrites are atomic.
 */
import { join } from 'path'
import type { LearningPolicy } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class PolicyStore extends LearningStore<LearningPolicy> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'policies.jsonl'))
  }

  /** Policies by status, oldest first. */
  listByStatus(status: LearningPolicy['status']): LearningPolicy[] {
    return this.list().filter((policy) => policy.status === status)
  }
}