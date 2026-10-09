/**
 * Onboarding learning-curve tracker.
 *
 * Records the shape of a user's first run at a step — saw → tried → result →
 * repeated → returned — with actor attribution (a human, an agent, or
 * unknown). Events are buffered in memory (capped at
 * LEARNING_CURVE_MAX_BUFFER, oldest dropped first) and, when a storage adapter
 * is supplied, persisted locally so a reload keeps the unfinished curve.
 *
 * This module is local only: it never performs network I/O. `drain()` hands
 * the buffered events to a future analytics wiring without clearing storage
 * for anyone else.
 */

export const LEARNING_CURVE_MAX_BUFFER = 500
export const LEARNING_CURVE_STORAGE_KEY = 'rox.onboarding.learning-curve.v1'

export const LEARNING_EVENT_NAMES = ['saw', 'tried', 'result', 'repeated', 'returned'] as const
export type LearningEventName = (typeof LEARNING_EVENT_NAMES)[number]

export const LEARNING_ACTORS = ['human', 'agent', 'unknown'] as const
export type LearningActor = (typeof LEARNING_ACTORS)[number]

export type LearningEvent = {
  name: LearningEventName
  stepId: string
  source: LearningActor
  at: number
}

export type LearningEventInput = {
  name: LearningEventName
  stepId: string
  source?: LearningActor
  at?: number
}

export type LearningCurveStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type LearningCurve = {
  trackLearningEvent(input: LearningEventInput): LearningEvent
  /** Return buffered events and clear the buffer. */
  drain(): LearningEvent[]
  peek(): readonly LearningEvent[]
  readonly size: number
  clear(): void
}

function isLearningEvent(value: unknown): value is LearningEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    typeof event.name === 'string' &&
    (LEARNING_EVENT_NAMES as readonly string[]).includes(event.name) &&
    typeof event.stepId === 'string' &&
    typeof event.source === 'string' &&
    (LEARNING_ACTORS as readonly string[]).includes(event.source) &&
    typeof event.at === 'number'
  )
}

function parseEvents(raw: string | null): LearningEvent[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLearningEvent).slice(-LEARNING_CURVE_MAX_BUFFER)
  } catch {
    return []
  }
}

export function createLearningCurve(
  options: { storage?: LearningCurveStorage; now?: () => number } = {},
): LearningCurve {
  const now = options.now ?? (() => Date.now())
  let buffer = parseEvents(options.storage?.getItem(LEARNING_CURVE_STORAGE_KEY) ?? null)

  const persist = () => {
    options.storage?.setItem(LEARNING_CURVE_STORAGE_KEY, JSON.stringify(buffer))
  }

  return {
    trackLearningEvent(input) {
      if (!(LEARNING_EVENT_NAMES as readonly string[]).includes(input.name)) {
        throw new Error(`unknown learning-curve event: ${String(input.name)}`)
      }
      const source: LearningActor = input.source ?? 'unknown'
      if (!(LEARNING_ACTORS as readonly string[]).includes(source)) {
        throw new Error(`unknown learning-curve actor: ${String(source)}`)
      }
      const event: LearningEvent = { name: input.name, stepId: input.stepId, source, at: input.at ?? now() }
      buffer.push(event)
      if (buffer.length > LEARNING_CURVE_MAX_BUFFER) {
        buffer = buffer.slice(buffer.length - LEARNING_CURVE_MAX_BUFFER)
      }
      persist()
      return event
    },
    drain() {
      const drained = buffer
      buffer = []
      persist()
      return drained
    },
    peek: () => [...buffer],
    get size() {
      return buffer.length
    },
    clear() {
      buffer = []
      persist()
    },
  }
}

/** Process-wide local buffer used by the standalone helpers below. */
export const learningCurve = createLearningCurve()

export function trackLearningEvent(input: LearningEventInput): LearningEvent {
  return learningCurve.trackLearningEvent(input)
}

export function drainLearningEvents(): LearningEvent[] {
  return learningCurve.drain()
}