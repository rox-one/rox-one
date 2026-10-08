/**
 * W1-03 (#1500) — Authorization port for commands and realtime topics.
 *
 * Every command ACL check and every topic subscribe goes through an injected
 * `Authorizer`. Until W1-04 (#1501) lands `acl.can`, the default is a local
 * single-user shim that owns everything. This module is the single adapter:
 * swapping in the real engine is a one-line change in `createDefaultAuthorizer`.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandActor } from './registry.ts'

export interface AuthorizerPrincipal extends CommandActor {
  workspaceId: string
}

export interface Authorizer {
  /**
   * `action` is a command verb (`write`, `destroy`, …) or `read` for topic
   * subscriptions; `ref = null` means a workspace-level action (no target).
   */
  can(principal: AuthorizerPrincipal, action: string, ref: EntityRef | null): Promise<boolean>
}

/** STUB(#1501): single local user owns everything. Replaced by `acl.can` from W1-04. */
export const LOCAL_OWNER_AUTHORIZER: Authorizer = {
  async can() { return true },
}

/** The one place the default authorizer is chosen (STUB(#1501)). */
export function createDefaultAuthorizer(): Authorizer {
  return LOCAL_OWNER_AUTHORIZER
}

/** Fail-closed wrapper: a throwing authorizer denies. */
export async function authorize(authorizer: Authorizer, principal: AuthorizerPrincipal, action: string, ref: EntityRef | null): Promise<boolean> {
  try { return (await authorizer.can(principal, action, ref)) === true } catch { return false }
}
