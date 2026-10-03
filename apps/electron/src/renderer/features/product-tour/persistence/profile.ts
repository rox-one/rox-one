import type { PersistResult } from '../contracts'
import { createDatabaseAccess, failed, memoryOnly, requestValue, saved, transaction, UnsupportedLearningSchema } from './database'
import type { LearningStorageOptions } from './database'

export interface LearningPreferences {
  readonly invitationsEnabled: boolean
  readonly diagnosticsEnabled: boolean
}
export interface LearningProfile {
  readonly clientProfileId: string
  readonly preferences: LearningPreferences
}
export interface LearningProfileRepository {
  read(): Promise<PersistResult<LearningProfile>>
  updatePreferences(update: Partial<LearningPreferences>): Promise<PersistResult<LearningProfile>>
}
const defaults: LearningPreferences = { invitationsEnabled: false, diagnosticsEnabled: false }
const memoryProfiles = new Map<string, LearningProfile>()
function newProfile(): LearningProfile { return { clientProfileId: crypto.randomUUID(), preferences: { ...defaults } } }
function preferences(value: unknown): LearningPreferences {
  if (!value || typeof value !== 'object') return { ...defaults }
  const record = value as Partial<LearningPreferences>
  return { invitationsEnabled: record.invitationsEnabled === true, diagnosticsEnabled: record.diagnosticsEnabled === true }
}
export function createLearningScopeKey(clientProfileId: string, workspaceId: string): string {
  return JSON.stringify([clientProfileId, workspaceId])
}
export function createLearningProfileRepository(options: LearningStorageOptions = {}): LearningProfileRepository {
  const database = createDatabaseAccess(options)
  const name = options.databaseName ?? 'rox-product-tour'
  let fallback = memoryProfiles.get(name) ?? newProfile()
  let unavailable = false
  let unsupported = false
  async function access(update?: Partial<LearningPreferences>): Promise<PersistResult<LearningProfile>> {
    if (unsupported) return failed()
    if (!unavailable) try {
      const value = await transaction(await database.open(), ['diagnostics'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta')
        const id: unknown = await requestValue(meta.get('clientProfileId'))
        const stored: unknown = await requestValue(meta.get('preferences'))
        const clientProfileId = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
          ? id : fallback.clientProfileId
        const current = preferences(stored)
        const next = { ...current,
          ...(typeof update?.invitationsEnabled === 'boolean' ? { invitationsEnabled: update.invitationsEnabled } : {}),
          ...(typeof update?.diagnosticsEnabled === 'boolean' ? { diagnosticsEnabled: update.diagnosticsEnabled } : {}) }
        await requestValue(meta.put(clientProfileId, 'clientProfileId'))
        await requestValue(meta.put(next, 'preferences'))
        if (update?.diagnosticsEnabled === false) await requestValue(tx.objectStore('diagnostics').clear())
        return { clientProfileId, preferences: next }
      })
      fallback = value
      memoryProfiles.set(name, value)
      return saved(value)
    } catch (error) {
      if (error instanceof UnsupportedLearningSchema) { unsupported = true; return failed() }
      unavailable = true
    }
    fallback = memoryProfiles.get(name) ?? fallback
    fallback = { ...fallback, preferences: { ...fallback.preferences,
      ...(typeof update?.invitationsEnabled === 'boolean' ? { invitationsEnabled: update.invitationsEnabled } : {}),
      ...(typeof update?.diagnosticsEnabled === 'boolean' ? { diagnosticsEnabled: update.diagnosticsEnabled } : {}) } }
    memoryProfiles.set(name, fallback)
    return memoryOnly(structuredClone(fallback))
  }
  return { read: () => access(), updatePreferences: update => access(update) }
}
