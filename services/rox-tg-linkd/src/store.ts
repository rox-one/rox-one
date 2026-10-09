/**
 * Durable link state in bun:sqlite. Two tables:
 *  - `pending_links`: one row per `/api/link/start`, carrying the deep-link
 *    token, the phone bound through Telegram and the 8-char code;
 *  - `links`: the confirmed roxUserId → phone binding.
 *
 * Every method takes `now` explicitly so TTL/attempt behaviour is testable
 * without clock mocking.
 */
import { Database } from 'bun:sqlite'
import { effectiveStatus, generateCode, generateToken, normalizeCode, type LinkStatus, type RandomIndex } from './link.ts'

export type PendingStatus = 'waiting-code' | 'code-sent' | 'linked' | 'expired'

export interface PendingLink {
  token: string
  roxUserId: string
  code: string | null
  phone: string | null
  telegramUserId: string | null
  chatId: string | null
  status: PendingStatus
  attempts: number
  createdAt: number
  expiresAt: number
}

export interface LinkedAccount {
  roxUserId: string
  phone: string
  telegramUserId: string
  linkedAt: number
}

export interface LinkStatusView {
  status: LinkStatus
  expiresAt: number | null
  /** The pending code once the phone is shared; null otherwise. */
  code: string | null
}

export type VerifyResult = 'linked' | 'expired' | 'invalid'

interface PendingRow {
  token: string
  rox_user_id: string
  code: string | null
  phone: string | null
  telegram_user_id: string | null
  chat_id: string | null
  status: string
  attempts: number
  created_at: number
  expires_at: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pending_links (
  token TEXT PRIMARY KEY,
  rox_user_id TEXT NOT NULL,
  code TEXT,
  phone TEXT,
  telegram_user_id TEXT,
  chat_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_links(rox_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_chat ON pending_links(chat_id, created_at DESC);
CREATE TABLE IF NOT EXISTS links (
  rox_user_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL
);
`

function toPending(row: PendingRow): PendingLink {
  return {
    token: row.token,
    roxUserId: row.rox_user_id,
    code: row.code,
    phone: row.phone,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    status: row.status as PendingStatus,
    attempts: row.attempts,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

export interface StoreOptions {
  /** Deterministic code/token sources for tests. */
  randomIndex?: RandomIndex
  makeToken?: () => string
}

export class LinkStore {
  private readonly db: Database
  private readonly newCode: () => string
  private readonly newToken: () => string

  constructor(path: string, options: StoreOptions = {}) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
    this.newCode = () => generateCode(options.randomIndex)
    this.newToken = options.makeToken ?? generateToken
  }

  /**
   * Idempotent start: an active pending link for this user is reused as-is
   * (same token, same code); otherwise a fresh row is created with the
   * 8-char code the owner spec expects in the response.
   */
  createOrGetPending(roxUserId: string, now: number, ttlMs: number): PendingLink {
    this.expireStale(now)
    const existing = this.findPending(roxUserId, ['waiting-code', 'code-sent'])
    if (existing) return existing
    const token = this.newToken()
    const code = this.newCode()
    this.db
      .query(
        `INSERT INTO pending_links (token, rox_user_id, code, status, attempts, created_at, expires_at)
         VALUES (?, ?, ?, 'waiting-code', 0, ?, ?)`,
      )
      .run(token, roxUserId, code, now, now + ttlMs)
    const row = this.byToken(token)
    if (!row) throw new Error('pending link insert failed')
    return row
  }

  byToken(token: string): PendingLink | null {
    const row = this.db.query<PendingRow, [string]>('SELECT * FROM pending_links WHERE token = ?').get(token)
    return row ? toPending(row) : null
  }

  /** Latest row for a user with one of the given statuses, else null. */
  findPending(roxUserId: string, statuses: PendingStatus[]): PendingLink | null {
    const placeholders = statuses.map(() => '?').join(', ')
    const row = this.db
      .query<PendingRow, [string, ...string[]]>(
        `SELECT * FROM pending_links WHERE rox_user_id = ? AND status IN (${placeholders})
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(roxUserId, ...statuses)
    return row ? toPending(row) : null
  }

  /**
   * Remember the chat that ran `/start <token>` so the follow-up contact
   * message can be correlated back to the pending link.
   */
  bindChat(token: string, chatId: string, now: number): PendingLink | null {
    const pending = this.byToken(token)
    if (!pending) return null
    if (effectiveStatus(pending.status, pending.expiresAt, now) !== 'waiting-code') return null
    this.db.query('UPDATE pending_links SET chat_id = ? WHERE token = ?').run(chatId, token)
    return this.byToken(token)
  }

  /** Pending link whose wire contact this chat is expected to share, else null. */
  findByChat(chatId: string, now: number): PendingLink | null {
    const row = this.db
      .query<PendingRow, [string]>(
        `SELECT * FROM pending_links WHERE chat_id = ? AND status = 'waiting-code' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(chatId)
    if (!row) return null
    const pending = toPending(row)
    return effectiveStatus(pending.status, pending.expiresAt, now) === 'waiting-code' ? pending : null
  }

  /**
   * Record the shared phone on the pending row and move it to `code-sent`.
   * The code already exists (created at start); it is only generated here for
   * a row that somehow lost it.
   */
  bindPhone(chatId: string, phone: string, telegramUserId: string, now: number): PendingLink | null {
    const pending = this.findByChat(chatId, now)
    if (!pending) return null
    this.db
      .query(
        `UPDATE pending_links SET phone = ?, telegram_user_id = ?, code = COALESCE(code, ?), status = 'code-sent'
         WHERE token = ?`,
      )
      .run(phone, telegramUserId, this.newCode(), pending.token)
    return this.byToken(pending.token)
  }

  /**
   * Verify a code submitted by the desktop app.
   *  - already linked → `linked` (idempotent);
   *  - no pending link / not yet moved to `code-sent` → `invalid`;
   *  - past TTL → `expired`;
   *  - wrong code → `invalid`, and the pending link is invalidated on the
   *    attempt that crosses `maxAttempts`.
   */
  verify(roxUserId: string, code: unknown, now: number, maxAttempts: number): VerifyResult {
    if (this.getLinked(roxUserId)) return 'linked'
    const pending = this.findAnyPending(roxUserId)
    if (!pending) return 'invalid'
    if (pending.expiresAt <= now || pending.status === 'expired') {
      this.markExpired(pending.token)
      return 'expired'
    }
    if (pending.status !== 'code-sent') return 'invalid'
    if (normalizeCode(code) === '' || normalizeCode(code) !== pending.code) {
      const attempts = pending.attempts + 1
      if (attempts >= maxAttempts) {
        this.db.query('UPDATE pending_links SET attempts = ?, status = ? WHERE token = ?').run(attempts, 'expired', pending.token)
      } else {
        this.db.query('UPDATE pending_links SET attempts = ? WHERE token = ?').run(attempts, pending.token)
      }
      return 'invalid'
    }
    this.confirm(pending, now)
    return 'linked'
  }

  /** Current status of a user's link (confirmed link wins over any pending row). */
  statusFor(roxUserId: string, now: number): LinkStatusView {
    if (this.getLinked(roxUserId)) return { status: 'linked', expiresAt: null, code: null }
    const pending = this.findAnyPending(roxUserId)
    if (!pending) return { status: 'none', expiresAt: null, code: null }
    const status = effectiveStatus(pending.status, pending.expiresAt, now)
    if (status === 'expired' && pending.status !== 'expired') this.markExpired(pending.token)
    return {
      status,
      expiresAt: status === 'expired' ? null : pending.expiresAt,
      code: status === 'code-sent' ? pending.code : null,
    }
  }

  getLinked(roxUserId: string): LinkedAccount | null {
    const row = this.db
      .query<{ rox_user_id: string; phone: string; telegram_user_id: string; linked_at: number }, [string]>(
        'SELECT * FROM links WHERE rox_user_id = ?',
      )
      .get(roxUserId)
    return row
      ? { roxUserId: row.rox_user_id, phone: row.phone, telegramUserId: row.telegram_user_id, linkedAt: row.linked_at }
      : null
  }

  /** Mark every unlinked pending row past its TTL as expired. */
  expireStale(now: number): number {
    const result = this.db
      .query('UPDATE pending_links SET status = ? WHERE status IN (?, ?) AND expires_at <= ?')
      .run('expired', 'waiting-code', 'code-sent', now)
    return Number(result.changes)
  }

  close(): void {
    this.db.close()
  }

  private findAnyPending(roxUserId: string): PendingLink | null {
    const row = this.db
      .query<PendingRow, [string]>('SELECT * FROM pending_links WHERE rox_user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(roxUserId)
    return row ? toPending(row) : null
  }

  private markExpired(token: string): void {
    this.db.query('UPDATE pending_links SET status = ? WHERE token = ?').run('expired', token)
  }

  private confirm(pending: PendingLink, now: number): void {
    const phone = pending.phone ?? ''
    const telegramUserId = pending.telegramUserId ?? ''
    this.db
      .query(
        `INSERT INTO links (rox_user_id, phone, telegram_user_id, linked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(rox_user_id) DO UPDATE SET phone = excluded.phone, telegram_user_id = excluded.telegram_user_id, linked_at = excluded.linked_at`,
      )
      .run(pending.roxUserId, phone, telegramUserId, now)
    this.db.query('UPDATE pending_links SET status = ? WHERE token = ?').run('linked', pending.token)
  }
}