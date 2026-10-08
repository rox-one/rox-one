/**
 * W1-04 (#1501) — Workspace ACL service.
 *
 * Binds the core engine (`createAcl`) to a fact source, maps the verified
 * `AuthenticatedActor` to an `AclPrincipal` (kind / status from `principal`)
 * and exposes the topic authorizer the W1-03 (#1500) realtime gateway injects.
 */

import {
  createAcl,
  createAclTopicAuthorizer,
  type AclEngine,
  type AclFactSource,
  type AclPrincipal,
  type AclPrincipalKind,
  type AclPrincipalStatus,
  type CreateAclOptions,
  type TopicAuthorizer,
} from '../../../../../packages/core/src/acl/index.ts'
import {
  IdentityDomainError,
  type AuthenticatedActor,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'

export interface PrincipalLookup {
  principal(principalId: string): Promise<{ kind: AclPrincipalKind; status: AclPrincipalStatus } | null>
}

export interface WorkspaceAcl {
  readonly engine: AclEngine
  /** Verified actor → ACL principal for `workspaceId` (throws UNAUTHENTICATED / FORBIDDEN). */
  principalFor(actor: AuthenticatedActor | null | undefined, workspaceId: string, linkToken?: string): Promise<AclPrincipal>
  /** Realtime gateway hook: every subscribe calls `acl.can(…, 'view', ref)`. */
  readonly topicAuthorizer: TopicAuthorizer
}

export function createWorkspaceAcl(facts: AclFactSource & PrincipalLookup, options: CreateAclOptions = {}): WorkspaceAcl {
  const engine = createAcl(facts, options)
  return {
    engine,
    async principalFor(actor, workspaceId, linkToken) {
      const verified = requireActor(actor, requireUuid(workspaceId))
      const record = await facts.principal(verified.principalId)
      if (!record) throw new IdentityDomainError('FORBIDDEN')
      return {
        id: verified.principalId,
        workspaceId,
        kind: record.kind,
        status: record.status,
        ...(linkToken ? { linkToken } : {}),
      }
    },
    topicAuthorizer: createAclTopicAuthorizer(engine),
  }
}

/**
 * `aclTopicAuthorizer(principal, topic)` for the W1-03 (#1500) gateway
 * `Authorizer` injection point. STUB(#1500): until the gateway lands, this is
 * exported for wiring only (see UNDONE in the #1501 report).
 */
export function aclTopicAuthorizer(acl: WorkspaceAcl): TopicAuthorizer {
  return acl.topicAuthorizer
}
