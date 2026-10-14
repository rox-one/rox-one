/**
 * Durable per-room storage in SQLite (WAL): an append-only update log plus
 * periodic compacted snapshots. Nothing is hard-deleted: compaction replaces
 * the log rows it folded into the new snapshot, inside one transaction.
 */
import { Database } from 'bun:sqlite'
import * as Y from 'yjs'

export class RoomStore {
  private db: Database
  /** Rows per room in the update log (seeded from the DB on load, then kept in memory). */
  private counts = new Map<string, number>()
  /** Bytes per room in the update log. */
  private sizes = new Map<string, number>()
  constructor(path: string) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`CREATE TABLE IF NOT EXISTS snapshots (room TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, data BLOB NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_room ON updates(room, seq);
      CREATE TABLE IF NOT EXISTS quarantine (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, source TEXT NOT NULL, seq INTEGER, data BLOB NOT NULL, error TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS revocations (room TEXT NOT NULL, sub TEXT NOT NULL, epoch INTEGER NOT NULL, PRIMARY KEY (room, sub));`)
  }

  /**
   * Rows that fail to decode/apply are moved to `quarantine` (bytes kept, never
   * dropped) and loading continues with the rest. Each row is fully
   * decoded before it is applied, so malformed bytes never reach the room doc.
   */
  load(room: string): Y.Doc {
    const doc = new Y.Doc()
    const tryApply = (data: Uint8Array): string | null => {
      // Full decode first (cheap, no side effects): malformed bytes never touch the doc.
      try { Y.decodeUpdate(data) } catch (e) { return (e as Error).message || 'decode failed' }
      try { Y.applyUpdate(doc, data) } catch (e) { return (e as Error).message || 'apply failed' }
      return null
    }
    const snap = this.db.query('SELECT state FROM snapshots WHERE room = ?').get(room) as { state: Uint8Array } | null
    if (snap) {
      const err = tryApply(new Uint8Array(snap.state))
      if (err) this.db.query("INSERT INTO quarantine (room, source, seq, data, error, at) VALUES (?, 'snapshot', NULL, ?, ?, ?)").run(room, snap.state, err, Date.now())
    }
    for (const row of this.db.query('SELECT seq, data FROM updates WHERE room = ? ORDER BY seq').all(room) as { seq: number; data: Uint8Array }[]) {
      const err = tryApply(new Uint8Array(row.data))
      if (!err) continue
      this.db.transaction(() => {
        this.db.query("INSERT INTO quarantine (room, source, seq, data, error, at) VALUES (?, 'update', ?, ?, ?, ?)").run(room, row.seq, row.data, err, Date.now())
        this.db.query('DELETE FROM updates WHERE seq = ?').run(row.seq)
      })()
    }
    const agg = this.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM updates WHERE room = ?').get(room) as { n: number; b: number }
    this.counts.set(room, agg.n)
    this.sizes.set(room, agg.b)
    return doc
  }

  append(room: string, update: Uint8Array): number {
    this.db.query('INSERT INTO updates (room, data, at) VALUES (?, ?, ?)').run(room, update, Date.now())
    const n = (this.counts.get(room) ?? 0) + 1
    this.counts.set(room, n)
    this.sizes.set(room, (this.sizes.get(room) ?? 0) + update.length)
    return n
  }

  /** Rows and bytes currently in the room's update log. */
  logSize(room: string): { rows: number; bytes: number } {
    return { rows: this.counts.get(room) ?? 0, bytes: this.sizes.get(room) ?? 0 }
  }

  compact(room: string, doc: Y.Doc): void {
    const state = Y.encodeStateAsUpdate(doc)
    this.db.transaction(() => {
      const max = (this.db.query('SELECT MAX(seq) AS m FROM updates WHERE room = ?').get(room) as { m: number | null }).m
      this.db.query('INSERT INTO snapshots (room, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(room) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').run(room, state, Date.now())
      if (max !== null) this.db.query('DELETE FROM updates WHERE room = ? AND seq <= ?').run(room, max)
    })()
    this.counts.set(room, 0)
    this.sizes.set(room, 0)
  }

  /** Minimum token epoch for (room, sub); '*' revokes everyone in the room. */
  minEpoch(room: string, sub: string): number {
    const rows = this.db.query("SELECT epoch FROM revocations WHERE room = ? AND sub IN (?, '*')").all(room, sub) as { epoch: number }[]
    return rows.reduce((m, r) => Math.max(m, r.epoch), 0)
  }

  /** Raise the minimum epoch (never lowers it). */
  revoke(room: string, sub: string, epoch: number): void {
    this.db.query('INSERT INTO revocations (room, sub, epoch) VALUES (?, ?, ?) ON CONFLICT(room, sub) DO UPDATE SET epoch = MAX(epoch, excluded.epoch)').run(room, sub, epoch)
  }

  /** Forget the in-memory counter when a room is unloaded. */
  forget(room: string): void { this.counts.delete(room); this.sizes.delete(room) }

  /** Quarantined rows of a room (for operators / tests). */
  quarantined(room: string): Array<{ source: string; seq: number | null; error: string | null }> {
    return this.db.query('SELECT source, seq, error FROM quarantine WHERE room = ? ORDER BY id').all(room) as never
  }

  close(): void { this.db.close() }
}
