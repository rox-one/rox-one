/**
 * Guided tour runtime status shared with other first-run surfaces (the legacy
 * product-tour invitation stays hidden while the guided tour is pending or
 * running) plus a one-shot "wizard just finished" signal from App.
 */
import { useSyncExternalStore } from 'react'

export type GuidedTourRuntimeStatus = 'idle' | 'pending' | 'running'

let status: GuidedTourRuntimeStatus = 'idle'
let firstRun = false
const listeners = new Set<() => void>()

export function getGuidedTourStatus(): GuidedTourRuntimeStatus { return status }
export function setGuidedTourStatus(next: GuidedTourRuntimeStatus): void {
  if (status === next) return
  status = next
  for (const listener of listeners) listener()
}
export function subscribeGuidedTourStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useGuidedTourStatus(): GuidedTourRuntimeStatus {
  return useSyncExternalStore(subscribeGuidedTourStatus, getGuidedTourStatus, getGuidedTourStatus)
}

/** Called by App when the first-run wizard completes in this window. */
export function markGuidedTourFirstRun(): void { firstRun = true }
/** Read-and-clear the first-run signal. */
export function consumeGuidedTourFirstRun(): boolean { const value = firstRun; firstRun = false; return value }
