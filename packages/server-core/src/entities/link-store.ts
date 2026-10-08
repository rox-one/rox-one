/**
 * W1-02 — Local entity-link store.
 *
 * One SQLite database per workspace at `<root>/.rox/entity-links.sqlite`
 * (WAL; never shipped — no migration from the unshipped `.craft` path).
 * Links dedupe on `(from, relation, to)`; backlinks query the
 * `(to_kind, to_id)` index. The flag `entities.links.v1` gates all handlers
 * that use this store, so nothing runs when the flag is off.
 */

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
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

/** One desired outgoing link for `replaceOutgoing`. */
export interface DesiredOutgoingLink {
  to: EntityRef
  relation: EntityRelation
  anchor?: EntityLinkAnchor
}

export interface ReplaceOutgoingResult {
  added: number
  updated: number
  removed: number
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

/** Private workspace-local directory (0700), mirroring other local stores under `.rox`. */
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private entity-link storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('Private entity-link storage is unavailable')
  }
  chmodSync(path, 0o700)
}

export class EntityLinkStore {
  private readonly db: DatabaseSync
  readonly dbPath: string

  constructor(options: EntityLinkStoreOptions) {
    const dir = join(options.workspaceRoot, '.rox')
    privateDirectory(dir)
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
    const anchor = input.anchor ?? {}
    const row = this.db
      .prepare(
        `INSERT INTO entity_links (
           link_id, from_kind, from_id, from_fragment, to_kind, to_id, to_fragment,
           relation, role, anchor_block_id, anchor_seq, anchor_line, anchor_target_id,
           created_by, created_at, revision, dedupe_key
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(dedupe_key) DO UPDATE SET
           role=excluded.role, anchor_block_id=excluded.anchor_block_id, anchor_seq=excluded.anchor_seq,
           anchor_line=excluded.anchor_line, anchor_target_id=excluded.anchor_target_id,
           revision=entity_links.revision + 1
         RETURNING *`,
      )
      .get(
        `lnk_${randomUUID()}`,
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
        new Date().toISOString(),
        1,
        dedupeKey,
      ) as unknown as LinkRow
    return rowToLink(row)
  }

  /** Remove a link by `(from, relation, to)`; true when a row was deleted. */
  remove(input: RemoveEntityLinkInput): boolean {
    const result = this.db.prepare('DELETE FROM entity_links WHERE dedupe_key=?').run(entityLinkDedupeKey(input))
    return Number(result.changes) > 0
  }

  /** Links originating at `ref`. Fragment is matched NULL-safe so siblings don't leak. */
  outgoing(ref: EntityRef): EntityLink[] {
    const rows = this.db
      .prepare('SELECT * FROM entity_links WHERE from_kind=? AND from_id=? AND from_fragment IS ? ORDER BY created_at ASC')
      .all(ref.kind, ref.id, ref.fragment ?? null) as unknown as LinkRow[]
    return rows.map(rowToLink)
  }

  /** Links pointing at `ref`, filtered and paginated by link id. Fragment is matched NULL-safe. */
  backlinks(ref: EntityRef, query: BacklinkQuery = {}): BacklinkPage {
    const limit = Math.min(query.limit ?? DEFAULT_BACKLINK_LIMIT, MAX_BACKLINK_LIMIT)
    const clauses = ['to_kind=?', 'to_id=?', 'to_fragment IS ?']
    const params: Array<string | number | null> = [ref.kind, ref.id, ref.fragment ?? null]
    if (query.kinds && query.kinds.length > 0) {
      clauses.push(`from_kind IN (${query.kinds.map(() => '?').join(',')})`)
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

  /**
   * Reconcile every outgoing link of `from` to exactly `desired`, atomically
   * (one IMMEDIATE transaction): new links are inserted, links whose anchor
   * moved are updated (revision bump), links no longer present are removed.
   * Idempotent: re-applying the same set writes nothing and reports zeros.
   * Duplicates in `desired` collapse to the first occurrence per
   * `(relation, to)`. Fragment of `from` is matched NULL-safe.
   */
  replaceOutgoing(from: EntityRef, desired: readonly DesiredOutgoingLink[], createdBy: string): ReplaceOutgoingResult {
    const wanted = new Map<string, DesiredOutgoingLink>()
    for (const link of desired) {
      const key = entityLinkDedupeKey({ from, relation: link.relation, to: link.to })
      if (!wanted.has(key)) wanted.set(key, link)
    }
    const result: ReplaceOutgoingResult = { added: 0, updated: 0, removed: 0 }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db
        .prepare('SELECT dedupe_key, anchor_block_id, anchor_seq, anchor_line, anchor_target_id FROM entity_links WHERE from_kind=? AND from_id=? AND from_fragment IS ?')
        .all(from.kind, from.id, from.fragment ?? null) as unknown as Array<Pick<LinkRow, 'anchor_block_id' | 'anchor_seq' | 'anchor_line' | 'anchor_target_id'> & { dedupe_key: string }>
      const remove = this.db.prepare('DELETE FROM entity_links WHERE dedupe_key=?')
      const present = new Map(existing.map(row => [row.dedupe_key, row]))
      for (const row of existing) {
        if (wanted.has(row.dedupe_key)) continue
        remove.run(row.dedupe_key)
        result.removed += 1
      }
      for (const [key, link] of wanted) {
        const anchor = link.anchor ?? {}
        const row = present.get(key)
        if (row) {
          const same = row.anchor_block_id === (anchor.blockId ?? null)
            && row.anchor_seq === (anchor.seq ?? null)
            && row.anchor_line === (anchor.line ?? null)
            && row.anchor_target_id === (anchor.targetId ?? null)
          if (same) continue
          result.updated += 1
        } else {
          result.added += 1
        }
        this.add({ from, to: link.to, relation: link.relation, anchor: link.anchor, createdBy })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
    return result
  }

  /** Remove every outgoing link of `from`; returns the number removed. */
  removeOutgoing(from: EntityRef): number {
    const changes = this.db
      .prepare('DELETE FROM entity_links WHERE from_kind=? AND from_id=? AND from_fragment IS ?')
      .run(from.kind, from.id, from.fragment ?? null).changes
    return Number(changes)
  }

  /**
   * Remove every outgoing link whose source is `kind` with an id starting
   * with `idPrefix` (e.g. all notes under a renamed folder `projects/`).
   * Exact prefix compare, no LIKE wildcards. Returns the number removed.
   */
  removeOutgoingByIdPrefix(kind: EntityRef['kind'], idPrefix: string): number {
    if (!idPrefix) return 0
    const changes = this.db
      .prepare('DELETE FROM entity_links WHERE from_kind=? AND substr(from_id, 1, ?) = ?')
      .run(kind, idPrefix.length, idPrefix).changes
    return Number(changes)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM entity_links').get() as { n: number } | undefined
    return row?.n ?? 0
  }

  close(): void {
    this.db.close()
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