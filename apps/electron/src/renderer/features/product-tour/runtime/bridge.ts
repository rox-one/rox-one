import type { TourSignal } from '../contracts'

const listeners = new Set<(signal: TourSignal) => void>()
/** App publishes only observations already bound when the native operation began. */
export function publishTourSignal(signal: TourSignal) {
  for (const listener of listeners) listener(signal)
}
export function subscribeTourSignals(listener: (signal: TourSignal) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
