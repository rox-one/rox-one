import { useMemo } from 'react'
import type { TourScope } from '../../contracts'
import { useTourSignals, type TourObservation } from '../../runtime/hooks'
import { deriveKnowledgeSignals, type KnowledgeCompletion } from './index'

export function useKnowledgeSignals(overrides: Partial<TourScope> = {}) {
  const signals = useTourSignals(overrides)
  return useMemo(() => ({ ...signals,
    publish(observation: TourObservation | null, completion: KnowledgeCompletion) {
      for (const signal of deriveKnowledgeSignals(observation, completion)) {
        signals.emit(observation, signal.name, signal.level, signal.origin, signal.eventToken)
      }
    },
  }), [signals])
}
