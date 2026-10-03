import type { PersistResult } from '../contracts'
import { createDatabaseAccess, failed, requestValue, saved, transaction } from '../persistence/database'
import type { LearningStorageOptions } from '../persistence/database'
import { sanitizeLearningEvent } from './events'
import type { SafeLearningEvent } from './events'

export const MAX_LEARNING_DIAGNOSTICS = 500
export const LEARNING_DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export interface LearningDiagnostic extends SafeLearningEvent { readonly at: number }
export interface LearningDiagnosticsRepository {
  append(event: unknown, runtimeIdentity?: string): Promise<PersistResult<boolean>>
  read(): Promise<PersistResult<readonly LearningDiagnostic[]>>
  clear(): Promise<PersistResult<void>>
}
export function createLearningDiagnosticsRepository(options: LearningStorageOptions = {}): LearningDiagnosticsRepository {
  const database = createDatabaseAccess(options)
  // Native event identity is only used in bounded memory and is never stored in diagnostics.
  const seen = new Set<string>()
  const now = options.now ?? Date.now
  async function readAndPrune(tx: IDBTransaction): Promise<LearningDiagnostic[]> {
    const cutoff = now() - LEARNING_DIAGNOSTICS_RETENTION_MS
    return new Promise((resolve, reject) => {
      const values: { key: IDBValidKey; value: LearningDiagnostic }[] = []
      const request = tx.objectStore('diagnostics').openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          const excess = values.length - MAX_LEARNING_DIAGNOSTICS
          for (const item of values.slice(0, Math.max(0, excess))) tx.objectStore('diagnostics').delete(item.key)
          return resolve(values.slice(Math.max(0, excess)).map(item => item.value))
        }
        const event = sanitizeLearningEvent(cursor.value)
        const at = cursor.value?.at
        if (!event || !Number.isFinite(at) || at < cutoff || at > now()) cursor.delete()
        else values.push({ key: cursor.key, value: { ...event, at } })
        cursor.continue()
      }
    })
  }
  async function enabled(tx: IDBTransaction) {
    const preferences = await requestValue(tx.objectStore('meta').get('preferences'))
    return preferences?.diagnosticsEnabled === true
  }
  return {
    async append(input, runtimeIdentity) {
      const event = sanitizeLearningEvent(input)
      if (!event) return saved(false)
      try {
        const appended = await transaction(await database.open(), ['diagnostics'], 'readwrite', async tx => {
          if (!await enabled(tx)) { seen.clear(); await requestValue(tx.objectStore('diagnostics').clear()); return false }
          if (runtimeIdentity && seen.has(runtimeIdentity)) return false
          await requestValue(tx.objectStore('diagnostics').add({ ...event, at: now() }))
          await readAndPrune(tx)
          return true
        })
        if (appended && runtimeIdentity) {
          seen.add(runtimeIdentity)
          if (seen.size > MAX_LEARNING_DIAGNOSTICS) seen.delete(seen.values().next().value!)
        }
        return saved(appended)
      } catch { return failed() }
    },
    async read() {
      try {
        const values = await transaction(await database.open(), ['diagnostics'], 'readwrite', async tx => {
          if (!await enabled(tx)) { seen.clear(); await requestValue(tx.objectStore('diagnostics').clear()); return [] }
          return readAndPrune(tx)
        })
        return saved(values)
      } catch { return failed() }
    },
    async clear() {
      try {
        await transaction(await database.open(), ['diagnostics'], 'readwrite', async tx => { await requestValue(tx.objectStore('diagnostics').clear()) })
        seen.clear()
        return saved(undefined)
      } catch { return failed() }
    },
  }
}
