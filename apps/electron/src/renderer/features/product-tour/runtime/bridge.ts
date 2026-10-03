import type { TourSignal } from '../contracts'

const listeners = new Set<(signal: TourSignal) => void>()
/** App publishes only observations already bound when the native operation began. */
export function publishTourSignal(signal: TourSignal) {
  // Learning observers cannot interrupt the canonical session commit/effect path.
  for (const listener of listeners) {
    try { listener(signal) } catch { /* An unavailable observer supplies no evidence. */ }
  }
}
export function subscribeTourSignals(listener: (signal: TourSignal) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
