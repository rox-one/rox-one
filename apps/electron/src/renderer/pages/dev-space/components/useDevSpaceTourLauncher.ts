import { useCallback, useMemo } from 'react'
import { useProductLearning } from '@/features/product-tour/runtime'
import type { TourId } from '@/features/product-tour/contracts'

export interface DevSpaceTourLauncher {
  /** The learning runtime is ready to accept a run for this workspace/panel. */
  readonly available: boolean
  /** Start a generated dev-space tour by its dynamic id (`DS-<slug>-<n>`). */
  start(tourId: string): void
}

/**
 * С-10 → D9/D11 bridge: launches a generated tour through the product-tour
 * public controller (`useProductLearning().start`). No second tour engine and
 * no direct engine import — the controller is the only launch seam.
 */
export function useDevSpaceTourLauncher(): DevSpaceTourLauncher {
  const learning = useProductLearning()
  const available = learning?.ready ?? false
  const start = useCallback((tourId: string) => { void learning?.start(tourId as TourId) }, [learning])
  return useMemo(() => ({ available, start }), [available, start])
}