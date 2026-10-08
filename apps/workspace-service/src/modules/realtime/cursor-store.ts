/**
 * W1-03 (#1500) — Server-side realtime cursors (`realtime_cursor`, W1-05).
 *
 * The gateway stores the last delivered `{ epoch, seq }` per (principal,
 * topic) when a client unsubscribes or disconnects, so `subscribe({ resume:
 * true })` continues without trusting a client offset. Cursors bound to an
 * older policy epoch or past `expires_at` are ignored (→ snapshot).
 */

import { randomUUID } from 'node:crypto'
import type { SQL } from 'bun'

export interface RealtimeCursorPosition {
  epoch: string
  seq: number
}

export interface RealtimeCursorStore {
  save(workspaceId: string, principalId: string, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void>
  load(workspaceId: string, principalId: string, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null>
}

export const DEFAULT_CURSOR_TTL_MS = 24 * 60 * 60 * 1000

export class InMemoryRealtimeCursorStore implements RealtimeCursorStore {
  private readonly rows = new Map<string, { position: RealtimeCursorPosition; policyEpoch: number; expiresAt: number }>()
  constructor(private readonly ttlMs = DEFAULT_CURSOR_TTL_MS, private readonly now: () => number = Date.now) {}

  async save(workspaceId: string, principalId: string, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void> {
    this.rows.set(JSON.stringify([workspaceId, principalId, topic]), { position: { ...position }, policyEpoch, expiresAt: this.now() + this.ttlMs })
  }

  async load(workspaceId: string, principalId: string, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null> {
    const row = this.rows.get(JSON.stringify([workspaceId, principalId, topic]))
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

  async save(workspaceId: string, principalId: string, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void> {
    await this.database.begin(async tx => {
      await tx.unsafe(`DELETE FROM ${this.prefix}realtime_cursor WHERE workspace_id = $1 AND principal_id = $2 AND topic = $3`, [workspaceId, principalId, topic])
      await tx.unsafe(`INSERT INTO ${this.prefix}realtime_cursor (cursor_id, workspace_id, principal_id, topic, policy_epoch, position, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [randomUUID(), workspaceId, principalId, topic, policyEpoch, { epoch: position.epoch, seq: position.seq }, new Date(Date.now() + this.ttlMs).toISOString()])
    })
  }

  async load(workspaceId: string, principalId: string, topic: string, policyEpoch: number): Promise<RealtimeCursorPosition | null> {
    const rows = await this.database.unsafe<Array<{ position: unknown }>>(`SELECT position FROM ${this.prefix}realtime_cursor
      WHERE workspace_id = $1 AND principal_id = $2 AND topic = $3 AND policy_epoch = $4 AND expires_at > clock_timestamp()
      ORDER BY created_at DESC LIMIT 1`, [workspaceId, principalId, topic, policyEpoch])
    const raw = rows[0]?.position
    const position = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { epoch?: unknown; seq?: unknown } | undefined
    if (!position || typeof position.epoch !== 'string' || !Number.isSafeInteger(position.seq)) return null
    return { epoch: position.epoch, seq: position.seq as number }
  }
}
