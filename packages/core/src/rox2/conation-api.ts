/**
 * Versioned Conation API catalog (ROX-AUD-012 / #333).
 *
 * Extends the existing Rox2 typed-record contract. This is not a second
 * entity/result model and does not claim live Conation / Drive / Mail.
 * Writes and subscriptions stay fail-closed until a later confirmed schema.
 */

import {
  parseRox2TypedRecord,
  type Rox2TypedParseResult,
  type Rox2TypedRecord,
} from './platform-contract.ts'

export const CONATION_API_SCHEMA_VERSION = 1

export const CONATION_OPERATION_KINDS = ['read', 'write', 'subscribe'] as const
export type ConationOperationKind = (typeof CONATION_OPERATION_KINDS)[number]

export const CONATION_PAGINATION = ['none', 'cursor', 'bins'] as const
export type ConationPagination = (typeof CONATION_PAGINATION)[number]

export type ConationConfirmedOperation = {
  id: string
  kind: 'read'
  pagination: ConationPagination
  owner: 'soup' | 'dss'
}

export const CONATION_CONFIRMED_OPERATIONS = [
  { id: 'soup.ping', kind: 'read', pagination: 'none', owner: 'soup' },
  { id: 'soup.queryUserSoupPage', kind: 'read', pagination: 'cursor', owner: 'soup' },
  { id: 'soup.queryUserGroupedSoup', kind: 'read', pagination: 'bins', owner: 'soup' },
  { id: 'dss.listProjects', kind: 'read', pagination: 'none', owner: 'dss' },
  { id: 'dss.listEntries', kind: 'read', pagination: 'cursor', owner: 'dss' },
  { id: 'dss.getEntryMeta', kind: 'read', pagination: 'none', owner: 'dss' },
  { id: 'dss.getEntryContent', kind: 'read', pagination: 'none', owner: 'dss' },
] as const satisfies readonly ConationConfirmedOperation[]

export type ConationBlockedOperation = {
  id: string
  reason: string
}

export const CONATION_BLOCKED_OPERATIONS: readonly ConationBlockedOperation[] = [
  { id: 'soup.mutate', reason: 'CompleteMutationRoot is not a confirmed write schema' },
  { id: 'soup.subscribe', reason: 'soupUpdates types exist; no live subscription client' },
  { id: 'dss.write', reason: 'DSS client has no upload/delete/move helpers' },
  { id: 'drive.*', reason: 'Drive is not a claimed live product' },
  { id: 'mail.*', reason: 'Mail is not a claimed live product' },
]

export type ConationOperationResolution =
  | { status: 'confirmed'; operation: ConationConfirmedOperation }
  | { status: 'blocked'; reason: string }
  | { status: 'unknown'; reason: string }

function blockedPrefixMatch(id: string): ConationBlockedOperation | undefined {
  return CONATION_BLOCKED_OPERATIONS.find((op) => {
    if (op.id.endsWith('.*')) return id.startsWith(op.id.slice(0, -1))
    return op.id === id
  })
}

export function resolveConationOperation(id: string): ConationOperationResolution {
  const confirmed = CONATION_CONFIRMED_OPERATIONS.find((op) => op.id === id)
  if (confirmed) return { status: 'confirmed', operation: confirmed }
  const blocked = blockedPrefixMatch(id)
  if (blocked) return { status: 'blocked', reason: blocked.reason }
  return { status: 'unknown', reason: `Unconfirmed Conation operation: ${id}` }
}

export type ConationRecordStore = {
  get(id: string): unknown | undefined
  set(id: string, record: Rox2TypedRecord): void
}

export type ConationIngestResult =
  | { status: 'ok'; record: Rox2TypedRecord }
  | { status: 'rejected'; code: 'unsupported-version' | 'invalid' | 'blocked-write'; preserved: unknown }

const KNOWN_TYPED_KEYS = new Set(['schemaVersion', 'kind', 'system', 'properties', 'unknownFields'])

function collectUnknownFields(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_TYPED_KEYS.has(key)) extra[key] = value
  }
  const declared =
    raw.unknownFields && typeof raw.unknownFields === 'object' && !Array.isArray(raw.unknownFields)
      ? (raw.unknownFields as Record<string, unknown>)
      : {}
  const merged = { ...declared, ...extra }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** Read ingest: unknown fields are kept. Incompatible versions never mutate the store. */
export function ingestConationRecord(
  store: ConationRecordStore,
  id: string,
  raw: unknown,
): ConationIngestResult {
  const parsed: Rox2TypedParseResult = parseRox2TypedRecord(raw)
  if (!parsed.ok) {
    return { status: 'rejected', code: parsed.code, preserved: parsed.preserved }
  }
  const envelope = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const record: Rox2TypedRecord = {
    ...parsed.record,
    unknownFields: collectUnknownFields(envelope),
  }
  store.set(id, record)
  return { status: 'ok', record }
}

/** Writes stay fail-closed. The original payload is preserved; the store is untouched. */
export function applyConationWrite(
  store: ConationRecordStore,
  operationId: string,
  payload: unknown,
): ConationIngestResult {
  void store
  void resolveConationOperation(operationId)
  return { status: 'rejected', code: 'blocked-write', preserved: payload }
}

export function isConfirmedConationRead(id: string): boolean {
  const resolved = resolveConationOperation(id)
  return resolved.status === 'confirmed' && resolved.operation.kind === 'read'
}
