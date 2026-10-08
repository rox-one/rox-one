/**
 * W1-03 (#1500) — Server-side realtime cursors (`realtime_cursor`, W1-05).
 *
 * The gateway stores the last delivered `{ epoch, seq }` per (workspace,
 * principal, device, topic) when a client unsubscribes or disconnects, so
 * `subscribe({ resume: true })` continues without trusting a client offset.
 * Cursors are per device: two devices of one principal never overwrite each
 * other's position. The row id is derived from that key (`cursorId`), so a
 * save is one upsert (a disconnect writes all of a client's cursors in one
 * multi-row upsert). Only clients that opted into resume (`resume: true`)
 * persist cursors. Cursors bound to an older policy epoch or past
 * `expires_at` are ignored (→ snapshot).
 */

import { createHash } from 'node:crypto'
import type { SQL } from 'bun'

export interface RealtimeCursorPosition {
  epoch: string
  seq: number
}

/** Who a cursor belongs to: one device (falls back to the session) of one principal. */
export interface RealtimeCursorOwner {
  workspaceId: string
  principalId: string
  deviceKey: string
}

export interface RealtimeCursorEntry {
  topic: string
  position: RealtimeCursorPosition
}

export interface RealtimeCursorStore {
  save(owner: RealtimeCursorOwner, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void>
  /** All cursors of one owner in one write (disconnect); falls back to `save` per topic when absent. */
  saveMany?(owner: RealtimeCursorOwner, entries: readonly RealtimeCursorEntry[], policyEpoch: number): Promise<void>
  load(owner: RealtimeCursorOwner, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null>
}

export const DEFAULT_CURSOR_TTL_MS = 24 * 60 * 60 * 1000
/** Rows per multi-row cursor upsert (7 parameters each). */
export const CURSOR_UPSERT_CHUNK = 500

/** Deterministic UUID-shaped row id for (workspace, principal, device, topic). */
export function cursorId(owner: RealtimeCursorOwner, topic: string): string {
  const hex = createHash('sha256').update(JSON.stringify(['realtime-cursor', owner.workspaceId, owner.principalId, owner.deviceKey, topic])).digest('hex')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export class InMemoryRealtimeCursorStore implements RealtimeCursorStore {
  private readonly rows = new Map<string, { position: RealtimeCursorPosition; policyEpoch: number; expiresAt: number }>()
  constructor(private readonly ttlMs = DEFAULT_CURSOR_TTL_MS, private readonly now: () => number = Date.now) {}

  async save(owner: RealtimeCursorOwner, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void> {
    this.rows.set(cursorId(owner, topic), { position: { ...position }, policyEpoch, expiresAt: this.now() + this.ttlMs })
  }

  async saveMany(owner: RealtimeCursorOwner, entries: readonly RealtimeCursorEntry[], policyEpoch: number): Promise<void> {
    for (const entry of entries) await this.save(owner, entry.topic, entry.position, policyEpoch)
  }

  async load(owner: RealtimeCursorOwner, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null> {
    const row = this.rows.get(cursorId(owner, topic))
    if (!row || row.policyEpoch !== policyEpoch || row.expiresAt <= this.now()) return null
    return { ...row.position }
  }
}

export class PostgresRealtimeCursorStore implements RealtimeCursorStore {
  private readonly prefix: string
  constructor(private readonly database: SQL, schema = 'public', private readonly ttlMs = DEFAULT_CURSOR_TTL_MS) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid realtime cursor schema')
    this.prefix = `"${schema}".`
  }

  async save(owner: RealtimeCursorOwner, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void> {
    await this.database.unsafe(`INSERT INTO ${this.prefix}realtime_cursor (cursor_id, workspace_id, principal_id, topic, policy_epoch, position, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT (cursor_id) DO UPDATE SET policy_epoch = EXCLUDED.policy_epoch, position = EXCLUDED.position, expires_at = EXCLUDED.expires_at`,
    [cursorId(owner, topic), owner.workspaceId, owner.principalId, topic, policyEpoch, { epoch: position.epoch, seq: position.seq },
      new Date(Date.now() + this.ttlMs).toISOString()])
  }

  /** One multi-row upsert per chunk (topic sets are capped per client). */
  async saveMany(owner: RealtimeCursorOwner, entries: readonly RealtimeCursorEntry[], policyEpoch: number): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString()
    for (let offset = 0; offset < entries.length; offset += CURSOR_UPSERT_CHUNK) {
      const chunk = entries.slice(offset, offset + CURSOR_UPSERT_CHUNK)
      const params: unknown[] = []
      const rows = chunk.map(entry => {
        const base = params.length
        params.push(cursorId(owner, entry.topic), owner.workspaceId, owner.principalId, entry.topic, policyEpoch,
          { epoch: entry.position.epoch, seq: entry.position.seq }, expiresAt)
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7})`
      })
      await this.database.unsafe(`INSERT INTO ${this.prefix}realtime_cursor (cursor_id, workspace_id, principal_id, topic, policy_epoch, position, expires_at)
        VALUES ${rows.join(', ')}
        ON CONFLICT (cursor_id) DO UPDATE SET policy_epoch = EXCLUDED.policy_epoch, position = EXCLUDED.position, expires_at = EXCLUDED.expires_at`, params)
    }
  }

  async load(owner: RealtimeCursorOwner, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null> {
    const rows = await this.database.unsafe<Array<{ position: unknown }>>(`SELECT position FROM ${this.prefix}realtime_cursor
      WHERE cursor_id = $1 AND workspace_id = $2 AND principal_id = $3 AND topic = $4 AND policy_epoch = $5 AND expires_at > clock_timestamp()`,
    [cursorId(owner, topic), owner.workspaceId, owner.principalId, topic, policyEpoch])
    const raw = rows[0]?.position
    const position = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { epoch?: unknown; seq?: unknown } | undefined
    if (!position || typeof position.epoch !== 'string' || !Number.isSafeInteger(position.seq)) return null
    return { epoch: position.epoch, seq: position.seq as number }
  }
}
