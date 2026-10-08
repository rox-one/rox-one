/**
 * Bro invite / presence / publication / projection routes.
 * W1-03 (#1500): moved out of `http.ts` unchanged.
 */

import { requireActor, requireUuid } from '../identity/commands.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send } from '../../routing.ts'

interface BroMatch {
  broSession: RegExpExecArray | null
  broRevoke: RegExpExecArray | null
  broJoin: boolean
}

export const broRoute = defineRoute<BroMatch>({
  name: 'collaboration.bro',
  match(path) {
    const broSession = /^\/v1\/workspaces\/([^/]+)\/sessions\/([^/]+)\/(bro-invites|bro-presence|bro-publication|bro-projection)$/.exec(path)
    const broRevoke = /^\/v1\/workspaces\/([^/]+)\/bro-invites\/([a-f0-9]{32})\/revoke$/.exec(path)
    const broJoin = path === '/v1/collaboration/bro-invites/join'
    return broSession || broRevoke || broJoin ? { broSession, broRevoke, broJoin } : null
  },
  async handle({ req, res, params, options, maxBytes, timeoutMs }, { broSession, broRevoke, broJoin }) {
    const { actorResolver } = options
    const collaboration = options.collaborationAuthority
    if (!collaboration) throw new HttpFailure('NOT_FOUND', 404)
    const presence = broSession?.[3] === 'bro-presence'
    const projection = broSession?.[3] === 'bro-projection'
    const publication = broSession?.[3] === 'bro-publication'
    const read = presence || projection
    const method = read ? 'GET' : 'POST'
    if (req.method !== method) throw new HttpFailure('METHOD_NOT_ALLOWED', 405, method)
    query(params, false)
    let bound = await actorResolver.authenticate(bearer(req))
    const bytes = await readBody(req, maxBytes, timeoutMs)
    if (read && bytes.length) throw new HttpFailure('INVALID_PAYLOAD', 400)
    const body = read ? undefined : jsonBody(bytes, req)
    const liveActor = async () => {
      bound = await actorResolver.revalidate(bound)
      return bound.actor
    }
    const workspaceId = broSession?.[1] ?? broRevoke?.[1]
    const sessionId = broSession?.[2]
    const result = broJoin ? await collaboration.join(liveActor, body)
      : broRevoke ? await collaboration.revoke(liveActor, requireUuid(workspaceId), broRevoke[2]!, body)
      : presence ? await collaboration.presence(liveActor, requireUuid(workspaceId), sessionId!)
      : projection ? await collaboration.projection(liveActor, requireUuid(workspaceId), sessionId!)
      : publication ? await collaboration.publish(liveActor, requireUuid(workspaceId), sessionId!, body)
      : await collaboration.invite(liveActor, requireUuid(workspaceId), sessionId!, body)
    const responseActor = await liveActor()
    if (broJoin) {
      if ('ok' in result && result.ok) requireActor(responseActor, requireUuid(result.workspaceId))
    } else requireActor(responseActor, requireUuid(workspaceId))
    send(res, 200, result)
  },
})

export const COLLABORATION_ROUTES = [broRoute] as const
