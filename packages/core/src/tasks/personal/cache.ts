/**
 * Personal-task cache adapter (ROX-AUD-101 / #332).
 * Canonical storage is still the JSON blob; this layer refuses to wipe a
 * corrupt original. Renderer localStorage is one Kv; tests inject a Map.
 */

import { PersonalTaskStore } from './store.ts'

export const PERSONAL_TASKS_STORAGE_KEY = 'rox.personal-tasks.v1'
export const PERSONAL_TASKS_QUARANTINE_KEY = 'rox.personal-tasks.v1.quarantine'
export const PERSONAL_TASKS_STAGING_KEY = 'rox.personal-tasks.v1.staging'

export type PersonalTaskKv = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type PersonalTaskCacheLoad = {
  store: PersonalTaskStore
  status: 'ok' | 'empty' | 'quarantine'
  reason?: string
}

export function loadPersonalTaskCache(kv: PersonalTaskKv): PersonalTaskCacheLoad {
  const raw = kv.getItem(PERSONAL_TASKS_STORAGE_KEY)
  if (!raw) return { store: new PersonalTaskStore(), status: 'empty' }
  const parsed = PersonalTaskStore.tryFromJson(raw)
  if (parsed.status === 'ok') return { store: parsed.store, status: 'ok' }
  kv.setItem(PERSONAL_TASKS_QUARANTINE_KEY, raw)
  return { store: new PersonalTaskStore(), status: 'quarantine', reason: parsed.reason }
}

export function persistPersonalTaskCache(
  kv: PersonalTaskKv,
  store: PersonalTaskStore,
  status: PersonalTaskCacheLoad['status'],
): { wrote: 'canonical' | 'staging' } {
  const payload = store.exportJson()
  if (status === 'quarantine') {
    kv.setItem(PERSONAL_TASKS_STAGING_KEY, payload)
    return { wrote: 'staging' }
  }
  kv.setItem(PERSONAL_TASKS_STORAGE_KEY, payload)
  return { wrote: 'canonical' }
}
