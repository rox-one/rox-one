/**
 * W1-04 (#1501) — MIG-06: Dossier (renderer localStorage) → contact cards.
 *
 * The renderer exports its `rox.dossier.v1:<workspaceId>` payload once over
 * the `directory:exportDossier` IPC. This module validates it, maps every
 * dossier entity onto a `contact_card` (person / company), writes the cards
 * to the offline store and reads them back. The result carries
 * `verified: true` only when every imported card is present and identical on
 * disk — the renderer may delete its localStorage key only then (the delete
 * itself belongs to the wave-2 PPL package).
 *
 * Idempotent: card ids are derived from (workspace, dossier id); re-running
 * the import updates changed cards (revision + 1) and leaves equal ones.
 * Nothing is invented: only entities present in the payload become cards and
 * a person's `org` links to a company card only when that company exists in
 * the same payload.
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ContactCardStore } from './store.ts'
import type { ContactCard } from './types.ts'

export const DOSSIER_EXPORT_SCHEMA_VERSION = 1
export const MAX_DOSSIER_ENTITIES = 5000
const MAX_TEXT = 20_000
const MAX_SHORT = 1_000
const MAX_LIST = 200

export interface DossierPromiseExport {
  id: string
  text: string
  direction: 'mine' | 'theirs'
  done: boolean
  createdAt: number
}

export interface DossierEntityExport {
  id: string
  name: string
  kind: 'person' | 'company'
  org?: string
  aliases: string[]
  notes: string
  promises: DossierPromiseExport[]
  briefSessionId?: string
  createdAt: number
  updatedAt: number
}

export type DossierParseError = 'INVALID_PAYLOAD' | 'TOO_LARGE' | 'UNSUPPORTED_VERSION'

export class DossierImportError extends Error {
  constructor(readonly code: DossierParseError) {
    super(code)
    this.name = 'DossierImportError'
  }
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Validate the export envelope `{ schemaVersion: 1, data: { entities: [...] } }`.
 * Entity-level parsing is tolerant like the renderer's `normalizeDossierData`
 * (rows without id or name are skipped, never guessed).
 */
export function parseDossierExport(input: unknown): { entities: DossierEntityExport[]; skipped: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DossierImportError('INVALID_PAYLOAD')
  const envelope = input as Record<string, unknown>
  if (envelope.schemaVersion !== DOSSIER_EXPORT_SCHEMA_VERSION) throw new DossierImportError('UNSUPPORTED_VERSION')
  const data = envelope.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DossierImportError('INVALID_PAYLOAD')
  const list = (data as { entities?: unknown }).entities
  if (!Array.isArray(list)) throw new DossierImportError('INVALID_PAYLOAD')
  if (list.length > MAX_DOSSIER_ENTITIES) throw new DossierImportError('TOO_LARGE')
  const entities: DossierEntityExport[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') { skipped += 1; continue }
    const row = item as Record<string, unknown>
    const id = str(row.id, MAX_SHORT).trim()
    const name = str(row.name, MAX_SHORT).trim()
    if (!id || !name || seen.has(id)) { skipped += 1; continue }
    seen.add(id)
    const promises: DossierPromiseExport[] = Array.isArray(row.promises)
      ? row.promises.slice(0, MAX_LIST).flatMap((p): DossierPromiseExport[] => {
          if (!p || typeof p !== 'object') return []
          const pr = p as Record<string, unknown>
          const text = str(pr.text, MAX_TEXT).trim()
          if (!text) return []
          return [{
            id: str(pr.id, MAX_SHORT) || `p-${text.length}-${num(pr.createdAt)}`,
            text,
            direction: pr.direction === 'theirs' ? 'theirs' : 'mine',
            done: pr.done === true,
            createdAt: num(pr.createdAt),
          }]
        })
      : []
    const org = str(row.org, MAX_SHORT).trim()
    const briefSessionId = str(row.briefSessionId, MAX_SHORT)
    entities.push({
      id,
      name,
      kind: row.kind === 'company' ? 'company' : 'person',
      ...(org ? { org } : {}),
      aliases: Array.isArray(row.aliases) ? row.aliases.slice(0, MAX_LIST).map(a => str(a, MAX_SHORT).trim()).filter(Boolean) : [],
      notes: str(row.notes, MAX_TEXT),
      promises,
      ...(briefSessionId ? { briefSessionId } : {}),
      createdAt: num(row.createdAt),
      updatedAt: num(row.updatedAt),
    })
  }
  return { entities, skipped }
}

/** Deterministic UUID (v8 layout) from (workspace, dossier id) so re-imports are idempotent. */
export function dossierCardId(workspaceId: string, dossierId: string): string {
  const hex = createHash('sha256').update(`rox.dossier.v1\0${workspaceId}\0${dossierId}`).digest('hex')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** Map dossier entities to contact cards (pure; revision / timestamps settled by `importDossier`). */
export function dossierToContactCards(
  workspaceId: string,
  ownerId: string | null,
  entities: readonly DossierEntityExport[],
  nowMs: number,
): ContactCard[] {
  const companyByName = new Map<string, string>()
  for (const entity of entities) {
    if (entity.kind === 'company') companyByName.set(entity.name.toLocaleLowerCase('ru'), dossierCardId(workspaceId, entity.id))
  }
  return entities.map(entity => {
    const createdMs = entity.createdAt || nowMs
    const fields: Record<string, unknown> = {
      source: 'dossier',
      dossierId: entity.id,
      aliases: entity.aliases,
      promises: entity.promises,
    }
    if (entity.org) fields.org = entity.org
    if (entity.briefSessionId) fields.briefSessionId = entity.briefSessionId
    const companyCardId = entity.kind === 'person' && entity.org
      ? companyByName.get(entity.org.toLocaleLowerCase('ru')) ?? null
      : null
    return {
      contactCardId: dossierCardId(workspaceId, entity.id),
      workspaceId,
      ownerScope: 'personal',
      ownerId,
      kind: entity.kind,
      principalId: null,
      companyCardId,
      displayName: entity.name,
      emails: [],
      phones: [],
      title: null,
      notes: entity.notes ? entity.notes : null,
      fields,
      touches: [],
      revision: 1,
      createdAt: iso(createdMs),
      updatedAt: iso(entity.updatedAt || createdMs),
    }
  })
}

export interface DossierImportResult {
  total: number
  created: number
  updated: number
  unchanged: number
  skipped: number
  /** Every imported card was read back from disk and matched. */
  verified: boolean
  /** sha256 over the imported card ids + content, for the renderer's audit trail. */
  checksum: string
}

/** Content equality ignoring the bookkeeping fields the store owns. */
function sameContent(a: ContactCard, b: ContactCard): boolean {
  const strip = ({ revision: _r, updatedAt: _u, createdAt: _c, ...rest }: ContactCard) => rest
  return isDeepStrictEqual(strip(a), strip(b))
}

export function importDossier(
  store: ContactCardStore,
  input: unknown,
  options: { workspaceId: string; ownerId: string | null; now?: () => number },
): DossierImportResult {
  const { entities, skipped } = parseDossierExport(input)
  const nowMs = (options.now ?? Date.now)()
  const incoming = dossierToContactCards(options.workspaceId, options.ownerId, entities, nowMs)
  const existing = store.list()
  const byId = new Map(existing.map(card => [card.contactCardId, card]))
  let created = 0
  let updated = 0
  let unchanged = 0
  const written: ContactCard[] = []
  for (const card of incoming) {
    const previous = byId.get(card.contactCardId)
    if (!previous) {
      created += 1
      byId.set(card.contactCardId, card)
      written.push(card)
    } else if (sameContent(previous, card)) {
      unchanged += 1
      written.push(previous)
    } else {
      updated += 1
      const next = { ...card, createdAt: previous.createdAt, revision: previous.revision + 1, updatedAt: iso(nowMs) }
      byId.set(card.contactCardId, next)
      written.push(next)
    }
  }
  if (created + updated > 0) store.writeAll([...byId.values()])

  // Verified write: read back from disk and compare every imported card.
  const onDisk = new Map(store.list().map(card => [card.contactCardId, card]))
  const verified = written.every(card => isDeepStrictEqual(onDisk.get(card.contactCardId), card))
  const checksum = createHash('sha256')
    .update(JSON.stringify(written.map(card => [card.contactCardId, card.revision, card.displayName, card.kind])))
    .digest('hex')
  return { total: incoming.length, created, updated, unchanged, skipped, verified, checksum }
}
