/**
 * Durable link state in `bun:sqlite`. One row per `/api/link/start`:
 *
 *   links(link_id, account_id, account_label, code, phone, status, created_at,
 *         expires_at, confirmed_at, attempts)
 *
 * A second, internal table (`chat_links`) correlates the Telegram chat that
 * ran `/start <linkId>` with the pending link so the follow-up contact message
 * can be routed back to it. It is bookkeeping, not part of the public contract.
 *
 * Every method takes `now` explicitly so TTL/attempt behaviour is testable
 * without clock mocking, and expiry is swept on every access.
 */
import { Database } from 'bun:sqlite'
import {
  effectiveStatus,
  generateCode,
  generateLinkId,
  maskPhone,
  normalizeCode,
  type LinkStatus,
  type RandomIndex,
} from './link.ts'

export interface LinkRecord {
  linkId: string
  accountId: string
  accountLabel: string | null
  code: string | null
  phone: string | null
  status: LinkStatus
  createdAt: number
  expiresAt: number
  confirmedAt: number | null
  attempts: number
}

/** Public projection of a link, as returned by `GET /api/link/status`. */
export interface LinkStatusView {
  status: LinkStatus
  /** Present only once the user has shared a phone (`code_issued`). */
  code?: string
  /** Present once a phone is bound. */
  phoneMasked?: string
  confirmedAt?: number
}

export type ConfirmResult = 'confirmed' | 'invalid' | 'expired' | 'not_found'

export interface IssueResult {
  record: LinkRecord
  /** False when the code was already issued (repeated contact message). */
  issued: boolean
}

interface LinkRow {
  link_id: string
  account_id: string
  account_label: string | null
  code: string | null
  phone: string | null
  status: string
  created_at: number
  expires_at: number
  confirmed_at: number | null
  attempts: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS links (
  link_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_label TEXT,
  code TEXT,
  phone TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_account ON links(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS chat_links (
  chat_id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

function toRecord(row: LinkRow): LinkRecord {
  return {
    linkId: row.link_id,
    accountId: row.account_id,
    accountLabel: row.account_label,
    code: row.code,
    phone: row.phone,
    status: row.status as LinkStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    attempts: row.attempts,
  }
}

export interface StateOptions {
  /** Deterministic code source for tests. */
  randomIndex?: RandomIndex
  /** Deterministic link-id source for tests. */
  makeLinkId?: () => string
}

export class LinkState {
  private readonly db: Database
  private readonly newCode: () => string
  private readonly newLinkId: () => string

  constructor(path: string, options: StateOptions = {}) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
    this.newCode = () => generateCode(options.randomIndex)
    this.newLinkId = options.makeLinkId ?? generateLinkId
  }

  /** Mint a fresh `waiting` link with no code yet and the 30-minute TTL. */
  createLink(accountId: string, accountLabel: string | null, now: number, ttlMs: number): LinkRecord {
    this.expireStale(now)
    const linkId = this.newLinkId()
    this.db
      .query(
        `INSERT INTO links (link_id, account_id, account_label, status, attempts, created_at, expires_at)
         VALUES (?, ?, ?, 'waiting', 0, ?, ?)`,
      )
      .run(linkId, accountId, accountLabel, now, now + ttlMs)
    const record = this.byId(linkId)
    if (!record) throw new Error('link insert failed')
    return record
  }

  byId(linkId: string): LinkRecord | null {
    const row = this.db.query<LinkRow, [string]>('SELECT * FROM links WHERE link_id = ?').get(linkId)
    return row ? toRecord(row) : null
  }

  /** Public status projection, sweeping expiry first. Null for unknown links. */
  status(linkId: string, now: number): LinkStatusView | null {
    this.expireStale(now)
    const record = this.byId(linkId)
    if (!record) return null
    const view: LinkStatusView = { status: record.status }
    if (record.status === 'code_issued' && record.code !== null) view.code = record.code
    if ((record.status === 'code_issued' || record.status === 'confirmed') && record.phone !== null) {
      view.phoneMasked = maskPhone(record.phone)
    }
    if (record.status === 'confirmed' && record.confirmedAt !== null) view.confirmedAt = record.confirmedAt
    return view
  }

  /** Remember which link a chat opened, so its contact message can be routed. */
  bindChat(chatId: string, linkId: string, now: number): void {
    this.db
      .query(
        `INSERT INTO chat_links (chat_id, link_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET link_id = excluded.link_id, updated_at = excluded.updated_at`,
      )
      .run(chatId, linkId, now)
  }

  /** Pending link id bound to a chat, if any. */
  linkForChat(chatId: string): string | null {
    const row = this.db.query<{ link_id: string }, [string]>('SELECT link_id FROM chat_links WHERE chat_id = ?').get(chatId)
    return row ? row.link_id : null
  }

  /**
   * Bind the shared phone and issue the 8-letter code exactly once. A repeated
   * contact message returns the existing code untouched (no regeneration).
   */
  issueCode(chatId: string, phone: string, now: number): IssueResult | null {
    this.expireStale(now)
    const linkId = this.linkForChat(chatId)
    if (linkId === null) return null
    const record = this.byId(linkId)
    if (!record) return null
    const status = effectiveStatus(record.status, record.expiresAt, now)
    if (status === 'code_issued') return { record, issued: false }
    if (status !== 'waiting') return null
    const code = this.newCode()
    this.db.query(`UPDATE links SET code = ?, phone = ?, status = 'code_issued' WHERE link_id = ?`).run(code, phone, linkId)
    const updated = this.byId(linkId)
    return updated ? { record: updated, issued: true } : null
  }

  /**
   * Validate a code submitted by the desktop client.
   *  - unknown link → `not_found`;
   *  - already confirmed → `confirmed` (idempotent replay of the same link);
   *  - past TTL → `expired`;
   *  - wrong code → `invalid`, invalidating the link once `maxAttempts` is hit.
   */
  confirm(linkId: string, code: unknown, now: number, maxAttempts: number): ConfirmResult {
    this.expireStale(now)
    const record = this.byId(linkId)
    if (!record) return 'not_found'
    if (record.status === 'confirmed') return 'confirmed'
    if (record.status === 'expired') return 'expired'
    if (record.status !== 'code_issued' || record.code === null) return 'invalid'
    if (normalizeCode(code) !== record.code) {
      const attempts = record.attempts + 1
      if (attempts >= maxAttempts) {
        this.db.query(`UPDATE links SET attempts = ?, status = 'expired' WHERE link_id = ?`).run(attempts, linkId)
      } else {
        this.db.query('UPDATE links SET attempts = ? WHERE link_id = ?').run(attempts, linkId)
      }
      return 'invalid'
    }
    this.db.query(`UPDATE links SET status = 'confirmed', confirmed_at = ? WHERE link_id = ?`).run(now, linkId)
    return 'confirmed'
  }

  /** Mark every unconfirmed link past its TTL as expired. Returns rows swept. */
  expireStale(now: number): number {
    const result = this.db
      .query(`UPDATE links SET status = 'expired' WHERE status IN ('waiting', 'code_issued') AND expires_at <= ?`)
      .run(now)
    return Number(result.changes)
  }

  close(): void {
    this.db.close()
  }
}