import type { PersistResult, ProgressMutation, ProgressRepository, StepId, StepProgress, TourDefinition, TourId, TourProgress, WindowLease } from '../contracts'
import { createDatabaseAccess, failed, memoryOnly, requestValue, saved, transaction, UnsupportedLearningSchema } from './database'
import type { LearningStorageOptions } from './database'
import { LEARNING_SAFE_REASONS, LEARNING_STEP_IDS } from '../analytics/events'
import { hasCurrentMemoryLease } from './lease'

export interface LearningLeaseGuard {
  readonly profileId: string
  readonly lease: WindowLease
  readonly memoryOnly?: boolean
}
export interface LearningProgressRepository extends ProgressRepository {
  apply(scopeKey: string, tour: TourDefinition, mutation: ProgressMutation, guard?: LearningLeaseGuard): Promise<PersistResult<TourProgress>>
  resetScope(scopeKey: string, guard?: LearningLeaseGuard): Promise<PersistResult<void>>
}
export class LearningLeaseLostError extends Error {
  constructor() { super('Learning lease lost'); this.name = 'LearningLeaseLostError' }
}

const timestamps = ['shownAt', 'acknowledgedAt', 'observedAt', 'verifiedAt', 'skippedAt'] as const
const statuses = new Set(['not-started', 'in-progress', 'completed-learning', 'partial', 'dismissed'])
export function isTourProgress(value: unknown, scopeKey: string, tourId: TourId): value is TourProgress {
  if (!value || typeof value !== 'object') return false
  const record = value as TourProgress
  if (record.schemaVersion !== 1 || record.scopeKey !== scopeKey || record.tourId !== tourId ||
    !Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isSafeInteger(record.tourVersion) ||
    record.tourVersion < 1 || !statuses.has(record.status) || !record.steps || typeof record.steps !== 'object' || Array.isArray(record.steps) ||
    (record.dismissedUntilVersion !== undefined && (!Number.isSafeInteger(record.dismissedUntilVersion) || record.dismissedUntilVersion < 1))) return false
  return Object.entries(record.steps).every(([id, step]) => LEARNING_STEP_IDS.includes(id as StepId) && step && step.stepId === id &&
    Number.isSafeInteger(step.stepVersion) && step.stepVersion > 0 &&
    (step.notApplicableReason === undefined || LEARNING_SAFE_REASONS.includes(step.notApplicableReason)) &&
    timestamps.every(key => step[key] === undefined || (Number.isFinite(step[key]) && step[key] >= 0)))
}
function checkFuture(value: unknown) {
  if (value && typeof value === 'object' && 'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' && value.schemaVersion > 1) throw new UnsupportedLearningSchema()
}
function initial(scopeKey: string, tour: TourDefinition): TourProgress {
  return { schemaVersion: 1, scopeKey, tourId: tour.id, tourVersion: tour.version, revision: 0, status: 'not-started', steps: {} }
}
/** Merge a mutation against the value read inside the write transaction, never a window's snapshot. */
export function mergeProgress(previous: TourProgress | null, scopeKey: string, tour: TourDefinition, mutation: ProgressMutation): TourProgress {
  const before = previous ?? initial(scopeKey, tour)
  // An older window cannot downgrade a definition installed by a newer window.
  if (before.tourVersion > tour.version) return before
  const steps: Partial<Record<StepId, StepProgress>> = { ...before.steps }
  let semanticChanged = false
  for (const step of tour.steps) {
    const old = steps[step.id]
    if (old && old.stepVersion < step.version) { delete steps[step.id]; semanticChanged = true }
  }
  let status = semanticChanged && before.status === 'completed-learning' ? 'in-progress' : before.status
  let dismissedUntilVersion = before.dismissedUntilVersion
  if (mutation.kind === 'evidence' || mutation.kind === 'skip' || mutation.kind === 'not-applicable') {
    const definition = tour.steps.find(step => step.id === mutation.stepId)
    if (!definition || definition.version !== mutation.stepVersion) return before
    const old = steps[mutation.stepId]
    if (old && old.stepVersion > mutation.stepVersion) return before
    const step: StepProgress = old ?? { stepId: mutation.stepId, stepVersion: mutation.stepVersion }
    if (mutation.kind === 'evidence') {
      if (!Number.isFinite(mutation.at) || mutation.at < 0) return before
      const key = `${mutation.level}At` as 'shownAt' | 'acknowledgedAt' | 'observedAt' | 'verifiedAt'
      steps[mutation.stepId] = { ...step, [key]: step[key] ?? mutation.at }
    } else if (mutation.kind === 'skip') {
      if (!Number.isFinite(mutation.at) || mutation.at < 0) return before
      steps[mutation.stepId] = { ...step, skippedAt: step.skippedAt ?? mutation.at }
    } else {
      if (!definition.optional || definition.onUnavailable !== 'not-applicable') return before
      if (!LEARNING_SAFE_REASONS.includes(mutation.reason)) return before
      steps[mutation.stepId] = { ...step, notApplicableReason: mutation.reason }
    }
    if (status === 'not-started' || (status === 'dismissed' && (dismissedUntilVersion ?? 0) < tour.version)) status = 'in-progress'
  } else if (mutation.kind === 'dismiss') {
    if (mutation.tourVersion !== tour.version) return before
    status = 'dismissed'
    dismissedUntilVersion = Math.max(dismissedUntilVersion ?? 0, mutation.tourVersion)
  } else if (mutation.kind === 'finish') {
    if (status !== 'completed-learning') status = mutation.status
  }
  const candidate = { ...before, tourVersion: tour.version, status, steps, ...(dismissedUntilVersion !== undefined ? { dismissedUntilVersion } : {}) }
  if (JSON.stringify(candidate) === JSON.stringify(before)) return before
  return { ...candidate, revision: before.revision + 1 }
}

function memoryRepository() {
  const records = new Map<string, TourProgress>()
  const key = (scope: string, tour: TourId) => JSON.stringify([scope, tour])
  const repository: ProgressRepository = {
    async read(scopeKey, tourId) { return memoryOnly(structuredClone(records.get(key(scopeKey, tourId)) ?? null)) },
    async apply(scopeKey, tour, mutation) {
      const value = mergeProgress(records.get(key(scopeKey, tour.id)) ?? null, scopeKey, tour, mutation)
      records.set(key(scopeKey, tour.id), value)
      return memoryOnly(structuredClone(value))
    },
    async resetScope(scopeKey) {
      for (const [id, value] of records) if (value.scopeKey === scopeKey) records.delete(id)
      return memoryOnly(undefined)
    },
  }
  return { repository, seed(value: TourProgress) {
    const id = key(value.scopeKey, value.tourId)
    if (!records.has(id)) records.set(id, structuredClone(value))
  } }
}
export function createMemoryOnlyRepository(): ProgressRepository { return memoryRepository().repository }

export function createProgressRepository(options: LearningStorageOptions = {}): LearningProgressRepository {
  const database = createDatabaseAccess(options)
  const memory = memoryRepository()
  const fallback = memory.repository
  const cache = new Map<string, TourProgress>()
  let unavailable = false
  let unsupported = false
  const key = (scope: string, tour: TourId) => JSON.stringify([scope, tour])
  const now = options.now ?? Date.now
  function assertScope(scopeKey: string, guard: LearningLeaseGuard) {
    try {
      const scope: unknown = JSON.parse(scopeKey)
      if (!Array.isArray(scope) || scope.length !== 2 || scope[0] !== guard.profileId) throw new LearningLeaseLostError()
    } catch { throw new LearningLeaseLostError() }
  }
  async function assertDurableLease(tx: IDBTransaction, guard: LearningLeaseGuard) {
    const current: unknown = await requestValue(tx.objectStore('leases').get(guard.profileId))
    const at = now()
    if (!current || typeof current !== 'object' ||
      (current as WindowLease).ownerWindowId !== guard.lease.ownerWindowId ||
      (current as WindowLease).fence !== guard.lease.fence ||
      !((current as WindowLease).expiresAt > at) || !(guard.lease.expiresAt > at)) throw new LearningLeaseLostError()
  }
  async function assertFallbackLease(guard: LearningLeaseGuard): Promise<boolean> {
    if (guard.memoryOnly) {
      if (!hasCurrentMemoryLease(options, guard.profileId, guard.lease, now())) throw new LearningLeaseLostError()
    } else {
      // Quota failure may still permit a readonly ownership check. Never assume the earlier fence remains valid.
      try { await transaction(await database.open(), ['leases'], 'readonly', tx => assertDurableLease(tx, guard)) }
      catch (error) { if (error instanceof LearningLeaseLostError) throw error; return false }
    }
    return true
  }
  async function applyInMemory(scopeKey: string, tour: TourDefinition, mutation: ProgressMutation, guard?: LearningLeaseGuard) {
    if (guard && !await assertFallbackLease(guard)) return failed()
    const cached = cache.get(key(scopeKey, tour.id))
    if (cached) memory.seed(cached)
    return fallback.apply(scopeKey, tour, mutation)
  }
  return {
    async read(scopeKey, tourId) {
      if (unsupported) return failed()
      if (unavailable) {
        const local = await fallback.read(scopeKey, tourId)
        return local.status === 'memory-only' && !local.value ? memoryOnly(structuredClone(cache.get(key(scopeKey, tourId)) ?? null)) : local
      }
      try {
        const value = await transaction(await database.open(), ['progress'], 'readonly', async tx => {
          const record: unknown = await requestValue(tx.objectStore('progress').get([scopeKey, tourId]))
          checkFuture(record)
          return isTourProgress(record, scopeKey, tourId) ? record : null
        })
        if (value) cache.set(key(scopeKey, tourId), value)
        else cache.delete(key(scopeKey, tourId))
        return saved(value)
      } catch (error) {
        if (error instanceof UnsupportedLearningSchema) { unsupported = true; return failed() }
        unavailable = true
        return memoryOnly(structuredClone(cache.get(key(scopeKey, tourId)) ?? null))
      }
    },
    async apply(scopeKey, tour, mutation, guard) {
      if (unsupported) return failed()
      if (guard) assertScope(scopeKey, guard)
      if (guard?.memoryOnly) { unavailable = true; return applyInMemory(scopeKey, tour, mutation, guard) }
      if (!unavailable) try {
        const value = await transaction(await database.open(), guard ? ['progress', 'leases'] : ['progress'], 'readwrite', async tx => {
          if (guard) await assertDurableLease(tx, guard)
          const store = tx.objectStore('progress')
          const record: unknown = await requestValue(store.get([scopeKey, tour.id]))
          checkFuture(record)
          const previous = isTourProgress(record, scopeKey, tour.id) ? record : null
          const next = mergeProgress(previous, scopeKey, tour, mutation)
          if (next !== previous) await requestValue(store.put(next, [scopeKey, tour.id]))
          return next
        })
        cache.set(key(scopeKey, tour.id), value)
        return saved(value)
      } catch (error) {
        if (error instanceof LearningLeaseLostError) throw error
        if (error instanceof UnsupportedLearningSchema) { unsupported = true; return failed() }
        unavailable = true
      }
      return applyInMemory(scopeKey, tour, mutation, guard)
    },
    async resetScope(scopeKey, guard) {
      if (unsupported) return failed()
      // Deleting milestones is a write and requires the same ownership fence as evidence.
      if (!guard) throw new LearningLeaseLostError()
      assertScope(scopeKey, guard)
      if (guard.memoryOnly) unavailable = true
      if (!unavailable) try {
        await transaction(await database.open(), ['progress', 'attempts', 'leases'], 'readwrite', async tx => {
          await assertDurableLease(tx, guard)
          for (const name of ['progress', 'attempts']) await new Promise<void>((resolve, reject) => {
            const request = tx.objectStore(name).openCursor()
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const cursor = request.result
              if (!cursor) return resolve()
              const compoundKey = cursor.key
              if (Array.isArray(compoundKey) && compoundKey[0] === scopeKey) {
                try { checkFuture(cursor.value); cursor.delete() } catch (error) { reject(error); return }
              }
              cursor.continue()
            }
          })
        })
        for (const [id, value] of cache) if (value.scopeKey === scopeKey) cache.delete(id)
        await fallback.resetScope(scopeKey)
        return saved(undefined)
      } catch (error) {
        if (error instanceof LearningLeaseLostError) throw error
        if (error instanceof UnsupportedLearningSchema) { unsupported = true; return failed() }
        unavailable = true
      }
      if (!await assertFallbackLease(guard)) return failed()
      for (const [id, value] of cache) if (value.scopeKey === scopeKey) cache.delete(id)
      return fallback.resetScope(scopeKey)
    },
  }
}
