import type { LeaseRepository, WindowLease } from '../contracts'
import { createDatabaseAccess, requestValue, transaction, UnsupportedLearningSchema } from './database'
import type { LearningStorageOptions, StorageStatus } from './database'

const memoryLeases = new Map<string, WindowLease>()
export interface LearningLeaseRepository extends LeaseRepository {
  getStorageStatus(): StorageStatus
}
function valid(value: unknown): value is WindowLease {
  if (!value || typeof value !== 'object') return false
  const lease = value as WindowLease
  return typeof lease.ownerWindowId === 'string' && Number.isSafeInteger(lease.fence) && lease.fence >= 0 && Number.isFinite(lease.expiresAt)
}
function owns(current: WindowLease | undefined, candidate: WindowLease) {
  return !!current && current.ownerWindowId === candidate.ownerWindowId && current.fence === candidate.fence
}
export function createLeaseRepository(options: LearningStorageOptions = {}): LearningLeaseRepository {
  const database = createDatabaseAccess(options)
  const ttl = options.leaseTtlMs ?? 15_000
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid learning lease TTL')
  let status: StorageStatus = 'saved'
  async function update(profileId: string, change: (current: WindowLease | undefined) => WindowLease | null): Promise<WindowLease | null> {
    if (status === 'failed') return null
    if (status === 'saved') try {
      return await transaction(await database.open(), ['leases'], 'readwrite', async tx => {
        const store = tx.objectStore('leases')
        const record: unknown = await requestValue(store.get(profileId))
        if (record !== undefined && !valid(record)) throw new UnsupportedLearningSchema()
        const next = change(valid(record) ? record : undefined)
        if (next) await requestValue(store.put(next, profileId))
        return next
      })
    } catch (error) {
      status = error instanceof UnsupportedLearningSchema ? 'failed' : 'memory-only'
    }
    if (status !== 'memory-only' || !options.allowMemoryOnlyLease) return null
    const key = JSON.stringify([options.databaseName ?? 'rox-product-tour', profileId])
    const next = change(memoryLeases.get(key))
    if (next) memoryLeases.set(key, next)
    return next
  }
  return {
    getStorageStatus: () => status,
    async acquire(profileId, ownerWindowId, now) {
      if (!profileId || !ownerWindowId || !Number.isFinite(now)) return null
      return update(profileId, current => {
        if (current && current.expiresAt > now) return current.ownerWindowId === ownerWindowId
          ? { ...current, expiresAt: now + ttl } : null
        if ((current?.fence ?? 0) >= Number.MAX_SAFE_INTEGER) return null
        return { ownerWindowId, fence: (current?.fence ?? 0) + 1, expiresAt: now + ttl }
      })
    },
    async renew(profileId, lease, now) {
      if (!Number.isFinite(now) || !valid(lease)) return null
      return update(profileId, current => owns(current, lease) && current!.expiresAt > now
        ? { ...current!, expiresAt: now + ttl } : null)
    },
    async release(profileId, lease) {
      // Keep the fence tombstone. Deleting a released lease would let an old fence become valid again.
      await update(profileId, current => owns(current, lease) ? { ...current!, expiresAt: 0 } : null)
    },
  }
}
