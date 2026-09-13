/**
 * Versioned ROX2 ontology records (issue #321).
 * Adapters must quarantine unknown versions instead of dropping raw bytes.
 */

import { createHash } from 'node:crypto'
import {
  formatRox2EntityRef,
  isRox2EntityKind,
  parseRox2EntityRef,
  type Rox2EntityKind,
  type Rox2EntityRef,
  type Rox2EntitySource,
} from './platform-contract.ts'

export const ROX2_SCHEMA_VERSION = 1 as const

export const ROX2_ONTOLOGY_KINDS = [
  'session',
  'note',
  'task',
  'calendar-event',
  'person',
  'crm-company',
  'file',
  'outcome',
  'workflow',
] as const satisfies readonly Rox2EntityKind[]

export type Rox2OntologyKind = (typeof ROX2_ONTOLOGY_KINDS)[number]

export type Rox2SystemFields = {
  createdAt: number
  updatedAt: number
  source: Rox2EntitySource
}

export type Rox2OntologyRecord = {
  schemaVersion: typeof ROX2_SCHEMA_VERSION
  kind: Rox2OntologyKind
  ref: Rox2EntityRef
  system: Rox2SystemFields
  properties: Record<string, unknown>
}

export type Rox2QuarantineReason =
  | 'unknown-schema-version'
  | 'unsupported-kind'
  | 'invalid-date'
  | 'invalid-ref'
  | 'collision'

export type Rox2Quarantine = {
  reason: Rox2QuarantineReason
  sha256: string
  raw: unknown
}

export type Rox2OntologyResult =
  | { ok: true; record: Rox2OntologyRecord }
  | { ok: false; quarantine: Rox2Quarantine }

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const out: Record<string, unknown> = {}
    for (const [key, nested] of entries) out[key] = sortValue(nested)
    return out
  }
  return value
}

export function isRox2OntologyKind(value: string): value is Rox2OntologyKind {
  return (ROX2_ONTOLOGY_KINDS as readonly string[]).includes(value)
}

function isFiniteEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function asRef(value: unknown): Rox2EntityRef | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Record<string, unknown>
  if (typeof ref.workspaceId !== 'string' || !ref.workspaceId) return null
  if (typeof ref.entityId !== 'string' || !ref.entityId) return null
  if (typeof ref.revisionId !== 'string' || !ref.revisionId) return null
  return { workspaceId: ref.workspaceId, entityId: ref.entityId, revisionId: ref.revisionId }
}

export function quarantine(reason: Rox2QuarantineReason, raw: unknown): Rox2Quarantine {
  return { reason, sha256: sha256Json(raw), raw }
}

export function validateOntologyRecord(raw: unknown): Rox2OntologyResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, quarantine: quarantine('invalid-ref', raw) }
  }
  const rec = raw as Record<string, unknown>
  const schemaVersion = rec.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, quarantine: quarantine('unknown-schema-version', raw) }
  }
  if (schemaVersion !== ROX2_SCHEMA_VERSION) {
    return { ok: false, quarantine: quarantine('unknown-schema-version', raw) }
  }
  if (typeof rec.kind !== 'string' || !isRox2EntityKind(rec.kind) || !isRox2OntologyKind(rec.kind)) {
    return { ok: false, quarantine: quarantine('unsupported-kind', raw) }
  }
  const ref = asRef(rec.ref)
  if (!ref) return { ok: false, quarantine: quarantine('invalid-ref', raw) }
  try {
    parseRox2EntityRef(formatRox2EntityRef(rec.kind, ref))
  } catch {
    return { ok: false, quarantine: quarantine('invalid-ref', raw) }
  }
  const system = rec.system && typeof rec.system === 'object' ? (rec.system as Record<string, unknown>) : null
  if (!system || !isFiniteEpoch(system.createdAt) || !isFiniteEpoch(system.updatedAt)) {
    return { ok: false, quarantine: quarantine('invalid-date', raw) }
  }
  if (system.source !== 'native' && system.source !== 'conation' && system.source !== 'hybrid') {
    return { ok: false, quarantine: quarantine('invalid-ref', raw) }
  }
  const properties = rec.properties && typeof rec.properties === 'object' && !Array.isArray(rec.properties)
    ? { ...(rec.properties as Record<string, unknown>) }
    : {}
  return {
    ok: true,
    record: {
      schemaVersion: ROX2_SCHEMA_VERSION,
      kind: rec.kind,
      ref,
      system: {
        createdAt: system.createdAt,
        updatedAt: system.updatedAt,
        source: system.source,
      },
      properties,
    },
  }
}

export function createOntologyRecord(input: {
  kind: Rox2OntologyKind
  ref: Rox2EntityRef
  source?: Rox2EntitySource
  properties?: Record<string, unknown>
  now?: number
}): Rox2OntologyRecord {
  const now = input.now ?? Date.now()
  return {
    schemaVersion: ROX2_SCHEMA_VERSION,
    kind: input.kind,
    ref: input.ref,
    system: { createdAt: now, updatedAt: now, source: input.source ?? 'native' },
    properties: { ...(input.properties ?? {}) },
  }
}
