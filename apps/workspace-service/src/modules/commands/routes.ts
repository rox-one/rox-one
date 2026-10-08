/**
 * W1-03 (#1500) — `POST /v1/workspaces/{ws}/commands`: the generic command bus.
 *
 * Only active when the composition root passes `commandBus`; otherwise the
 * path answers 404 exactly as before. Check order mirrors the domain routes:
 * path decode → availability → method → query → bearer → body → revalidate
 * → execute → revalidate (no receipt leaks after a revoke) → 200 + receipt.
 * Every bus outcome (applied, duplicate, conflict, rejected) is a receipt with
 * HTTP 200; HTTP errors are reserved for transport-level failures. A store /
 * connection failure (`CommandStoreUnavailable`: nothing committed) answers
 * 503 SERVICE_UNAVAILABLE so the client's outbox retries the same envelope;
 * so does an identity-store failure while authenticating
 * (`AuthenticationUnavailableError`), which other routes still map to 401.
 *
 * Post-commit revalidation: if the session is revoked or membership is lost
 * while the command executes, the effect may already be committed but the
 * response is 401 / 403 and the receipt is withheld (same rule as the legacy
 * `project.createShared` route: no private result after a revoke). A client
 * that later regains access and retries the same envelope gets `duplicate`
 * with the original receipt (the read-only replay runs before the policy
 * stages), so the 401/403 is not a statement that nothing happened; a 401
 * pauses the outbox until new credentials arrive, a 403 is terminal on the
 * client.
 */

import { IdentityDomainError, type AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { CommandReceipt } from '../../../../../packages/core/src/commands/index.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { CommandStoreUnavailable } from '../../../../../packages/server-core/src/commands/store.ts'
import { AuthenticationUnavailableError } from '../../auth/verified-actor.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send } from '../../routing.ts'

/**
 * An identity-store outage while authenticating is not a credential problem:
 * answer 503 so the client's outbox backs off and retries rather than
 * pausing for new credentials (401).
 */
async function authPhase<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof AuthenticationUnavailableError) throw new HttpFailure('SERVICE_UNAVAILABLE', 503)
    throw error
  }
}

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
    let bound = await authPhase(() => actorResolver.authenticate(bearer(req)))
    const body = jsonBody(await readBody(req, maxBytes, timeoutMs), req)
    bound = await authPhase(() => actorResolver.revalidate(bound))
    requireActor(bound.actor, workspaceId)
    let receipt: CommandReceipt
    try {
      receipt = await bus.execute(bound.actor, workspaceId, body)
    } catch (error) {
      if (error instanceof CommandStoreUnavailable) throw new HttpFailure('SERVICE_UNAVAILABLE', 503)
      throw error
    }
    bound = await authPhase(() => actorResolver.revalidate(bound))
    requireActor(bound.actor, workspaceId)
    send(res, 200, receipt)
  },
})

export const COMMAND_ROUTES = [commandBusRoute] as const
