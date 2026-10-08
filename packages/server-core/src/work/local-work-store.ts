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
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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

/** Filesystem-safe, reversible id encoding (`%XX` for anything outside `[A-Za-z0-9._-]`). */
export function encodeWorkId(id: string): string {
  if (!id || id.length > 256) throw new TypeError('Invalid work record id')
  const encoded = Array.from(new TextEncoder().encode(id), byte => {
    const char = String.fromCharCode(byte)
    return /[A-Za-z0-9_-]/.test(char) || (char === '.' && id !== '.' && id !== '..') ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
  return encoded.startsWith('.') ? `%2E${encoded.slice(1)}` : encoded
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

  get<T = Record<string, unknown>>(collection: string, id: string): LocalWorkRecord<T> | null {
    const path = this.path(collection, id)
    if (!existsSync(path)) return null
    return parseRecord<T>(readFileSync(path, 'utf8'), collection, id)
  }

  list<T = Record<string, unknown>>(collection: string): LocalWorkRecord<T>[] {
    const dir = this.collectionDir(collection)
    if (!existsSync(dir)) return []
    const out: LocalWorkRecord<T>[] = []
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue
      let id: string
      try { id = decodeWorkId(name.slice(0, -5)) } catch { continue }
      const record = this.get<T>(collection, id)
      if (record) out.push(record)
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
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, path)
  }

  /** Hard delete (association rows). */
  remove(collection: string, id: string): boolean {
    const path = this.path(collection, id)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  }

  private collectionDir(collection: string): string {
    if (!COLLECTION_RE.test(collection)) throw new TypeError(`Invalid work collection: ${collection}`)
    return join(this.root, collection)
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
