import { useSyncExternalStore } from 'react'
import type { TourDefinition } from '../contracts'
import { listDynamicTours, subscribeDynamicTours } from '../catalogue/dynamic'

export {
  createDynamicTourSource, dynamicTourId,
  registerDynamicTour, unregisterDynamicTour, getDynamicTour, listDynamicTours, subscribeDynamicTours, clearDynamicTours,
  type DynamicTourSource, type DynamicTourRegistration,
} from '../catalogue/dynamic'

/** Live generated tours for artifact-driven surfaces; re-renders when the dynamic source changes. */
export function useDynamicTours(): readonly TourDefinition[] {
  return useSyncExternalStore(subscribeDynamicTours, listDynamicTours, listDynamicTours)
}