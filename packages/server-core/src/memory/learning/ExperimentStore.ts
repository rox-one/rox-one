/**
 * ExperimentStore — JSONL of LearningExperiment rows (PRD §3.4).
 * Stored at {workspaceRoot}/memory/learning/experiments.jsonl.
 */
import { join } from 'path'
import type { LearningExperiment } from '@rox/shared/memory/learning'
import { learningDirFor } from './learning-types'
import { LearningStore } from './LearningStore'

export class ExperimentStore extends LearningStore<LearningExperiment> {
  constructor(workspaceRoot: string) {
    super(join(learningDirFor(workspaceRoot), 'experiments.jsonl'))
  }

  listByCandidate(candidateId: string): LearningExperiment[] {
    return this.list().filter((experiment) => experiment.candidateId === candidateId)
  }
}