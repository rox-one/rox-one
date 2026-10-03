import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { lockPostgresActorSession } from '../../auth/postgres-identity.ts'
import { AuthenticationError } from '../../auth/verified-actor.ts'
import type { SQL, TransactionSQL } from 'bun'
import { formatRox2EntityId } from '../../../../../packages/core/src/rox2/platform-contract.ts'
import {
  IdentityDomainError,
  type AuthenticatedActor, type CreateSharedProject, type IdentityDomainEvent,
  type IdentityRepositoryPort, type RoxCommand, type SharedProject, type SharedProjectResult,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { IdentityObservability } from './observability.ts'
import { createProjectRequestHash, parseCreateSharedProject, requireActor, requireUuid } from './commands.ts'

interface MembershipRow {
  owner_principal_id: string
  name: string
  policy_epoch: string
  role: 'owner' | 'member'
}
interface ProjectRow {
  workspace_id: string
  project_id: string
  owner_principal_id: string
  name: string
  visibility: 'private' | 'members'
  revision: string | number | bigint
  created_at: Date | string
  updated_at: Date | string
}
interface EventRow {
  event_id: string
  workspace_id: string
  project_id: string | null
  actor_principal_id: string
  type: IdentityDomainEvent['type']
  aggregate_revision: string | number | bigint
  policy_epoch: string | number | bigint
  causation_id: string
  correlation_id: string
  created_at: Date | string
  payload: Record<string, string>
  sequence: string | number | bigint
}
interface CursorPosition { at?: string; id?: string; sequence?: string }
type Database = SQL | TransactionSQL
const iso = (value: string | Date): string => new Date(value).toISOString()

interface ReceiptRow {
  request_hash: string
  idempotency_key: string
  command_id: string
  receipt_id: string
  project_id: string
  observed_revision: string
  project_created_at: string | Date
  project_updated_at: string | Date
  event_policy_epoch: string | null
  event_aggregate_revision: string | null
  result: unknown
}

function unavailableReceipt(): never { throw new IdentityDomainError('PROVIDER_UNAVAILABLE') }
function receiptRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableReceipt()
  return Object.fromEntries(Object.entries(value))
}

/** Persisted JSON is data, not a typed proof. Bind every returned field to this row and original semantic request. */
function retainedReceipt(row: ReceiptRow, actor: AuthenticatedActor, command: RoxCommand<CreateSharedProject>): SharedProjectResult {
  const stored = receiptRecord(row.result)
  if (typeof row.event_policy_epoch !== 'string' || !/^[1-9][0-9]*$/.test(row.event_policy_epoch)
    || !/^[1-9][0-9]*$/.test(row.observed_revision) || row.event_aggregate_revision !== row.observed_revision) return unavailableReceipt()
  const entity = { workspaceId: command.workspaceId, entityId: formatRox2EntityId('project', row.project_id), revisionId: row.observed_revision }
  const createdAt = iso(row.project_created_at)
  const updatedAt = iso(row.project_updated_at)
  if (updatedAt < createdAt) return unavailableReceipt()
  const data: SharedProject = { entity, ownerPrincipalId: actor.principalId, name: command.payload.name,
    visibility: command.payload.visibility, schemaVersion: 1, revision: row.observed_revision,
    policyEpoch: row.event_policy_epoch, createdAt, updatedAt }
  const expected: SharedProjectResult = {
    executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified', ok: true,
    status: 'applied', commandId: row.command_id, requestHash: row.request_hash, observedRevision: row.observed_revision,
    entityId: entity.entityId, entity, receiptId: row.receipt_id, verifiedAt: createdAt, data,
    receipt: { provider: 'rox-workspace', remoteId: entity.entityId, requestId: row.command_id,
      observedRevision: row.observed_revision, verifiedAt: createdAt },
  }
  if (!isDeepStrictEqual(stored, expected)) return unavailableReceipt()
  return expected
}

/** Only the composition root creates the SQL adapter. No renderer I/O or second local writer. */
export class IdentityRepository implements IdentityRepositoryPort {
  private readonly prefix: string
  constructor(private readonly database: SQL, private readonly schema = 'public', private readonly observability = new IdentityObservability(), private readonly licenseEvents?: { verifyEvent(tx: TransactionSQL, eventId: string): Promise<IdentityDomainEvent> }) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid identity database schema')
    this.prefix = `"${schema}".`
  }

  private async query<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
    // Queries below select the fields declared by this migration; input values remain parameterized.
    return await db.unsafe<T[]>(sql, params)
  }

  /** Current DB membership/epoch, not cached token claims or agent execution permission. */
  private async membership(db: TransactionSQL, actor: AuthenticatedActor, workspaceId: string): Promise<MembershipRow> {
    requireActor(actor, requireUuid(workspaceId))
    try { await lockPostgresActorSession(db, this.schema, actor) }
    catch (error) {
      if (error instanceof AuthenticationError) throw new IdentityDomainError('UNAUTHENTICATED')
      throw error
    }
    const [member] = await this.query<MembershipRow>(db, `
      SELECT w.owner_principal_id, w.name, w.policy_epoch::text, m.role
      FROM ${this.prefix}workspace_member m JOIN ${this.prefix}workspace w USING (workspace_id)
      JOIN ${this.prefix}principal p ON p.principal_id = m.principal_id
      WHERE m.workspace_id = $1 AND m.principal_id = $2
        AND m.deleted_at IS NULL AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      FOR SHARE OF m, w, p`, [workspaceId, actor.principalId])
    if (!member) throw new IdentityDomainError('FORBIDDEN')
    return member
  }

  private project(row: ProjectRow, policyEpoch: string): SharedProject {
    const revision = String(row.revision)
    return {
      entity: { workspaceId: row.workspace_id, entityId: formatRox2EntityId('project', row.project_id), revisionId: revision },
      ownerPrincipalId: row.owner_principal_id, name: row.name, visibility: row.visibility,
      schemaVersion: 1, revision, policyEpoch, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }
  }

  async createSharedProject(actor: AuthenticatedActor, input: RoxCommand<CreateSharedProject>, requestHash: string): Promise<SharedProjectResult> {
    // Defense in depth for service-side callers that bypass the transport gateway.
    const command = parseCreateSharedProject(input)
    if (requestHash !== createProjectRequestHash(command)) throw new IdentityDomainError('INVALID_PAYLOAD')
    try {
      const committed = await this.database.begin(async tx => {
      const member = await this.membership(tx, actor, command.workspaceId)
      // Bootstrap write policy is owner-only; members visibility changes read policy, not write permission.
      if (member.owner_principal_id !== actor.principalId || member.role !== 'owner') throw new IdentityDomainError('FORBIDDEN')
      if (member.name !== command.payload.workspaceName) throw new IdentityDomainError('INVALID_PAYLOAD')
      await this.query(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify(['project-command', command.workspaceId, actor.principalId, command.commandId])])
      await this.query(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify([command.workspaceId, actor.principalId, command.idempotencyKey])])
      const receipts = await this.query<ReceiptRow>(tx, `SELECT r.request_hash, r.idempotency_key, r.command_id, r.receipt_id, r.project_id, r.observed_revision::text, p.created_at AS project_created_at, p.updated_at AS project_updated_at, e.policy_epoch::text AS event_policy_epoch, e.aggregate_revision::text AS event_aggregate_revision, r.result FROM ${this.prefix}project_create_receipt r JOIN ${this.prefix}project p ON p.workspace_id = r.workspace_id AND p.project_id = r.project_id LEFT JOIN ${this.prefix}project_event e ON e.workspace_id = r.workspace_id AND e.project_id = r.project_id AND e.actor_principal_id = r.actor_principal_id AND e.type = 'project.created' AND e.causation_id = r.command_id
        WHERE r.workspace_id = $1 AND r.actor_principal_id = $2 AND (r.idempotency_key = $3 OR r.command_id = $4)`,
      [command.workspaceId, actor.principalId, command.idempotencyKey, command.commandId])
      if (receipts.length > 1) throw new IdentityDomainError('IDEMPOTENCY_CONFLICT')
      const receipt = receipts[0]
      if (receipt) {
        if (receipt.request_hash !== requestHash || receipt.idempotency_key !== command.idempotencyKey) {
          throw new IdentityDomainError('IDEMPOTENCY_CONFLICT')
        }
        const retained = retainedReceipt(receipt, actor, command)
        // Current policy/tombstone checks also apply to recovery from a persisted receipt.
        await this.readProject(tx, actor, command.workspaceId, receipt.project_id, member)
        return { result: retained, outcome: 'replayed' as const }
      }
      const projectId = randomUUID()
      const [row] = await this.query<ProjectRow>(tx, `INSERT INTO ${this.prefix}project
        (workspace_id, project_id, owner_principal_id, name, visibility)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [command.workspaceId, projectId, actor.principalId, command.payload.name, command.payload.visibility])
      if (!row) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      const data = this.project(row, member.policy_epoch)
      const verifiedAt = iso(row.created_at)
      const receiptId = randomUUID()
      const result: SharedProjectResult = {
        executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified', ok: true,
        status: 'applied', commandId: command.commandId, requestHash, observedRevision: data.revision,
        entityId: data.entity.entityId, entity: data.entity, receiptId, verifiedAt, data,
        receipt: { provider: 'rox-workspace', remoteId: data.entity.entityId, requestId: command.commandId,
          observedRevision: data.revision, verifiedAt },
      }
      await this.query(tx, `INSERT INTO ${this.prefix}project_create_receipt
        (workspace_id, actor_principal_id, idempotency_key, command_id, receipt_id, project_id,
          request_hash, observed_revision, result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [command.workspaceId, actor.principalId, command.idempotencyKey, command.commandId, receiptId, projectId,
        requestHash, data.revision, result])
      await this.lockEventAppend(tx)
      await this.query(tx, `INSERT INTO ${this.prefix}project_event
        (event_id, workspace_id, project_id, actor_principal_id, type, aggregate_revision, policy_epoch,
          causation_id, correlation_id, payload) VALUES ($1,$2,$3,$4,'project.created',$5,$6,$7,$7,$8::jsonb)`,
      [randomUUID(), command.workspaceId, projectId, actor.principalId, data.revision, member.policy_epoch,
        command.commandId, { entityId: data.entity.entityId }])
      return { result, outcome: 'applied' as const }
      })
      this.observability.projectCommitted(committed.outcome)
      return committed.result
    } catch (error) {
      this.observability.projectRejected(error instanceof IdentityDomainError && error.code === 'IDEMPOTENCY_CONFLICT')
      throw error
    }
  }

  /** Bootstrap append order must match commit order before a replay cursor can advance. */
  private async lockEventAppend(tx: TransactionSQL): Promise<void> {
    await this.query(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-events:${this.prefix}`])
  }

  private async readProject(tx: Database, actor: AuthenticatedActor, workspaceId: string, projectId: string, member: MembershipRow): Promise<SharedProject> {
    const [row] = await this.query<ProjectRow>(tx, `SELECT * FROM ${this.prefix}project
      WHERE workspace_id = $1 AND project_id = $2 AND deleted_at IS NULL
        AND (owner_principal_id = $3 OR visibility = 'members') FOR SHARE`, [workspaceId, requireUuid(projectId), actor.principalId])
    // A known raw ID yields the same denied response as an absent/private ID; no title/error oracle.
    if (!row) throw new IdentityDomainError('FORBIDDEN')
    return this.project(row, member.policy_epoch)
  }

  async getProject(actor: AuthenticatedActor, workspaceId: string, projectId: string): Promise<SharedProject> {
    return await this.database.begin(async tx => {
      const member = await this.membership(tx, actor, workspaceId)
      return this.readProject(tx, actor, workspaceId, projectId, member)
    })
  }

  private async cursor(tx: Database, actor: AuthenticatedActor, workspaceId: string, kind: string, epoch: string, token?: string): Promise<CursorPosition | undefined> {
    if (!token) return undefined
    requireUuid(token)
    const [row] = await this.query<{ position: CursorPosition }>(tx, `SELECT position FROM ${this.prefix}project_query_cursor
      WHERE cursor_id = $1 AND workspace_id = $2 AND principal_id = $3 AND kind = $4
        AND policy_epoch = $5 AND expires_at > clock_timestamp()`, [token, workspaceId, actor.principalId, kind, epoch])
    if (!row) throw new IdentityDomainError('CURSOR_INVALID')
    return row.position
  }

  private async saveCursor(tx: Database, actor: AuthenticatedActor, workspaceId: string, kind: string, epoch: string, position: CursorPosition): Promise<string> {
    const token = randomUUID()
    await this.query(tx, `INSERT INTO ${this.prefix}project_query_cursor
      (cursor_id, workspace_id, principal_id, kind, policy_epoch, position, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp() + interval '1 hour')`,
    [token, workspaceId, actor.principalId, kind, epoch, position])
    return token
  }

  async listProjects(actor: AuthenticatedActor, workspaceId: string, limit: number, token?: string) {
    this.requireLimit(limit)
    return await this.database.begin(async tx => {
      const member = await this.membership(tx, actor, workspaceId)
      const position = await this.cursor(tx, actor, workspaceId, 'projects', member.policy_epoch, token)
      const rows = await this.query<ProjectRow & { cursor_at: string }>(tx, `SELECT *, created_at::text AS cursor_at FROM ${this.prefix}project
        WHERE workspace_id = $1 AND deleted_at IS NULL AND (owner_principal_id = $2 OR visibility = 'members')
          AND ($3::timestamptz IS NULL OR (created_at, project_id) > ($3::timestamptz, $4::uuid))
        ORDER BY created_at, project_id LIMIT $5`,
      [workspaceId, actor.principalId, position?.at ?? null, position?.id ?? null, limit + 1])
      const visible = rows.slice(0, limit)
      const last = visible[visible.length - 1]
      const nextCursor = rows.length > limit && last
        ? await this.saveCursor(tx, actor, workspaceId, 'projects', member.policy_epoch, { at: last.cursor_at, id: last.project_id })
        : undefined
      return { items: visible.map(row => this.project(row, member.policy_epoch)), ...(nextCursor ? { nextCursor } : {}) }
    })
  }

  private requireLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new IdentityDomainError('INVALID_PAYLOAD')
  }

  private event(row: EventRow): IdentityDomainEvent {
    if (row.type === 'audit.license_reviewed') throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const payload: Record<string, string> = row.project_id ? { entityId: formatRox2EntityId('project', row.project_id) } : { principalId: row.actor_principal_id }
    if (!isDeepStrictEqual(row.payload, payload)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    return {
      id: row.event_id, type: row.type, workspaceId: row.workspace_id,
      ...(row.project_id ? { entityRef: { workspaceId: row.workspace_id,
        entityId: formatRox2EntityId('project', row.project_id), revisionId: String(row.aggregate_revision) } } : {}),
      actorPrincipalId: row.actor_principal_id, schemaVersion: 1,
      aggregateRevision: String(row.aggregate_revision), policyEpoch: String(row.policy_epoch),
      causationId: row.causation_id, correlationId: row.correlation_id, at: iso(row.created_at), payload,
    }
  }

  async replayEvents(actor: AuthenticatedActor, workspaceId: string, limit: number, token?: string) {
    this.requireLimit(limit)
    return await this.database.begin(async tx => {
      const member = await this.membership(tx, actor, workspaceId)
      const position = await this.cursor(tx, actor, workspaceId, 'events', member.policy_epoch, token)
      const rows = await this.query<EventRow>(tx, `SELECT e.* FROM ${this.prefix}project_event e
        LEFT JOIN ${this.prefix}project p ON p.workspace_id = e.workspace_id AND p.project_id = e.project_id
        WHERE e.workspace_id = $1 AND e.sequence > $2 AND
          (e.type = 'workspace.member_joined' OR (e.type = 'project.created' AND p.deleted_at IS NULL AND
            (p.owner_principal_id = $3 OR p.visibility = 'members')))
        ORDER BY e.sequence LIMIT $4`, [workspaceId, position?.sequence ?? '0', actor.principalId, limit])
      const last = rows[rows.length - 1]
      const sequence = last ? String(last.sequence) : position?.sequence ?? '0'
      const nextCursor = await this.saveCursor(tx, actor, workspaceId, 'events', member.policy_epoch, { sequence })
      return { events: rows.map(row => this.event(row)), nextCursor }
    })
  }

  /** Internal DB-only consumer: effect, inbox dedup and contiguous watermark commit together. */
  async consumeNextEvent(consumerId: string, effect: (tx: TransactionSQL, event: IdentityDomainEvent) => Promise<void>): Promise<boolean> {
    if (!consumerId.trim() || consumerId.length > 256) throw new IdentityDomainError('INVALID_PAYLOAD')
    let attemptedKey: string | undefined
    let retried = false
    try {
      const outcome = await this.database.begin(async tx => {
      // One consumer's deliveries are ordered; different consumers can run independently.
      await this.query(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-consumer:${this.prefix}:${consumerId}`])
      const [row] = await this.query<EventRow>(tx, `SELECT e.* FROM ${this.prefix}project_event e
        WHERE NOT EXISTS (SELECT 1 FROM ${this.prefix}project_event_inbox i
          WHERE i.consumer_id = $1 AND i.event_id = e.event_id)
        ORDER BY e.sequence LIMIT 1 FOR UPDATE OF e`, [consumerId])
      if (!row) {
        const [inbox] = await this.query<{ retained: boolean }>(tx, `SELECT EXISTS
          (SELECT 1 FROM ${this.prefix}project_event_inbox WHERE consumer_id = $1) AS retained`, [consumerId])
        return { committed: false as const, deduplicated: inbox?.retained === true }
      }
      attemptedKey = this.observability.attemptKey(consumerId, row.event_id)
      retried = this.observability.wasFailed(attemptedKey)
      const event = row.type === 'audit.license_reviewed' ? await this.licenseEvents?.verifyEvent(tx,row.event_id) : this.event(row)
      if (!event) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      await effect(tx, event)
      await this.query(tx, `INSERT INTO ${this.prefix}project_event_inbox (consumer_id, event_id) VALUES ($1,$2)`, [consumerId, row.event_id])
      await this.query(tx, `INSERT INTO ${this.prefix}project_projection_watermark (consumer_id, workspace_id, sequence)
        VALUES ($1,$2,$3) ON CONFLICT (consumer_id,workspace_id) DO UPDATE
          SET sequence = EXCLUDED.sequence, updated_at = clock_timestamp()`, [consumerId, row.workspace_id, String(row.sequence)])
      return { committed: true as const, key: attemptedKey }
      })
      if (outcome.committed) this.observability.consumerCommitted(outcome.key, retried)
      else this.observability.consumerEmpty(outcome.deduplicated)
      return outcome.committed
    } catch (error) {
      this.observability.consumerRejected(attemptedKey, retried)
      throw error
    }
  }

  /** Privileged provisioning port, intentionally not in SharedProjectAuthority or any client route. */
  async provisionWorkspace(principalId: string, workspaceId: string, name: string): Promise<void> {
    requireUuid(principalId); requireUuid(workspaceId)
    if (!name.trim() || name.length > 10000) throw new IdentityDomainError('INVALID_PAYLOAD')
    await this.database.begin(async tx => {
      const [principal] = await this.query<{ principal_id: string }>(tx, `SELECT principal_id FROM ${this.prefix}principal
        WHERE principal_id = $1 AND deleted_at IS NULL FOR SHARE`, [principalId])
      if (!principal) throw new IdentityDomainError('UNAUTHENTICATED')
      await this.query(tx, `INSERT INTO ${this.prefix}workspace (workspace_id,owner_principal_id,name) VALUES ($1,$2,$3)`, [workspaceId, principalId, name])
      await this.query(tx, `INSERT INTO ${this.prefix}workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'owner')`, [workspaceId, principalId])
      await this.lockEventAppend(tx)
      await this.query(tx, `INSERT INTO ${this.prefix}project_event
        (event_id,workspace_id,actor_principal_id,type,aggregate_revision,policy_epoch,causation_id,correlation_id,payload)
        VALUES ($1,$2,$3,'workspace.member_joined',1,1,$4,$4,$5::jsonb)`,
      [randomUUID(), workspaceId, principalId, `workspace-bootstrap:${workspaceId}`, { principalId }])
    })
  }
}
