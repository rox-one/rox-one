/**
 * ObservationStore — append-only JSONL of LearningObservation rows (PRD §8).
 * Stored at {workspaceRoot}/memory/learning/observations.jsonl.
 * Fail-soft: corrupt lines are skipped.
 */
import { join } from 'path'
import type { LearningObservation, UserCorrection } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class ObservationStore extends LearningStore<LearningObservation> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'observations.jsonl'))
  }

  append(observation: LearningObservation): LearningObservation {
    return this.save(observation)
  }

  /** Oldest first (file order); `limit` returns the most recent N. */
  list(limit?: number): LearningObservation[] {
    const items = this.readAll()
    if (limit === undefined || limit >= items.length) return items
    return items.slice(items.length - limit)
  }

  listBySession(sessionId: string): LearningObservation[] {
    return this.readAll().filter((observation) => observation.sessionId === sessionId)
  }

  /** Flatten `signals.userCorrections` from every observation, newest first. */
  listCorrections(): UserCorrection[] {
    const out: UserCorrection[] = []
    for (const observation of this.readAll()) {
      const corrections = observation.signals?.userCorrections
      if (Array.isArray(corrections)) out.push(...corrections)
    }
    return out.sort((a, b) => b.ts.localeCompare(a.ts))
  }
}