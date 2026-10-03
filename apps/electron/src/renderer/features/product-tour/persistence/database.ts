export const LEARNING_DATABASE_NAME = 'rox-product-tour'
export const LEARNING_SCHEMA_VERSION = 1
export const LEARNING_STORES = ['meta', 'progress', 'attempts', 'leases', 'diagnostics'] as const
export type StorageStatus = 'saved' | 'memory-only' | 'failed'
export interface LearningStorageOptions {
  readonly indexedDB?: IDBFactory | null
  readonly databaseName?: string
  readonly now?: () => number
  readonly leaseTtlMs?: number
  /** A memory lease cannot coordinate separate windows. Opt in only with that limitation visible. */
  readonly allowMemoryOnlyLease?: boolean
}

export class UnsupportedLearningSchema extends Error {
  constructor() { super('Unsupported learning schema'); this.name = 'UnsupportedLearningSchema' }
}
export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Learning storage request failed'))
  })
}

/** The request result is provisional until the entire transaction commits. */
export async function transaction<T>(database: IDBDatabase, stores: readonly string[], mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = database.transaction([...new Set(['meta', ...stores])], mode)
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Learning transaction failed'))
  })
  // Observe an abort even if the schema check or callback fails first.
  void completed.catch(() => {})
  try {
    const schema = await requestValue(tx.objectStore('meta').get('schemaVersion'))
    if (schema !== LEARNING_SCHEMA_VERSION) throw new UnsupportedLearningSchema()
    const value = await run(tx)
    await completed
    return value
  } catch (error) {
    try { tx.abort() } catch { /* It may already have aborted. */ }
    throw error
  }
}

export function createDatabaseAccess(options: LearningStorageOptions = {}) {
  let opening: Promise<IDBDatabase> | undefined
  return {
    async open(): Promise<IDBDatabase> {
      if (opening) return opening
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        let blocked = false
        try {
          const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB
          if (!factory) throw new Error('Learning storage unavailable')
          const request = factory.open(options.databaseName ?? LEARNING_DATABASE_NAME, LEARNING_SCHEMA_VERSION)
          request.onupgradeneeded = () => {
            const db = request.result
            for (const name of LEARNING_STORES) {
              if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, name === 'diagnostics' ? { autoIncrement: true } : undefined)
            }
            request.transaction!.objectStore('meta').put(LEARNING_SCHEMA_VERSION, 'schemaVersion')
          }
          request.onsuccess = () => {
            const db = request.result
            if (blocked) { db.close(); return }
            db.onversionchange = () => { db.close(); opening = undefined }
            resolve(db)
          }
          request.onerror = () => reject(request.error?.name === 'VersionError'
            ? new UnsupportedLearningSchema() : request.error ?? new Error('Learning storage unavailable'))
          request.onblocked = () => { blocked = true; reject(new Error('Learning storage blocked')) }
        } catch (error) { reject(error) }
      })
      return opening
    },
    async close() { if (opening) { try { (await opening).close() } catch { /* unavailable */ } opening = undefined } },
  }
}

export function failed() { return { status: 'failed', reason: 'storage-unavailable' } as const }
export function memoryOnly<T>(value: T) { return { status: 'memory-only', value, reason: 'storage-unavailable' } as const }
export function saved<T>(value: T) { return { status: 'saved', value } as const }
