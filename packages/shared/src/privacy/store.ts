/**
 * Append-only consent ledger persisted in CONFIG_DIR/privacy.json.
 * Existing users migrate with every purpose off — no fabricated consent.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'
import {
  CONSENT_SCHEMA_VERSION,
  CONSENT_PURPOSES,
  emptyPurposes,
  isConsentPurpose,
  type ConsentPurpose,
  type ConsentPurposes,
  type DeletionReceipt,
  type ExportReceipt,
  type PrivacyDto,
  type PrivacyState,
  type ProviderAccessConsent,
} from './types.ts'
import { isPurposeAllowed } from './policy.ts'

export const PRIVACY_FILE = 'privacy.json'

export function getPrivacyPath(configDir: string = resolveConfigDir()): string {
  return join(configDir, PRIVACY_FILE)
}

export function getDefaultPrivacyState(now = Date.now()): PrivacyState {
  return {
    version: 1,
    schemaVersion: CONSENT_SCHEMA_VERSION,
    purposes: emptyPurposes(),
    events: [
      {
        id: `consent_migrate_${now}`,
        at: now,
        purpose: '*',
        action: 'migrate-unset',
        schemaVersion: CONSENT_SCHEMA_VERSION,
        deletionStatus: 'none',
      },
    ],
    providerAccess: [],
    exports: [],
    deletions: [],
    migratedAt: now,
    updatedAt: now,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePurposes(raw: unknown): ConsentPurposes {
  const next = emptyPurposes()
  if (!isRecord(raw)) return next
  for (const purpose of CONSENT_PURPOSES) {
    next[purpose] = raw[purpose] === true
  }
  return next
}

export function parsePrivacyState(raw: unknown, now = Date.now()): PrivacyState {
  if (!isRecord(raw)) return getDefaultPrivacyState(now)
  const purposes = normalizePurposes(raw.purposes)
  const events = Array.isArray(raw.events)
    ? raw.events.filter((event): event is PrivacyState['events'][number] => {
        if (!isRecord(event)) return false
        return typeof event.id === 'string' && typeof event.at === 'number' && typeof event.action === 'string'
      })
    : []
  const providerAccess = Array.isArray(raw.providerAccess)
    ? raw.providerAccess.filter((item): item is ProviderAccessConsent => {
        if (!isRecord(item)) return false
        return (
          typeof item.id === 'string' &&
          typeof item.provider === 'string' &&
          typeof item.accountRef === 'string' &&
          Array.isArray(item.domains) &&
          item.domains.every((domain) => typeof domain === 'string') &&
          Array.isArray(item.dataScopes) &&
          item.dataScopes.every((scope) => typeof scope === 'string') &&
          Array.isArray(item.purposes) &&
          item.purposes.every((purpose) => typeof purpose === 'string') &&
          typeof item.grantedAt === 'number' &&
          (item.revokedAt === null || typeof item.revokedAt === 'number') &&
          Number.isSafeInteger(item.revision)
        )
      })
    : []
  const exports = Array.isArray(raw.exports) ? (raw.exports as ExportReceipt[]) : []
  const deletions = Array.isArray(raw.deletions) ? (raw.deletions as DeletionReceipt[]) : []
  const migratedAt = typeof raw.migratedAt === 'number' ? raw.migratedAt : now
  return {
    version: 1,
    schemaVersion: CONSENT_SCHEMA_VERSION,
    purposes,
    events,
    providerAccess,
    exports,
    deletions,
    migratedAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

export function loadPrivacyState(configDir: string = resolveConfigDir()): PrivacyState {
  const path = getPrivacyPath(configDir)
  if (!existsSync(path)) {
    const fresh = getDefaultPrivacyState()
    savePrivacyState(fresh, configDir)
    return fresh
  }
  try {
    return parsePrivacyState(readJsonFileSync(path))
  } catch {
    const recovered = getDefaultPrivacyState()
    savePrivacyState(recovered, configDir)
    return recovered
  }
}

export function savePrivacyState(state: PrivacyState, configDir: string = resolveConfigDir()): void {
  const path = getPrivacyPath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

export function setPurpose(
  purpose: ConsentPurpose,
  granted: boolean,
  configDir: string = resolveConfigDir(),
  now = Date.now(),
): PrivacyState {
  if (!isConsentPurpose(purpose)) throw new Error(`Unknown consent purpose: ${purpose}`)
  const state = loadPrivacyState(configDir)
  const nextGranted = granted === true
  if (state.purposes[purpose] === nextGranted) return state
  state.purposes[purpose] = nextGranted
  if (purpose === 'accountRecoveryReplica' && !nextGranted) {
    state.purposes.realtimeSync = false
  }
  if (purpose === 'realtimeSync' && nextGranted && !state.purposes.accountRecoveryReplica) {
    state.purposes.realtimeSync = false
    throw new Error('realtime sync requires account recovery replica consent')
  }
  state.events.push({
    id: `consent_${purpose}_${now}`,
    at: now,
    purpose,
    action: nextGranted ? 'grant' : 'revoke',
    schemaVersion: CONSENT_SCHEMA_VERSION,
    deletionStatus: 'none',
  })
  state.updatedAt = now
  savePrivacyState(state, configDir)
  return state
}

export function requestExport(
  configDir: string = resolveConfigDir(),
  now = Date.now(),
): { state: PrivacyState; receipt: ExportReceipt; bundle: Record<string, unknown> } {
  const state = loadPrivacyState(configDir)
  const exportDir = join(configDir, 'privacy-exports')
  mkdirSync(exportDir, { recursive: true })
  const receipt: ExportReceipt = {
    id: `export_${randomUUID()}`,
    requestedAt: now,
    completedAt: now,
    path: join(exportDir, `rox-privacy-${now}.json`),
    excluded: ['credentials', 'cookies', 'passkeys'],
  }
  const bundle = {
    schemaVersion: CONSENT_SCHEMA_VERSION,
    generatedAt: now,
    purposes: state.purposes,
    events: state.events,
    deletions: state.deletions,
    excluded: receipt.excluded,
  }
  atomicWriteFileSync(receipt.path, `${JSON.stringify(bundle, null, 2)}\n`)
  state.exports = [...state.exports, receipt]
  state.updatedAt = now
  savePrivacyState(state, configDir)
  return { state, receipt, bundle }
}

export function requestDeletion(
  configDir: string = resolveConfigDir(),
  now = Date.now(),
): { state: PrivacyState; receipt: DeletionReceipt } {
  const state = loadPrivacyState(configDir)
  const receipt: DeletionReceipt = {
    id: `deletion_${randomUUID()}`,
    status: 'queued',
    requestedAt: now,
    localDataKept: true,
    remoteSla: 'queued-immediately',
    purposes: [...CONSENT_PURPOSES],
  }
  state.deletions = [...state.deletions, receipt]
  state.updatedAt = now
  savePrivacyState(state, configDir)
  return { state, receipt }
}

export function completeDeletion(
  deletionId: string,
  configDir: string = resolveConfigDir(),
  now = Date.now(),
): PrivacyState {
  const state = loadPrivacyState(configDir)
  const index = state.deletions.findIndex((row) => row.id === deletionId)
  if (index < 0) throw new Error('deletion receipt not found')
  const current = state.deletions[index]
  if (!current) throw new Error('deletion receipt not found')
  state.deletions[index] = { ...current, status: 'completed', completedAt: now, localDataKept: true }
  state.updatedAt = now
  savePrivacyState(state, configDir)
  return state
}

export function latestDeletion(state: PrivacyState): DeletionReceipt | null {
  return state.deletions.length === 0 ? null : state.deletions[state.deletions.length - 1] ?? null
}

export function purposeEnabled(state: PrivacyState, purpose: ConsentPurpose): boolean {
  return isPurposeAllowed(state.purposes, purpose)
}

export function setProviderAccessConsent(input: {
  provider: string
  accountRef: string
  domains: readonly string[]
  dataScopes: readonly string[]
  purposes: readonly string[]
  granted: boolean
}, configDir: string = resolveConfigDir(), now = Date.now()): PrivacyState {
  const provider = input.provider.trim()
  const accountRef = input.accountRef.trim()
  if (!provider || !accountRef) throw new Error('provider and account reference are required')
  const state = loadPrivacyState(configDir)
  const records = state.providerAccess.filter(
    (entry) => entry.provider === provider && entry.accountRef === accountRef,
  )
  const matching = records.filter((entry) => entry.revokedAt === null)
  if (!input.granted) {
    if (matching.length === 0) return state
    for (const entry of matching) entry.revokedAt = now
    state.updatedAt = now
    savePrivacyState(state, configDir)
    return state
  }
  const domains = [...new Set(input.domains.map((domain) => domain.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))]
  const dataScopes = [...new Set(input.dataScopes.map((scope) => scope.trim()).filter(Boolean))]
  const purposes = [...new Set(input.purposes.map((purpose) => purpose.trim()).filter(Boolean))]
  if (domains.length === 0 || dataScopes.length === 0 || purposes.length === 0) {
    throw new Error('provider consent requires domains, data scopes, and purposes')
  }
  for (const entry of matching) entry.revokedAt = now
  state.providerAccess.push({
    id: randomUUID(),
    provider,
    accountRef,
    domains,
    dataScopes,
    purposes,
    grantedAt: now,
    revokedAt: null,
    revision: records.reduce((revision, entry) => Math.max(revision, entry.revision), 0) + 1,
  })
  state.updatedAt = now
  savePrivacyState(state, configDir)
  return state
}

export function providerScopeAllowed(
  state: PrivacyState,
  provider: string,
  accountRef: string,
  domain: string,
  dataScope: string,
  purpose: string,
): boolean {
  const normalizedDomain = domain.trim().toLowerCase().replace(/^\./, '')
  return state.providerAccess.some(
    (entry) =>
      entry.provider === provider &&
      entry.accountRef === accountRef &&
      entry.revokedAt === null &&
      (entry.domains.includes('*') || entry.domains.includes(normalizedDomain)) &&
      entry.dataScopes.includes(dataScope) &&
      entry.purposes.includes(purpose),
  )
}

export function toPrivacyDto(state: PrivacyState): PrivacyDto {
  return {
    schemaVersion: state.schemaVersion,
    purposes: state.purposes,
    events: state.events,
    providerAccess: state.providerAccess,
    exports: state.exports,
    deletions: state.deletions,
    latestDeletion: latestDeletion(state),
    migratedAt: state.migratedAt,
    updatedAt: state.updatedAt,
  }
}
