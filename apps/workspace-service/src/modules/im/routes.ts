/**
 * `/v1/im/*` — the relay bridge HTTP surface (docs/messenger/messenger-contract.md
 * §v1.1). Only active when the composition root passes `options.im`; otherwise
 * every path answers 404. Check order mirrors the notify/identity routes:
 * availability → method → query → bearer → body → act → revalidate → 2xx.
 *
 * Error mapping: the service's `ImError` becomes `HttpFailure(code, status)` so
 * http.ts serializes `{ error: { code } }` with `INVALID` (400), `FORBIDDEN`
 * (403), `NOT_FOUND` (404) and `RELAY_UNAVAILABLE` (502); a bad proof is an
 * `AuthenticationError` (401).
 */

import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { VerifiedActorSession } from '../../auth/verified-actor.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send, type WorkspaceRouteContext } from '../../routing.ts'
import { IM_PRESENCE_MAX_IDS, IM_SERVICE_EVENT_MAX_BYTES, ImError, type WorkspaceImHttpAuthority } from './service.ts'

const TOKEN_PATH = /^\/v1\/im\/token$/
const MEMBER_PATH = /^\/v1\/im\/channels\/([^/]+)\/members\/([^/]+)$/
const SERVICE_EVENTS_PATH = /^\/v1\/im\/channels\/([^/]+)\/service-events$/
const PRESENCE_PATH = /^\/v1\/im\/presence$/

type BoundSession = VerifiedActorSession<AuthenticatedActor>

function authority(ctx: WorkspaceRouteContext): WorkspaceImHttpAuthority {
  const im = ctx.options.im
  if (!im) throw new HttpFailure('NOT_FOUND', 404)
  return im
}

/** Decode a path segment as a canonical UUID (400 on anything else). */
function segmentUuid(value: string): string {
  try {
    return requireUuid(decodeURIComponent(value))
  } catch {
    throw new IdentityDomainError('INVALID_PAYLOAD')
  }
}

async function bound(ctx: WorkspaceRouteContext): Promise<BoundSession> {
  const session = await ctx.options.actorResolver.authenticate(bearer(ctx.req))
  requireActor(session.actor)
  return session
}

/** A revoke during the call withholds the response. */
async function revalidate(ctx: WorkspaceRouteContext, session: BoundSession): Promise<void> {
  const checked = await ctx.options.actorResolver.revalidate(session)
  requireActor(checked.actor)
}

/** Translate the module's domain errors into the shared HTTP failure. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ImError) throw new HttpFailure(error.code, error.status)
    throw error
  }
}

function presenceIds(params: URLSearchParams): string[] {
  const seen = new Set<string>()
  for (const [key] of params) {
    if (key !== 'userIds' || seen.has(key)) throw new HttpFailure('INVALID', 400)
    seen.add(key)
  }
  const raw = params.get('userIds')
  if (raw === null) throw new HttpFailure('INVALID', 400)
  const ids = raw.split(',').map(value => value.trim()).filter(value => value.length > 0)
  if (ids.length === 0 || ids.length > IM_PRESENCE_MAX_IDS) throw new HttpFailure('INVALID', 400)
  return ids
}

export const imTokenRoute = defineRoute<Record<string, never>>({
  name: 'im.token',
  match(path) {
    return TOKEN_PATH.test(path) ? {} : null
  },
  async handle(ctx) {
    const { req, res, params, maxBytes, timeoutMs } = ctx
    const im = authority(ctx)
    if (req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
    query(params, false)
    const session = await bound(ctx)
    const body = jsonBody(await readBody(req, maxBytes, timeoutMs), req)
    const result = await guarded(() => im.requestToken(session.actor, body))
    await revalidate(ctx, session)
    send(res, 200, result)
  },
})

export const imChannelMemberRoute = defineRoute<{ channelSegment: string; userSegment: string }>({
  name: 'im.channelMember',
  match(path) {
    const matched = MEMBER_PATH.exec(path)
    return matched?.[1] !== undefined && matched[2] !== undefined
      ? { channelSegment: matched[1], userSegment: matched[2] }
      : null
  },
  async handle(ctx, { channelSegment, userSegment }) {
    const { req, res, params } = ctx
    const im = authority(ctx)
    if (req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
    query(params, false)
    const session = await bound(ctx)
    const channelId = segmentUuid(channelSegment)
    const userId = segmentUuid(userSegment)
    const result = await guarded(() => im.channelMember(session.actor, channelId, userId))
    await revalidate(ctx, session)
    send(res, 200, result)
  },
})

export const imServiceEventsRoute = defineRoute<{ channelSegment: string }>({
  name: 'im.serviceEvents',
  match(path) {
    const matched = SERVICE_EVENTS_PATH.exec(path)
    return matched?.[1] !== undefined ? { channelSegment: matched[1] } : null
  },
  async handle(ctx, { channelSegment }) {
    const { req, res, params, maxBytes, timeoutMs } = ctx
    const im = authority(ctx)
    if (req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
    query(params, false)
    const session = await bound(ctx)
    const channelId = segmentUuid(channelSegment)
    const limit = Math.min(maxBytes, IM_SERVICE_EVENT_MAX_BYTES)
    const body = jsonBody(await readBody(req, limit, timeoutMs), req)
    const result = await guarded(() => im.publishServiceEvent(session.actor, channelId, body))
    await revalidate(ctx, session)
    send(res, result.created ? 201 : 200, { eventId: result.eventId })
  },
})

export const imPresenceRoute = defineRoute<Record<string, never>>({
  name: 'im.presence',
  match(path) {
    return PRESENCE_PATH.test(path) ? {} : null
  },
  async handle(ctx) {
    const { req, res, params } = ctx
    const im = authority(ctx)
    if (req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
    const userIds = presenceIds(params)
    const session = await bound(ctx)
    const result = await guarded(() => im.presence(session.actor, userIds))
    await revalidate(ctx, session)
    send(res, 200, result)
  },
})

export const IM_ROUTES = [imTokenRoute, imChannelMemberRoute, imServiceEventsRoute, imPresenceRoute] as const
