import type { DynamicTourId, TourDefinition, TourId } from '../contracts'
import { validateDynamicTourCatalogue } from './validate'

/** A generated tour admission result. Invalid definitions are never admitted (D9). */
export interface DynamicTourRegistration {
  /** `null` when the generated definition failed validation and was not admitted. */
  readonly id: TourId | null
  readonly errors: readonly string[]
  /** Idempotent; a stale cleanup never removes a replacement registration. */
  readonly cleanup: () => void
}

/** Dynamic catalogue source: generated tours join the same engine as the static catalogue (D9). */
export interface DynamicTourSource {
  register(definition: TourDefinition): DynamicTourRegistration
  unregister(id: TourId): void
  get(id: TourId): TourDefinition | undefined
  /** Stable, frozen snapshot reference; changes only with registrations. */
  list(): readonly TourDefinition[]
  clear(): void
  subscribe(listener: () => void): () => void
}

/** Canonical generator for the `DS-<slug>-<n>` / `PB-<slug>-<n>` dynamic id space. */
export function dynamicTourId(prefix: 'DS' | 'PB', slug: string, ordinal: number): DynamicTourId {
  return `${prefix}-${slug}-${ordinal}` as DynamicTourId
}

export function createDynamicTourSource(): DynamicTourSource {
  const definitions = new Map<string, { definition: TourDefinition; token: object }>()
  const listeners = new Set<() => void>()
  let snapshot: readonly TourDefinition[] = Object.freeze([])
  const publish = (): void => {
    snapshot = Object.freeze(Array.from(definitions.values(), entry => entry.definition))
    for (const listener of listeners) listener()
  }
  return {
    register(definition) {
      const errors = validateDynamicTourCatalogue([definition])
      if (errors.length) return { id: null, errors, cleanup: () => {} }
      const token = {}
      const registration = { definition, token }
      definitions.set(definition.id, registration)
      publish()
      return {
        id: definition.id,
        errors: [],
        cleanup: () => {
          if (definitions.get(definition.id) !== registration) return
          definitions.delete(definition.id)
          publish()
        },
      }
    },
    unregister(id) {
      if (!definitions.delete(id)) return
      publish()
    },
    get(id) {
      return definitions.get(id)?.definition
    },
    list() {
      return snapshot
    },
    clear() {
      if (!definitions.size) return
      definitions.clear()
      publish()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Process-wide dynamic source shared by the provider and artifact-driven callers. */
const defaultSource = createDynamicTourSource()

export const registerDynamicTour = (definition: TourDefinition): DynamicTourRegistration => defaultSource.register(definition)
export const unregisterDynamicTour = (id: TourId): void => defaultSource.unregister(id)
export const getDynamicTour = (id: TourId): TourDefinition | undefined => defaultSource.get(id)
export const listDynamicTours = (): readonly TourDefinition[] => defaultSource.list()
export const subscribeDynamicTours = (listener: () => void): (() => void) => defaultSource.subscribe(listener)
export const clearDynamicTours = (): void => defaultSource.clear()