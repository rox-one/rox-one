/**
 * W1-03 (#1500) — The workspace service's single Authorizer adapter.
 *
 * STUB(#1501): until W1-04 lands `acl.can`, every current workspace member
 * may run every command and read every entity-scoped topic; personal topics
 * (`user:{id}`) are readable only by that principal and `workspace:{id}` only
 * inside that workspace. Membership itself is already enforced by the
 * transport (`requireActor` + session revalidation). Replace the body of
 * `createWorkspaceAuthorizer` with the W1-04 engine — a one-line change.
 */

import type { Authorizer } from '../../../../../packages/core/src/commands/index.ts'
import type { TopicAclTarget } from '../../../../../packages/core/src/events/index.ts'

/** Topic read check used by the realtime gateway (subscribe + every delivery). */
export interface TopicAuthorizer {
  canReadTopic(principal: { principalId: string; workspaceId: string }, target: TopicAclTarget): Promise<boolean>
}

export type WorkspaceAuthorizer = Authorizer & TopicAuthorizer

/** STUB(#1501) member shim. */
export const WORKSPACE_MEMBER_AUTHORIZER: WorkspaceAuthorizer = {
  async can(principal) {
    return Boolean(principal.principalId && principal.workspaceId)
  },
  async canReadTopic(principal, target) {
    if (target.kind === 'self') return target.principalId === principal.principalId
    if (target.kind === 'workspace') return target.workspaceId === principal.workspaceId
    return Boolean(principal.principalId)
  },
}

export function createWorkspaceAuthorizer(): WorkspaceAuthorizer {
  return WORKSPACE_MEMBER_AUTHORIZER
}
