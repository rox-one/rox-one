/**
 * Host-only durable collaboration invitations.
 *
 * Join URLs contain bearer keys. Only a SHA-256 digest is persisted; the raw
 * key is returned at creation time and supplied by the caller at lookup time.
 * Consumption and membership insertion share one SQLite write transaction so
 * separate application/server processes cannot redeem the same key twice.
 */
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from '../utils/sqlite-runtime.ts'
import {
  DEFAULT_INVITE_TTL_MS,
  buildInviteCard,
  inviteStatus,
  mintJoinKey,
  parseInviteUrl,
  slugifyUsername,
  type BroInvite,
  type BroInviteCard,
  type CollaboratorRole,
  type JoinResult,
  type RoxAccount,
} from './invite.ts'
import type { PresenceMember } from './presence.ts'
import type { BroInviteStorage, CreateInviteInput } from './store.ts'

interface InviteRow {
  session_id: string
  workspace_id: string
  owner_account_id: string
  owner_username: string
  role: 'editor' | 'viewer'
  created_at: number
  expires_at: number
  used_at: number | null
  revoked_at: number | null
}

interface PresenceRow {
  account_id: string
  display_name: string
  username: string
  role: CollaboratorRole
  joined_at: number
}

const JOIN_KEY_RE = /^[a-f0-9]{32}$/
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

function digestJoinKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function hasAccount(account: RoxAccount | null): account is RoxAccount {
  return account !== null && typeof account.accountId === 'string' && account.accountId.trim().length > 0
    && typeof account.username === 'string' && typeof account.displayName === 'string'
}

function privateDatabase(path: string): DatabaseSync {
  if (!path || path === ':memory:') throw new Error('durable invitation database path is required')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const descriptor = openSync(path, 'wx', 0o600)
    closeSync(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = lstatSync(path)
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || (uid !== undefined && existing.uid !== uid)) {
      throw new Error('invitation database must be a private regular file')
    }
  }
  chmodSync(path, 0o600)
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA busy_timeout = 5000;')
    // First-time WAL switches can race before SQLite's busy handler is active.
    const deadline = Date.now() + 5000
    for (;;) {
      try { db.exec('PRAGMA journal_mode = WAL;'); break } catch (error) {
        const failure = error as { code?: string; errcode?: number }
        if ((failure.code !== 'SQLITE_BUSY' && failure.errcode !== 5) || Date.now() >= deadline) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    db.exec(`
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS bro_invites (
        key_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT '',
        owner_account_id TEXT NOT NULL,
        owner_username TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS bro_members (
        workspace_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
        joined_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, session_id, account_id)
      );
    `)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export class SqliteBroInviteStore implements BroInviteStorage {
  private readonly db: DatabaseSync
  // Online presence is process-local. Restarted durable memberships are offline
  // until this host observes a participant again, rather than inventing presence.
  private readonly observedMembers = new Set<string>()

  constructor(
    databasePath: string,
    private readonly now: () => number = Date.now,
    private readonly randomBytes?: (n: number) => Uint8Array,
  ) {
    this.db = privateDatabase(databasePath)
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private timestamp(): number {
    const timestamp = this.now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invitation time is invalid')
    return timestamp
  }

  private memberKey(sessionId: string, workspaceId: string | undefined, accountId: string): string {
    return JSON.stringify([workspaceId ?? '', sessionId, accountId])
  }

  private upsertMember(sessionId: string, workspaceId: string | undefined, account: RoxAccount, role: CollaboratorRole, timestamp: number): void {
    this.db.prepare(`
      INSERT INTO bro_members (workspace_id, session_id, account_id, display_name, username, role, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, session_id, account_id) DO UPDATE SET
        display_name = excluded.display_name,
        username = excluded.username,
        role = CASE
          WHEN bro_members.role = 'owner' THEN 'owner'
          WHEN bro_members.role = 'editor' AND excluded.role = 'viewer' THEN 'editor'
          ELSE excluded.role END
    `).run(workspaceId ?? '', sessionId, account.accountId, account.displayName, account.username, role, timestamp)
  }

  createInvite(input: CreateInviteInput): BroInviteCard {
    if (!SESSION_ID_RE.test(input.sessionId) || !hasAccount(input.owner)) throw new Error('invitation owner or session is invalid')
    if (input.workspaceId !== undefined && (!input.workspaceId || input.workspaceId.length > 256)) throw new Error('invitation workspace is invalid')
    const createdAt = this.timestamp()
    const ttl = input.ttlMs ?? DEFAULT_INVITE_TTL_MS
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(createdAt + ttl)) throw new Error('invitation expiry is invalid')
    const role = input.role ?? 'editor'
    if (role !== 'editor' && role !== 'viewer') throw new Error('invitation role is invalid')
    const card = this.transaction(() => {
      // A collision must never replace an already consumed/revoked invitation.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const joinKey = mintJoinKey(this.randomBytes)
        if (!JOIN_KEY_RE.test(joinKey)) throw new Error('invitation key generator is invalid')
        const invite: BroInvite = {
          sessionId: input.sessionId,
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
          ownerAccountId: input.owner.accountId,
          ownerUsername: slugifyUsername(input.owner.username),
          joinKey,
          role,
          createdAt,
          expiresAt: createdAt + ttl,
        }
        const insertion = this.db.prepare(`
          INSERT OR IGNORE INTO bro_invites
            (key_hash, session_id, workspace_id, owner_account_id, owner_username, role, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(digestJoinKey(joinKey), invite.sessionId, input.workspaceId ?? '', invite.ownerAccountId,
          invite.ownerUsername, invite.role, invite.createdAt, invite.expiresAt)
        if (Number(insertion.changes) === 0) continue
        this.upsertMember(input.sessionId, input.workspaceId, input.owner, 'owner', createdAt)
        return buildInviteCard(invite)
      }
      throw new Error('could not generate a unique invitation key')
    })
    this.observedMembers.add(this.memberKey(input.sessionId, input.workspaceId, input.owner.accountId))
    return card
  }

  getInvite(joinKey: string): BroInvite | undefined {
    if (!JOIN_KEY_RE.test(joinKey)) return undefined
    const row = this.db.prepare('SELECT * FROM bro_invites WHERE key_hash = ?').get(digestJoinKey(joinKey)) as unknown as InviteRow | undefined
    if (!row) return undefined
    return {
      joinKey,
      sessionId: row.session_id,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      ownerAccountId: row.owner_account_id,
      ownerUsername: row.owner_username,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ...(row.used_at === null ? {} : { usedAt: row.used_at }),
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    }
  }

  join(url: string, account: RoxAccount | null): JoinResult {
    if (!hasAccount(account)) return { ok: false, error: 'membership_required' }
    const parsed = parseInviteUrl(url)
    if (!parsed) return { ok: false, error: 'invalid' }
    const result = this.transaction<JoinResult>(() => {
      const invite = this.getInvite(parsed.joinKey)
      if (!invite || invite.sessionId !== parsed.sessionId || invite.ownerUsername !== parsed.username) return { ok: false, error: 'invalid' }
      const timestamp = this.timestamp()
      const status = inviteStatus(invite, timestamp)
      if (status !== 'active') return { ok: false, error: status }
      const consumed = this.db.prepare(`
        UPDATE bro_invites SET used_at = ?
        WHERE key_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).run(timestamp, digestJoinKey(parsed.joinKey), timestamp)
      if (Number(consumed.changes) !== 1) throw new Error('invitation consumption failed')
      this.upsertMember(invite.sessionId, invite.workspaceId, account, invite.role, timestamp)
      return {
        ok: true,
        sessionId: invite.sessionId,
        role: invite.role,
        accountId: account.accountId,
        ...(invite.workspaceId === undefined ? {} : { workspaceId: invite.workspaceId }),
      }
    })
    if (result.ok) this.observedMembers.add(this.memberKey(result.sessionId, result.workspaceId, account.accountId))
    return result
  }

  revoke(joinKey: string, actorAccountId: string): boolean {
    if (!JOIN_KEY_RE.test(joinKey) || !actorAccountId.trim()) return false
    return this.transaction(() => {
      const invite = this.getInvite(joinKey)
      if (!invite || invite.ownerAccountId !== actorAccountId) return false
      if (invite.revokedAt !== undefined) return true
      this.db.prepare('UPDATE bro_invites SET revoked_at = ? WHERE key_hash = ? AND owner_account_id = ?')
        .run(this.timestamp(), digestJoinKey(joinKey), actorAccountId)
      return true
    })
  }

  listPresence(sessionId: string, workspaceId?: string): PresenceMember[] {
    const rows = this.db.prepare(`
      SELECT account_id, display_name, username, role, joined_at FROM bro_members
      WHERE workspace_id = ? AND session_id = ? ORDER BY joined_at, rowid
    `).all(workspaceId ?? '', sessionId) as unknown as PresenceRow[]
    return rows.map(row => ({
      accountId: row.account_id,
      displayName: row.display_name,
      username: row.username,
      role: row.role,
      joinedAt: row.joined_at,
      status: this.observedMembers.has(this.memberKey(sessionId, workspaceId, row.account_id)) ? 'online' : 'offline',
    }))
  }

  close(): void {
    this.db.close()
    this.observedMembers.clear()
  }
}
