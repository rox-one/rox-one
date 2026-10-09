import { LOCAL_ROX_CALLER } from '@rox/shared/auth'

import type { RequestContext } from '../../transport/types'

/**
 * The server-side actor id used for session attribution and write-access
 * checks (a1.3/a2.5): a cloud principal is its subject, a local/desktop caller
 * is the installation identity.
 *
 * Clients receive exactly this value from `identity:getState` (`sessionActorId`)
 * so a desktop "assign to me" targets the same id space the server compares and
 * does not lock the actor out of its own session.
 */
export function sessionActorIdFor(ctx: RequestContext): string {
  return ctx.principal?.subject ?? LOCAL_ROX_CALLER.subject
}