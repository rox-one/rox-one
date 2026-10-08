/**
 * W1-09 (#1506) — Notify HTTP routes: the mark-read endpoint and the Inbox list.
 *
 * Only active when the composition root passes `notify`; otherwise both paths
 * answer 404 exactly as before. Check order mirrors the domain routes: path
 * decode → availability → method → query → bearer → body → revalidate → act →
 * revalidate (nothing leaks after a revoke) → 200.
 *
 * Every route is scoped to the authenticated principal: there is no path to
 * another principal's notifications, and `user:{id}` is the only topic the
 * service pushes on.
 */

import { IdentityDomainError, type AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { notificationReadRequestSchema } from '../../../../../packages/shared/src/notify/schemas.ts'
import type { VerifiedActorSession } from '../../auth/verified-actor.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send, type WorkspaceRouteContext } from '../../routing.ts'

/** Default page size of the Inbox list (the routing query grammar caps it at 100). */
export const NOTIFY_DEFAULT_LIMIT = 50

const LIST_PATH = /^\/v1\/workspaces\/([^/]+)\/notifications$/
const READ_PATH = /^\/v1\/workspaces\/([^/]+)\/notifications\/read$/

type BoundSession = VerifiedActorSession<AuthenticatedActor>

/** Decode the workspace segment and authenticate, as the domain routes do. */
async function bound(ctx: WorkspaceRouteContext, workspaceSegment: string): Promise<{ session: BoundSession; workspaceId: string }> {
  let workspaceId: string
  try { workspaceId = requireUuid(decodeURIComponent(workspaceSegment)) }
  catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
  const session = await ctx.options.actorResolver.authenticate(bearer(ctx.req))
  requireActor(session.actor, workspaceId)
  return { session, workspaceId }
}

/** Post-handler revalidation: a revoke during the call withholds the response. */
async function revalidate(ctx: WorkspaceRouteContext, session: BoundSession, workspaceId: string): Promise<void> {
  const checked = await ctx.options.actorResolver.revalidate(session)
  requireActor(checked.actor, workspaceId)
}

export const notifyListRoute = defineRoute<{ workspaceSegment: string }>({
  name: 'notify.list',
  match(path) {
    const matched = LIST_PATH.exec(path)
    return matched?.[1] !== undefined ? { workspaceSegment: matched[1] } : null
  },
  async handle(ctx, { workspaceSegment }) {
    const { req, res, params, options } = ctx
    const authority = options.notify
    if (!authority) throw new HttpFailure('NOT_FOUND', 404)
    if (req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
    const paging = query(params, true)
    const { session, workspaceId } = await bound(ctx, workspaceSegment)
    const result = await authority.list(session.actor, workspaceId, {
      limit: paging.limit ?? NOTIFY_DEFAULT_LIMIT,
      ...(paging.cursor ? { cursor: paging.cursor } : {}),
    })
    await revalidate(ctx, session, workspaceId)
    send(res, 200, result)
  },
})

export const notifyMarkReadRoute = defineRoute<{ workspaceSegment: string }>({
  name: 'notify.markRead',
  match(path) {
    const matched = READ_PATH.exec(path)
    return matched?.[1] !== undefined ? { workspaceSegment: matched[1] } : null
  },
  async handle(ctx, { workspaceSegment }) {
    const { req, res, params, options, maxBytes, timeoutMs } = ctx
    const authority = options.notify
    if (!authority) throw new HttpFailure('NOT_FOUND', 404)
    if (req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
    query(params, false)
    const { session, workspaceId } = await bound(ctx, workspaceSegment)
    const parsed = notificationReadRequestSchema.safeParse(jsonBody(await readBody(req, maxBytes, timeoutMs), req))
    if (!parsed.success) throw new IdentityDomainError('INVALID_PAYLOAD')
    const result = 'ids' in parsed.data
      ? await authority.markRead(session.actor, workspaceId, parsed.data.ids)
      : await authority.markAllRead(session.actor, workspaceId, parsed.data.kind)
    await revalidate(ctx, session, workspaceId)
    send(res, 200, result)
  },
})

export const NOTIFY_ROUTES = [notifyListRoute, notifyMarkReadRoute] as const