import type { StepProgress, TourDefinition, TourProgress } from '../contracts'
import { isTourProgress } from '../persistence/progress'

export interface LearningMetrics {
  readonly shown: number
  readonly acknowledged: number
  readonly observed: number
  readonly verified: number
  readonly skipped: number
  readonly notApplicable: number
  readonly totalTours: number
  readonly completedLearningTours: number
}
/** Functional milestones are the source of truth; attempts and diagnostic events never add achievements. */
export function computeLearningMetrics(input: TourProgress | readonly TourProgress[] | null,
  definitions?: readonly TourDefinition[]): LearningMetrics {
  const records = input === null ? [] : Array.isArray(input) ? input : [input as TourProgress]
  const tours = new Map<string, TourProgress>()
  const steps = new Map<string, StepProgress>()
  for (const record of records) {
    if (!record) continue
    if (!isTourProgress(record, record.scopeKey, record.tourId)) continue
    const tourKey = JSON.stringify([record.scopeKey, record.tourId])
    const existing = tours.get(tourKey)
    if (!existing || record.revision > existing.revision) tours.set(tourKey, record)
  }
  for (const [tourKey, record] of tours) for (const step of Object.values(record.steps)) {
    if (!step) continue
    if (definitions) {
      const current = definitions.find(tour => tour.id === record.tourId)?.steps.find(item => item.id === step.stepId)
      if (!current || current.version !== step.stepVersion) continue
    }
    steps.set(JSON.stringify([tourKey, step.stepId, step.stepVersion]), step)
  }
  const values = [...steps.values()]
  return {
    shown: values.filter(step => step.shownAt !== undefined).length,
    acknowledged: values.filter(step => step.acknowledgedAt !== undefined).length,
    observed: values.filter(step => step.observedAt !== undefined).length,
    verified: values.filter(step => step.verifiedAt !== undefined).length,
    skipped: values.filter(step => step.skippedAt !== undefined).length,
    notApplicable: values.filter(step => step.notApplicableReason !== undefined).length,
    totalTours: tours.size,
    completedLearningTours: [...tours.values()].filter(tour => tour.status === 'completed-learning').length,
  }
}
