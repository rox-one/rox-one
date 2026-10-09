/**
 * W1-06 (#1503) — Local work store: `{workspaceRoot}/work/<collection>/<id>.json`.
 *
 * Holds the local-authority records of the work domain that have no other
 * local home: goals, targets, checks, OKR cycles, check-ins, reviews, KPIs,
 * milestones (MIG-05), task lists / sections / groups, and the reference
 * records of every other module until its wave-2 package ships its own store.
 * Personal tasks stay in the PersonalTask v3 store; links stay in the W1-02
 * entity-link store.
 *
 * File format: `{ id, collection, revision, schemaVersion, record, deleted? }`.
 * Writes are atomic (tmp file + rename) and compare-and-set on `revision`.
 * Directories are created 0700 and files 0600 (same policy as `.rox/`).
 *
 * File names are case-unique (`encodeWorkId` escapes upper case), so ids that
 * differ only in case never share a file on a case-insensitive filesystem.
 * Names are also portable: Windows reserved device stems (`con`, `nul`,
 * `com1`, …) get their first character escaped, a trailing `.` is escaped,
 * and names longer than {@link MAX_ENCODED_NAME} are truncated with a sha256
 * suffix (`~<hash>`; `~` never appears literally otherwise) — the real id is
 * always the one stored inside the file. Files written under earlier
 * encodings (first build: upper case literal; round 2: no reserved / length
 * handling) are still read; a write moves them to the current name.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const LOCAL_WORK_DIR = 'work'
export const LOCAL_WORK_SCHEMA_VERSION = 1

export interface LocalWorkRecord<T = Record<string, unknown>> {
  id: string
  collection: string
  revision: number
  schemaVersion: number
  record: T
  deleted?: boolean
}

export type LocalWorkPutResult<T> =
  | { status: 'accepted'; file: LocalWorkRecord<T> }
  | { status: 'conflict'; current: LocalWorkRecord<T> | null }

const COLLECTION_RE = /^[a-z][a-z0-9-]{0,63}$/

function encodeWith(id: string, literal: RegExp): string {
  if (!id || id.length > 256) throw new TypeError('Invalid work record id')
  const encoded = Array.from(new TextEncoder().encode(id), byte => {
    const char = String.fromCharCode(byte)
    return literal.test(char) || (char === '.' && id !== '.' && id !== '..') ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
  return encoded.startsWith('.') ? `%2E${encoded.slice(1)}` : encoded
}

/** Longest encoded file stem kept verbatim (well under the 255-byte name limit with `.json` / tmp suffixes). */
export const MAX_ENCODED_NAME = 160
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i

/**
 * Filesystem-safe, case-unique id encoding: `%XX` for anything outside
 * `[a-z0-9._-]` (upper case too, so `Goal` and `goal` never collide on a
 * case-insensitive filesystem), Windows reserved stems and a trailing `.`
 * escaped, overlong names hash-suffixed. Reversible with `decodeURIComponent`
 * except for hash-suffixed names (read the id stored in the file).
 */
export function encodeWorkId(id: string): string {
  let encoded = previousEncodeWorkId(id)
  const stem = encoded.split('.')[0] ?? ''
  if (WINDOWS_RESERVED_STEM.test(stem)) encoded = `%${encoded.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}${encoded.slice(1)}`
  if (encoded.endsWith('.')) encoded = `${encoded.slice(0, -1)}%2E`
  if (encoded.length > MAX_ENCODED_NAME) {
    // Never cut through a `%XX` escape.
    const head = encoded.slice(0, MAX_ENCODED_NAME - 34).replace(/%[0-9A-F]?$/, '')
    encoded = `${head}~${createHash('sha256').update(id).digest('hex').slice(0, 32)}`
  }
  return encoded
}

/** The round-2 encoding (case-unique, no reserved-name / length handling): read and migrated on write. */
export function previousEncodeWorkId(id: string): string {
  return encodeWith(id, /[a-z0-9_-]/)
}

/** The first W1-06 encoding (upper case literal): read and migrated on write. */
export function legacyEncodeWorkId(id: string): string {
  return encodeWith(id, /[A-Za-z0-9_-]/)
}

export function decodeWorkId(name: string): string {
  return decodeURIComponent(name)
}

export class LocalWorkStore {
  readonly root: string

  constructor(options: { workspaceRoot: string }) {
    this.root = join(options.workspaceRoot, LOCAL_WORK_DIR)
  }

  path(collection: string, id: string): string {
    return join(this.collectionDir(collection), `${encodeWorkId(id)}.json`)
  }

  /** Pre-case-unique file name of `id` (equal to `path` for ids without upper case). */
  legacyPath(collection: string, id: string): string {
    return join(this.collectionDir(collection), `${legacyEncodeWorkId(id)}.json`)
  }

  /** Every file name `id` may live under: current first, then earlier encodings. */
  private candidatePaths(collection: string, id: string): string[] {
    const dir = this.collectionDir(collection)
    return [...new Set([encodeWorkId(id), previousEncodeWorkId(id), legacyEncodeWorkId(id)])].map(name => join(dir, `${name}.json`))
  }

  get<T = Record<string, unknown>>(collection: string, id: string): LocalWorkRecord<T> | null {
    // parseRecord checks the stored id: on a case-insensitive filesystem an
    // older name can resolve to another record's file.
    for (const path of this.candidatePaths(collection, id)) {
      if (!existsSync(path)) continue
      const record = parseRecord<T>(readFileSync(path, 'utf8'), collection, id)
      if (record) return record
    }
    return null
  }

  list<T = Record<string, unknown>>(collection: string): LocalWorkRecord<T>[] {
    const dir = this.collectionDir(collection)
    if (!existsSync(dir)) return []
    const out: LocalWorkRecord<T>[] = []
    const seen = new Set<string>()
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue
      // The stored id is authoritative (hash-suffixed names do not decode to it).
      let id: string | undefined = storedId(join(dir, name))
      if (id === undefined) {
        try { id = decodeWorkId(name.slice(0, -5)) } catch { continue }
      }
      // A record can be listed under its legacy and its new name (mid-migration).
      if (seen.has(id)) continue
      const record = this.get<T>(collection, id)
      if (!record) continue
      seen.add(id)
      out.push(record)
    }
    return out
  }

  /** CAS write: `expectedRevision` null = create-only. The new revision is `expected + 1`. */
  put<T = Record<string, unknown>>(collection: string, id: string, record: T, expectedRevision: number | null, options: { deleted?: boolean } = {}): LocalWorkPutResult<T> {
    const current = this.get<T>(collection, id)
    if ((current?.revision ?? null) !== expectedRevision) return { status: 'conflict', current }
    const file: LocalWorkRecord<T> = {
      id,
      collection,
      revision: (current?.revision ?? 0) + 1,
      schemaVersion: LOCAL_WORK_SCHEMA_VERSION,
      record,
      ...(options.deleted ? { deleted: true } : {}),
    }
    this.write(file)
    return { status: 'accepted', file }
  }

  /** Write a record verbatim (migrations: keeps the given revision). */
  write<T>(file: LocalWorkRecord<T>): void {
    const dir = this.collectionDir(file.collection)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = this.path(file.collection, file.id)
    // Case-insensitive filesystem: the new name can resolve to a legacy file of
    // another id (`Goal.json` for `goal`). Move that record to its own new name first.
    const occupant = existsSync(path) ? storedId(path) : undefined
    if (occupant !== undefined && occupant !== file.id) {
      atomicWrite(this.path(file.collection, occupant), readFileSync(path, 'utf8'))
      unlinkSync(path)
    }
    atomicWrite(path, `${JSON.stringify(file, null, 2)}\n`)
    for (const older of this.candidatePaths(file.collection, file.id)) {
      if (older !== path && existsSync(older) && storedId(older) === file.id) unlinkSync(older)
    }
  }

  /** Hard delete (association rows): the new and the legacy file of `id`. */
  remove(collection: string, id: string): boolean {
    let removed = false
    for (const path of this.candidatePaths(collection, id)) {
      if (!existsSync(path) || storedId(path) !== id) continue
      unlinkSync(path)
      removed = true
    }
    return removed
  }

  private collectionDir(collection: string): string {
    if (!COLLECTION_RE.test(collection)) throw new TypeError(`Invalid work collection: ${collection}`)
    return join(this.root, collection)
  }
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, path)
}

/** The id stored in a record file (undefined when unreadable). */
function storedId(path: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : undefined
  } catch {
    return undefined
  }
}

function parseRecord<T>(text: string, collection: string, id: string): LocalWorkRecord<T> | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<LocalWorkRecord<T>>
  if (value.id !== id || typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1) return null
  if (!value.record || typeof value.record !== 'object') return null
  return {
    id,
    collection,
    revision: value.revision,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : LOCAL_WORK_SCHEMA_VERSION,
    record: value.record,
    ...(value.deleted === true ? { deleted: true } : {}),
  }
}
