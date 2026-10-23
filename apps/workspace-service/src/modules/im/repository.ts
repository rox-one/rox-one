/**
 * Relay-bridge persistence: the `im.im_identity` (rox userId ↔ relay pubkey)
 * and `im.im_service_event` (`(call_id, type)` idempotency) tables from
 * `553-im-relay.sql`, plus the read-only directory port the routes need for
 * org/channel membership.
 *
 * The bridge tables live in the dedicated `im` schema (independent of the
 * workspace-service search_path). Production uses Postgres; the in-memory
 * implementations keep the route tests database-free (same convention as the
 * notify module's `InMemoryNotificationStore`).
 */

import type { SQL } from 'bun'

export interface ImIdentityRow {
  readonly userId: string
  readonly pubkey: string
  readonly createdAt: string
}

export interface ImServiceEventRow {
  readonly callId: string
  readonly type: string
  readonly eventId: string
  readonly channelId: string
  readonly createdAt: string
}

/** What the service supplies on insert; `created_at` is the database default. */
export type ImServiceEventInput = Omit<ImServiceEventRow, 'createdAt'>

export interface ImRepository {
  /** Upsert the user's relay pubkey; throws {@link ImIdentityConflictError} when the pubkey already maps to another user. */
  upsertIdentity(userId: string, pubkey: string): Promise<ImIdentityRow>
  /** Delete the identity, returning the removed pubkey (or null when none). */
  deleteIdentity(userId: string): Promise<string | null>
  findIdentity(userId: string): Promise<ImIdentityRow | null>
  findServiceEvent(callId: string, type: string): Promise<ImServiceEventRow | null>
  insertServiceEvent(row: ImServiceEventInput): Promise<void>
}

/** Thrown when a relay pubkey is already bound to a different rox account. */
export class ImIdentityConflictError extends Error {
  readonly code = 'IM_IDENTITY_CONFLICT'
  constructor() {
    super('relay pubkey is already bound to another account')
    this.name = 'ImIdentityConflictError'
  }
}

export interface ImMembership {
  readonly role: 'owner' | 'admin' | 'member'
  /** Guests are members only of the channels they were invited to. */
  readonly guest: boolean
}

export interface ImDirectoryPort {
  /** Active membership of `principalId` in the rox org, or null. */
  orgMembership(orgId: string, principalId: string): Promise<ImMembership | null>
  /** Whether the channel exists (not deleted). */
  channelExists(channelId: string): Promise<boolean>
  /** Active channel membership for a user, or null. */
  channelMembership(channelId: string, principalId: string): Promise<ImMembership | null>
  /** The org owning a channel, or null. */
  channelOrg(channelId: string): Promise<string | null>
}

const iso = (value: string | Date): string => new Date(value).toISOString()

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : ''
  return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || /unique|duplicate key/i.test(message)
}

interface IdentityDbRow { user_id: string; pubkey: string; created_at: string | Date }
interface ServiceEventDbRow { call_id: string; type: string; event_id: string; channel_id: string; created_at: string | Date }

export class PostgresImRepository implements ImRepository {
  constructor(private readonly database: SQL) {}

  async upsertIdentity(userId: string, pubkey: string): Promise<ImIdentityRow> {
    try {
      const rows = await this.database<IdentityDbRow[]>`
        INSERT INTO im.im_identity (user_id, pubkey) VALUES (${userId}::uuid, ${pubkey})
        ON CONFLICT (user_id) DO UPDATE SET pubkey = EXCLUDED.pubkey
        RETURNING user_id::text AS user_id, pubkey, created_at`
      const row = rows[0]
      if (!row) throw new Error('identity upsert returned no row')
      return { userId: row.user_id, pubkey: row.pubkey, createdAt: iso(row.created_at) }
    } catch (error) {
      if (error instanceof ImIdentityConflictError) throw error
      if (isUniqueViolation(error)) throw new ImIdentityConflictError()
      throw error
    }
  }

  async deleteIdentity(userId: string): Promise<string | null> {
    const rows = await this.database<{ pubkey: string }[]>`
      DELETE FROM im.im_identity WHERE user_id = ${userId}::uuid RETURNING pubkey`
    return rows[0]?.pubkey ?? null
  }

  async findIdentity(userId: string): Promise<ImIdentityRow | null> {
    const rows = await this.database<IdentityDbRow[]>`
      SELECT user_id::text AS user_id, pubkey, created_at FROM im.im_identity WHERE user_id = ${userId}::uuid`
    const row = rows[0]
    return row ? { userId: row.user_id, pubkey: row.pubkey, createdAt: iso(row.created_at) } : null
  }

  async findServiceEvent(callId: string, type: string): Promise<ImServiceEventRow | null> {
    const rows = await this.database<ServiceEventDbRow[]>`
      SELECT call_id, type, event_id, channel_id, created_at FROM im.im_service_event
      WHERE call_id = ${callId} AND type = ${type}`
    const row = rows[0]
    return row ? { callId: row.call_id, type: row.type, eventId: row.event_id, channelId: row.channel_id, createdAt: iso(row.created_at) } : null
  }

  async insertServiceEvent(row: ImServiceEventInput): Promise<void> {
    await this.database`
      INSERT INTO im.im_service_event (call_id, type, event_id, channel_id)
      VALUES (${row.callId}, ${row.type}, ${row.eventId}, ${row.channelId})
      ON CONFLICT (call_id, type) DO NOTHING`
  }
}

interface MembershipDbRow { role: string; kind: string | null }

function membershipFrom(row: MembershipDbRow | undefined): ImMembership | null {
  if (!row) return null
  const role = row.role === 'owner' || row.role === 'admin' ? row.role : 'member'
  return { role, guest: row.kind === 'guest' }
}

export class PostgresImDirectory implements ImDirectoryPort {
  constructor(private readonly database: SQL, private readonly schema: string) {}

  async orgMembership(orgId: string, principalId: string): Promise<ImMembership | null> {
    const rows = await this.database<MembershipDbRow[]>`
      SELECT m.role, p.kind FROM "${this.schema}".workspace_member m
      JOIN "${this.schema}".principal p ON p.principal_id = m.principal_id
      WHERE m.workspace_id = ${orgId}::uuid AND m.principal_id = ${principalId}::uuid
        AND m.status = 'active' AND p.status = 'active'`
    return membershipFrom(rows[0])
  }

  async channelExists(channelId: string): Promise<boolean> {
    const rows = await this.database<{ present: number }[]>`
      SELECT 1 AS present FROM "${this.schema}".chat WHERE chat_id = ${channelId}::uuid AND deleted_at IS NULL`
    return rows.length > 0
  }

  async channelMembership(channelId: string, principalId: string): Promise<ImMembership | null> {
    const rows = await this.database<MembershipDbRow[]>`
      SELECT cm.role, p.kind FROM "${this.schema}".chat_member cm
      JOIN "${this.schema}".chat c ON c.chat_id = cm.chat_id AND c.deleted_at IS NULL
      JOIN "${this.schema}".principal p ON p.principal_id = cm.principal_id
      WHERE cm.chat_id = ${channelId}::uuid AND cm.principal_id = ${principalId}::uuid
        AND cm.state = 'active' AND p.status = 'active'`
    return membershipFrom(rows[0])
  }

  async channelOrg(channelId: string): Promise<string | null> {
    const rows = await this.database<{ workspace_id: string }[]>`
      SELECT workspace_id::text AS workspace_id FROM "${this.schema}".chat
      WHERE chat_id = ${channelId}::uuid AND deleted_at IS NULL`
    return rows[0]?.workspace_id ?? null
  }
}

// ---------------------------------------------------------------------------
// In-memory implementations (tests / local runtime)
// ---------------------------------------------------------------------------

export class InMemoryImRepository implements ImRepository {
  private readonly byUser = new Map<string, ImIdentityRow>()
  private readonly events = new Map<string, ImServiceEventRow>()
  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsertIdentity(userId: string, pubkey: string): Promise<ImIdentityRow> {
    for (const [other, row] of this.byUser) {
      if (other !== userId && row.pubkey === pubkey) throw new ImIdentityConflictError()
    }
    const row: ImIdentityRow = { userId, pubkey, createdAt: this.byUser.get(userId)?.createdAt ?? this.now().toISOString() }
    this.byUser.set(userId, row)
    return row
  }

  async deleteIdentity(userId: string): Promise<string | null> {
    const row = this.byUser.get(userId)
    if (!row) return null
    this.byUser.delete(userId)
    return row.pubkey
  }

  async findIdentity(userId: string): Promise<ImIdentityRow | null> {
    return this.byUser.get(userId) ?? null
  }

  async findServiceEvent(callId: string, type: string): Promise<ImServiceEventRow | null> {
    return this.events.get(`${callId}\u0000${type}`) ?? null
  }

  async insertServiceEvent(row: ImServiceEventInput): Promise<void> {
    const key = `${row.callId}\u0000${row.type}`
    if (!this.events.has(key)) this.events.set(key, { ...row, createdAt: this.now().toISOString() })
  }
}

export class InMemoryImDirectory implements ImDirectoryPort {
  private readonly orgs = new Map<string, Map<string, ImMembership>>()
  private readonly channels = new Map<string, { orgId: string; members: Map<string, ImMembership> }>()

  setOrgMember(orgId: string, principalId: string, membership: ImMembership): void {
    const members = this.orgs.get(orgId) ?? new Map<string, ImMembership>()
    members.set(principalId, membership)
    this.orgs.set(orgId, members)
  }

  addChannel(channelId: string, orgId: string): void {
    this.channels.set(channelId, { orgId, members: new Map() })
  }

  setChannelMember(channelId: string, principalId: string, membership: ImMembership): void {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`unknown channel ${channelId}`)
    channel.members.set(principalId, membership)
  }

  async orgMembership(orgId: string, principalId: string): Promise<ImMembership | null> {
    return this.orgs.get(orgId)?.get(principalId) ?? null
  }

  async channelExists(channelId: string): Promise<boolean> {
    return this.channels.has(channelId)
  }

  async channelMembership(channelId: string, principalId: string): Promise<ImMembership | null> {
    return this.channels.get(channelId)?.members.get(principalId) ?? null
  }

  async channelOrg(channelId: string): Promise<string | null> {
    return this.channels.get(channelId)?.orgId ?? null
  }
}
