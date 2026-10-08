/**
 * W1-03 (#1500) — `POST /v1/workspaces/{ws}/commands`: the generic command bus.
 *
 * Only active when the composition root passes `commandBus`; otherwise the
 * path answers 404 exactly as before. Check order mirrors the domain routes:
 * path decode → availability → method → query → bearer → body → revalidate
 * → execute → revalidate (no receipt leaks after a revoke) → 200 + receipt.
 * Every bus outcome (applied, duplicate, conflict, rejected) is a receipt with
 * HTTP 200; HTTP errors are reserved for transport-level failures.
 */

import { IdentityDomainError, type AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { CommandReceipt } from '../../../../../packages/core/src/commands/index.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send } from '../../routing.ts'

export interface WorkspaceCommandHttpAuthority {
  execute(actor: AuthenticatedActor, workspaceId: string, envelope: unknown): Promise<CommandReceipt>
}

export const commandBusRoute = defineRoute<{ workspaceSegment: string }>({
  name: 'commands.execute',
  match(path) {
    const matched = /^\/v1\/workspaces\/([^/]+)\/commands$/.exec(path)
    return matched?.[1] !== undefined ? { workspaceSegment: matched[1] } : null
  },
  async handle({ req, res, params, options, maxBytes, timeoutMs }, { workspaceSegment }) {
    const bus = options.commandBus
    if (!bus) throw new HttpFailure('NOT_FOUND', 404)
    let workspaceId: string
    try { workspaceId = requireUuid(decodeURIComponent(workspaceSegment)) }
    catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
    if (req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
    query(params, false)
    const { actorResolver } = options
    let bound = await actorResolver.authenticate(bearer(req))
    const body = jsonBody(await readBody(req, maxBytes, timeoutMs), req)
    bound = await actorResolver.revalidate(bound)
    requireActor(bound.actor, workspaceId)
    const receipt = await bus.execute(bound.actor, workspaceId, body)
    bound = await actorResolver.revalidate(bound)
    requireActor(bound.actor, workspaceId)
    send(res, 200, receipt)
  },
})

export const COMMAND_ROUTES = [commandBusRoute] as const
