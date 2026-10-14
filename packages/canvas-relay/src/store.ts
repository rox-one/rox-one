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
  constructor(path: string) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(`CREATE TABLE IF NOT EXISTS snapshots (room TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, data BLOB NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_room ON updates(room, seq);`)
  }

  load(room: string): Y.Doc {
    const doc = new Y.Doc()
    const snap = this.db.query('SELECT state FROM snapshots WHERE room = ?').get(room) as { state: Uint8Array } | null
    if (snap) Y.applyUpdate(doc, new Uint8Array(snap.state))
    for (const row of this.db.query('SELECT data FROM updates WHERE room = ? ORDER BY seq').all(room) as { data: Uint8Array }[]) {
      Y.applyUpdate(doc, new Uint8Array(row.data))
    }
    this.counts.set(room, (this.db.query('SELECT COUNT(*) AS n FROM updates WHERE room = ?').get(room) as { n: number }).n)
    return doc
  }

  append(room: string, update: Uint8Array): number {
    this.db.query('INSERT INTO updates (room, data, at) VALUES (?, ?, ?)').run(room, update, Date.now())
    const n = (this.counts.get(room) ?? 0) + 1
    this.counts.set(room, n)
    return n
  }

  compact(room: string, doc: Y.Doc): void {
    const state = Y.encodeStateAsUpdate(doc)
    this.db.transaction(() => {
      const max = (this.db.query('SELECT MAX(seq) AS m FROM updates WHERE room = ?').get(room) as { m: number | null }).m
      this.db.query('INSERT INTO snapshots (room, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(room) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').run(room, state, Date.now())
      if (max !== null) this.db.query('DELETE FROM updates WHERE room = ? AND seq <= ?').run(room, max)
    })()
    this.counts.set(room, 0)
  }

  /** Forget the in-memory counter when a room is unloaded. */
  forget(room: string): void { this.counts.delete(room) }

  close(): void { this.db.close() }
}
