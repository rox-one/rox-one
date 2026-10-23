/**
 * Relay-bridge application service: org-membership-gated relay tokens, channel
 * membership reads, idempotent call service events and presence passthrough.
 *
 * The service owns the decisions; the routes only decode/validate transport
 * input. Every dependency (repository, directory, relay) is injected so the
 * HTTP tests run with fakes and no database.
 *
 * Error vocabulary (mapped by `routes.ts`): `INVALID` (400), `FORBIDDEN`
 * (403), `NOT_FOUND` (404), `RELAY_UNAVAILABLE` (502). A bad schnorr proof is
 * an authentication failure (`AuthenticationError` → 401).
 */

import { buildCallServiceEvent, imTokenChallenge, verifyChallenge, type NostrEvent } from '@rox/shared/messenger-relay'
import type { AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { AuthenticationError } from '../../auth/verified-actor.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import type { ImDirectoryPort, ImRepository } from './repository.ts'
import { ImIdentityConflictError } from './repository.ts'
import type { ImPresenceEntry, ImRelayClient, ImRelayConfig } from './relay-client.ts'

/** Contract: service-event bodies are capped at 16 KiB. */
export const IM_SERVICE_EVENT_MAX_BYTES = 16 * 1024
/** Max rox user ids accepted by `GET /v1/im/presence`. */
export const IM_PRESENCE_MAX_IDS = 100
/** ±5 minutes around `issuedAt` before a token proof is stale. */
const TOKEN_PROOF_WINDOW_MS = 5 * 60 * 1000

export type ImServiceEventType = 'call.started' | 'call.ended' | 'call.transcript'
export const IM_SERVICE_EVENT_TYPES: readonly ImServiceEventType[] = ['call.started', 'call.ended', 'call.transcript']

export type ImErrorCode = 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'RELAY_UNAVAILABLE'

export class ImError extends Error {
  constructor(readonly code: ImErrorCode, readonly status: number) {
    super(code)
    this.name = 'ImError'
  }
}

export interface ImTokenResult {
  readonly relayUrl: string
  readonly pubkey: string
  /** The relay-admin add-member event, when the relay accepted this registration. */
  readonly authEvent?: NostrEvent
  readonly expiresAt: string
}

export interface ImChannelMemberResult {
  readonly role: 'owner' | 'admin' | 'member'
}

export interface ImServiceEventResult {
  readonly eventId: string
  /** `false` when the `(callId, type)` pair was already recorded (idempotent repeat). */
  readonly created: boolean
}

/** Per-channel Лента item the notify/realtime fan-out consumes. */
export interface ImFeedItem {
  readonly source: 'messenger'
  readonly orgId: string
  readonly channelId: string
  readonly kind: ImServiceEventType
  readonly callId: string
  readonly eventId: string
  readonly at: string
}

export type ImFeedPublisher = (item: ImFeedItem) => void | Promise<void>

export interface ImServiceOptions {
  readonly repository: ImRepository
  readonly directory: ImDirectoryPort
  readonly relay: ImRelayClient
  readonly config: ImRelayConfig
  /** Optional per-channel feed fan-out (wired to notify by the composition root). */
  readonly feed?: ImFeedPublisher
  readonly now?: () => Date
}

interface TokenRequest {
  pubkey: string
  proof: string
  issuedAt: number
  orgId?: string
}

interface ServiceEventInput {
  type: ImServiceEventType
  callId: string
  content: Record<string, unknown>
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ImError('INVALID', 400)
  return value as Record<string, unknown>
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ImError('INVALID', 400)
  return value
}

function parseTokenRequest(raw: unknown): TokenRequest {
  const body = objectBody(raw)
  const allowed = new Set(['pubkey', 'proof', 'issuedAt', 'orgId'])
  if (Object.keys(body).some(key => !allowed.has(key))) throw new ImError('INVALID', 400)
  const pubkey = text(body.pubkey, 64)
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new ImError('INVALID', 400)
  const proof = text(body.proof, 128)
  if (!/^[0-9a-f]{128}$/.test(proof)) throw new ImError('INVALID', 400)
  if (typeof body.issuedAt !== 'number' || !Number.isInteger(body.issuedAt)) throw new ImError('INVALID', 400)
  return { pubkey, proof, issuedAt: body.issuedAt, ...(body.orgId === undefined ? {} : { orgId: text(body.orgId, 64) }) }
}

function isImServiceEventType(value: unknown): value is ImServiceEventType {
  return typeof value === 'string' && (IM_SERVICE_EVENT_TYPES as readonly string[]).includes(value)
}

function parseServiceEvent(raw: unknown): ServiceEventInput {
  const body = objectBody(raw)
  const type = body.type
  if (!isImServiceEventType(type)) throw new ImError('INVALID', 400)
  const callId = text(body.callId, 128)
  const roomName = typeof body.roomName === 'string' && body.roomName.trim() ? body.roomName.trim() : undefined
  const content: Record<string, unknown> = { type }
  if (roomName) content.roomName = roomName
  if (type === 'call.started') {
    if (body.startedBy !== undefined) content.startedBy = text(body.startedBy, 64)
    const ts = body.ts
    if (ts !== undefined && (typeof ts !== 'number' || !Number.isFinite(ts))) throw new ImError('INVALID', 400)
    if (ts !== undefined) content.ts = ts
  }
  if (type === 'call.ended') {
    const durationSec = body.durationSec
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) throw new ImError('INVALID', 400)
    content.durationSec = durationSec
    if (body.participants !== undefined) {
      if (!Array.isArray(body.participants) || body.participants.some(id => typeof id !== 'string')) throw new ImError('INVALID', 400)
      content.participants = [...body.participants]
    } else content.participants = []
  }
  if (type === 'call.transcript') {
    content.transcriptUrl = text(body.transcriptUrl, 2048)
    if (body.summary !== undefined) content.summary = text(body.summary, 4096)
  }
  return { type, callId, content }
}

export class ImService {
  private readonly repository: ImRepository
  private readonly directory: ImDirectoryPort
  private readonly relay: ImRelayClient
  private readonly config: ImRelayConfig
  private readonly feed: ImFeedPublisher | undefined
  private readonly now: () => Date

  constructor(options: ImServiceOptions) {
    this.repository = options.repository
    this.directory = options.directory
    this.relay = options.relay
    this.config = options.config
    this.feed = options.feed
    this.now = options.now ?? (() => new Date())
  }

  /** The org the token is scoped to: explicit `orgId`, else the actor's only workspace. */
  private resolveOrg(actor: AuthenticatedActor, orgId: string | undefined): string {
    if (orgId !== undefined) return requireUuid(orgId)
    if (actor.authenticatedWorkspaceIds.length === 1) return actor.authenticatedWorkspaceIds[0]!
    throw new ImError('INVALID', 400)
  }

  async requestToken(actor: AuthenticatedActor | null | undefined, body: unknown): Promise<ImTokenResult> {
    const verified = requireActor(actor)
    const request = parseTokenRequest(body)
    const orgId = this.resolveOrg(verified, request.orgId)
    // The token must cover the org, and the org must still list the principal.
    requireActor(verified, orgId)
    const membership = await this.directory.orgMembership(orgId, verified.principalId)
    if (!membership) throw new ImError('FORBIDDEN', 403)
    if (Math.abs(this.now().getTime() - request.issuedAt) > TOKEN_PROOF_WINDOW_MS) throw new AuthenticationError()
    const challenge = imTokenChallenge({ orgId, principalId: verified.principalId, pubkey: request.pubkey, issuedAt: request.issuedAt })
    if (!verifyChallenge(request.pubkey, challenge, request.proof)) throw new AuthenticationError()
    await this.revokeExpiredMembers()
    const expiresAt = new Date(this.now().getTime() + this.config.tokenTtlSeconds * 1000).toISOString()
    try {
      await this.repository.upsertIdentity(verified.principalId, request.pubkey, expiresAt)
    } catch (error) {
      if (error instanceof ImIdentityConflictError) throw new ImError('INVALID', 400)
      throw error
    }
    let authEvent: NostrEvent | undefined
    try {
      // Re-publish add-member on every token so TTL refresh re-authorises the pubkey.
      authEvent = await this.relay.addMember(request.pubkey)
    } catch (error) {
      throw new ImError('RELAY_UNAVAILABLE', 502)
    }
    return {
      relayUrl: this.config.relayUrl,
      pubkey: request.pubkey,
      ...(authEvent ? { authEvent } : {}),
      expiresAt,
    }
  }

  async channelMember(actor: AuthenticatedActor | null | undefined, channelId: string, userId: string): Promise<ImChannelMemberResult> {
    const verified = requireActor(actor)
    if (!(await this.directory.channelExists(channelId))) throw new ImError('NOT_FOUND', 404)
    // Guests are members only of the channels they were invited to, so this
    // also stops a guest probing a channel they do not belong to.
    if (!(await this.directory.channelMembership(channelId, verified.principalId))) throw new ImError('FORBIDDEN', 403)
    const target = await this.directory.channelMembership(channelId, userId)
    if (!target) throw new ImError('NOT_FOUND', 404)
    return { role: target.role }
  }

  async publishServiceEvent(actor: AuthenticatedActor | null | undefined, channelId: string, body: unknown): Promise<ImServiceEventResult> {
    const verified = requireActor(actor)
    const input = parseServiceEvent(body)
    if (!(await this.directory.channelExists(channelId))) throw new ImError('NOT_FOUND', 404)
    if (!(await this.directory.channelMembership(channelId, verified.principalId))) throw new ImError('FORBIDDEN', 403)
    const existing = await this.repository.findServiceEvent(input.callId, input.type)
    if (existing) return { eventId: existing.eventId, created: false }
    const event = buildCallServiceEvent({
      secretKey: this.config.secretKey,
      channelId,
      callId: input.callId,
      content: input.content,
    })
    // Reserve the idempotency key before publishing so concurrent callers
    // cannot both publish and both report created: true.
    const reserved = await this.repository.tryInsertServiceEvent({
      callId: input.callId,
      type: input.type,
      eventId: event.id,
      channelId,
    })
    if (!reserved) {
      const winner = await this.repository.findServiceEvent(input.callId, input.type)
      if (winner) return { eventId: winner.eventId, created: false }
      throw new ImError('INVALID', 400)
    }
    try {
      await this.relay.publishEvent(event)
    } catch (error) {
      throw new ImError('RELAY_UNAVAILABLE', 502)
    }
    if (this.feed) {
      const orgId = await this.directory.channelOrg(channelId)
      if (orgId) {
        await this.feed({ source: 'messenger', orgId, channelId, kind: input.type, callId: input.callId, eventId: event.id, at: this.now().toISOString() })
      }
    }
    return { eventId: event.id, created: true }
  }

  async presence(actor: AuthenticatedActor | null | undefined, userIds: readonly string[]): Promise<ImPresenceEntry[]> {
    const verified = requireActor(actor)
    if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > IM_PRESENCE_MAX_IDS) throw new ImError('INVALID', 400)
    for (const id of userIds) requireUuid(id)
    await this.revokeExpiredMembers()
    // Cross-tenant presence leak guard: only peers that share an active org.
    const allowed = await this.directory.sharedOrgPeers(verified.principalId, userIds)
    if (allowed.length === 0) return []
    try {
      return await this.relay.presence(allowed)
    } catch (error) {
      throw new ImError('RELAY_UNAVAILABLE', 502)
    }
  }

  /** Drop relay membership for identities past expires_at (enforces token TTL). */
  async revokeExpiredMembers(): Promise<number> {
    const expired = await this.repository.listExpiredIdentities(this.now().toISOString())
    let revoked = 0
    for (const row of expired) {
      try {
        await this.relay.removeMember(row.pubkey)
      } catch {
        // Best-effort: a transient relay blip must not block token issuance.
      }
      await this.repository.deleteIdentity(row.userId)
      revoked += 1
    }
    return revoked
  }
}

/** The authority behind the `/v1/im/*` routes. */
export interface WorkspaceImHttpAuthority {
  requestToken(actor: AuthenticatedActor, body: unknown): Promise<ImTokenResult>
  channelMember(actor: AuthenticatedActor, channelId: string, userId: string): Promise<ImChannelMemberResult>
  publishServiceEvent(actor: AuthenticatedActor, channelId: string, body: unknown): Promise<ImServiceEventResult>
  presence(actor: AuthenticatedActor, userIds: readonly string[]): Promise<ImPresenceEntry[]>
}

export function imHttpAuthority(service: ImService): WorkspaceImHttpAuthority {
  return {
    requestToken: (actor, body) => service.requestToken(actor, body),
    channelMember: (actor, channelId, userId) => service.channelMember(actor, channelId, userId),
    publishServiceEvent: (actor, channelId, body) => service.publishServiceEvent(actor, channelId, body),
    presence: (actor, userIds) => service.presence(actor, userIds),
  }
}

/** Removal hook: delete the user's relay identity and revoke relay membership. */
export interface ImMemberRevoker {
  revoke(userId: string): Promise<{ revoked: boolean; pubkey: string | null }>
}

export function createImMemberRevoker(deps: { repository: ImRepository; relay: ImRelayClient }): ImMemberRevoker {
  return {
    async revoke(userId) {
      const pubkey = await deps.repository.deleteIdentity(userId)
      if (!pubkey) return { revoked: false, pubkey: null }
      try {
        await deps.relay.removeMember(pubkey)
      } catch (error) {
        throw new ImError('RELAY_UNAVAILABLE', 502)
      }
      return { revoked: true, pubkey }
    },
  }
}
