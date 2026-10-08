/**
 * W1-02 — Local entity-link store.
 *
 * One SQLite database per workspace at `<root>/.craft/entity-links.sqlite`
 * (WAL). Links dedupe on `(from, relation, to)`; backlinks query the
 * `(to_kind, to_id)` index. The flag `entities.links.v1` gates all handlers
 * that use this store, so nothing runs when the flag is off.
 */

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ENTITY_LINK_SCHEMA_VERSION,
  entityLinkDedupeKey,
  type EntityLink,
  type EntityLinkAnchor,
  type EntityRef,
  type EntityRelation,
} from '@rox/core/entities'

export interface EntityLinkStoreOptions {
  workspaceRoot: string
}

export interface AddEntityLinkInput {
  from: EntityRef
  to: EntityRef
  relation: EntityRelation
  role?: string
  anchor?: EntityLinkAnchor
  createdBy: string
}

export interface RemoveEntityLinkInput {
  from: EntityRef
  to: EntityRef
  relation: EntityRelation
}

export interface BacklinkQuery {
  kinds?: string[]
  relations?: string[]
  cursor?: string
  limit?: number
}

export interface BacklinkPage {
  links: EntityLink[]
  nextCursor?: string
}

interface LinkRow {
  link_id: string
  from_kind: string
  from_id: string
  from_fragment: string | null
  to_kind: string
  to_id: string
  to_fragment: string | null
  relation: string
  role: string | null
  anchor_block_id: string | null
  anchor_seq: number | null
  anchor_line: number | null
  anchor_target_id: string | null
  created_by: string
  created_at: string
  revision: number
}

const DEFAULT_BACKLINK_LIMIT = 200
const MAX_BACKLINK_LIMIT = 1000

function rowToLink(row: LinkRow): EntityLink {
  const anchor: EntityLinkAnchor = {}
  if (row.anchor_block_id) anchor.blockId = row.anchor_block_id
  if (row.anchor_seq !== null) anchor.seq = row.anchor_seq
  if (row.anchor_line !== null) anchor.line = row.anchor_line
  if (row.anchor_target_id) anchor.targetId = row.anchor_target_id
  const link: EntityLink = {
    linkId: row.link_id,
    from: row.from_fragment
      ? { kind: row.from_kind as EntityLink['from']['kind'], id: row.from_id, fragment: row.from_fragment }
      : { kind: row.from_kind as EntityLink['from']['kind'], id: row.from_id },
    to: row.to_fragment
      ? { kind: row.to_kind as EntityLink['to']['kind'], id: row.to_id, fragment: row.to_fragment }
      : { kind: row.to_kind as EntityLink['to']['kind'], id: row.to_id },
    relation: row.relation as EntityRelation,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revision: row.revision,
  }
  if (row.role) link.role = row.role
  if (Object.keys(anchor).length > 0) link.anchor = anchor
  return link
}

export class EntityLinkStore {
  private readonly db: DatabaseSync
  readonly dbPath: string

  constructor(options: EntityLinkStoreOptions) {
    const dir = join(options.workspaceRoot, '.craft')
    mkdirSync(dir, { recursive: true })
    this.dbPath = join(dir, 'entity-links.sqlite')
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_links (
        link_id TEXT PRIMARY KEY,
        from_kind TEXT NOT NULL, from_id TEXT NOT NULL, from_fragment TEXT,
        to_kind TEXT NOT NULL, to_id TEXT NOT NULL, to_fragment TEXT,
        relation TEXT NOT NULL, role TEXT,
        anchor_block_id TEXT, anchor_seq INTEGER, anchor_line INTEGER, anchor_target_id TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS entity_links_to ON entity_links(to_kind, to_id);
      CREATE INDEX IF NOT EXISTS entity_links_from ON entity_links(from_kind, from_id);
    `)
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0
    if (version === 0) this.db.exec(`PRAGMA user_version=${ENTITY_LINK_SCHEMA_VERSION}`)
  }

  /** Upsert a link by `(from, relation, to)`; returns the stored record. */
  add(input: AddEntityLinkInput): EntityLink {
    const dedupeKey = entityLinkDedupeKey(input)
    const existing = this.db
      .prepare('SELECT link_id, created_at, revision FROM entity_links WHERE dedupe_key=?')
      .get(dedupeKey) as { link_id: string; created_at: string; revision: number } | undefined
    const linkId = existing?.link_id ?? `lnk_${randomUUID()}`
    const createdAt = existing?.created_at ?? new Date().toISOString()
    const revision = (existing?.revision ?? 0) + 1
    const anchor = input.anchor ?? {}
    this.db
      .prepare(
        `INSERT INTO entity_links (
           link_id, from_kind, from_id, from_fragment, to_kind, to_id, to_fragment,
           relation, role, anchor_block_id, anchor_seq, anchor_line, anchor_target_id,
           created_by, created_at, revision, dedupe_key
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(dedupe_key) DO UPDATE SET
           role=excluded.role, anchor_block_id=excluded.anchor_block_id, anchor_seq=excluded.anchor_seq,
           anchor_line=excluded.anchor_line, anchor_target_id=excluded.anchor_target_id, revision=excluded.revision`,
      )
      .run(
        linkId,
        input.from.kind,
        input.from.id,
        input.from.fragment ?? null,
        input.to.kind,
        input.to.id,
        input.to.fragment ?? null,
        input.relation,
        input.role ?? null,
        anchor.blockId ?? null,
        anchor.seq ?? null,
        anchor.line ?? null,
        anchor.targetId ?? null,
        input.createdBy,
        createdAt,
        revision,
        dedupeKey,
      )
    return this.readByDedupe(dedupeKey)!
  }

  /** Remove a link by `(from, relation, to)`; true when a row was deleted. */
  remove(input: RemoveEntityLinkInput): boolean {
    const result = this.db.prepare('DELETE FROM entity_links WHERE dedupe_key=?').run(entityLinkDedupeKey(input))
    return Number(result.changes) > 0
  }

  /** Links originating at `ref`. */
  outgoing(ref: EntityRef): EntityLink[] {
    const rows = this.db
      .prepare('SELECT * FROM entity_links WHERE from_kind=? AND from_id=? ORDER BY created_at ASC')
      .all(ref.kind, ref.id) as unknown as LinkRow[]
    return rows.map(rowToLink)
  }

  /** Links pointing at `ref`, filtered and paginated by link id. */
  backlinks(ref: EntityRef, query: BacklinkQuery = {}): BacklinkPage {
    const limit = Math.min(query.limit ?? DEFAULT_BACKLINK_LIMIT, MAX_BACKLINK_LIMIT)
    const clauses = ['to_kind=?', 'to_id=?']
    const params: Array<string | number> = [ref.kind, ref.id]
    if (query.kinds && query.kinds.length > 0) {
      clauses.push(`to_kind IN (${query.kinds.map(() => '?').join(',')})`)
      params.push(...query.kinds)
    }
    if (query.relations && query.relations.length > 0) {
      clauses.push(`relation IN (${query.relations.map(() => '?').join(',')})`)
      params.push(...query.relations)
    }
    if (query.cursor) {
      clauses.push('link_id > ?')
      params.push(query.cursor)
    }
    const rows = this.db
      .prepare(`SELECT * FROM entity_links WHERE ${clauses.join(' AND ')} ORDER BY link_id ASC LIMIT ?`)
      .all(...params, limit + 1) as unknown as LinkRow[]
    const page = rows.slice(0, limit).map(rowToLink)
    const nextCursor = rows.length > limit ? page[page.length - 1]?.linkId : undefined
    return nextCursor ? { links: page, nextCursor } : { links: page }
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM entity_links').get() as { n: number } | undefined
    return row?.n ?? 0
  }

  close(): void {
    this.db.close()
  }

  private readByDedupe(dedupeKey: string): EntityLink | undefined {
    const row = this.db.prepare('SELECT * FROM entity_links WHERE dedupe_key=?').get(dedupeKey) as unknown as LinkRow | undefined
    return row ? rowToLink(row) : undefined
  }
}

const stores = new Map<string, EntityLinkStore>()

/** Memoized per-workspace store; call `closeEntityLinkStores` on teardown. */
export function getEntityLinkStore(workspaceRoot: string): EntityLinkStore {
  const existing = stores.get(workspaceRoot)
  if (existing) return existing
  const created = new EntityLinkStore({ workspaceRoot })
  stores.set(workspaceRoot, created)
  return created
}

export function closeEntityLinkStores(): void {
  for (const store of stores.values()) store.close()
  stores.clear()
}