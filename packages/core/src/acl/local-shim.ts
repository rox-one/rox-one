/**
 * W1-04 (#1501) — Local single-user ACL shim.
 *
 * The local host (server-core inside the Electron app / headless server) is
 * single-user: the owner principal owns every local entity (DATA-MODEL §8.3
 * "Local-authority entities: owner principal only"). The shim answers
 * `acl.can` with the `owner` role for owner principals, so wiring it into the
 * resolver host and link listings changes nothing for local data.
 *
 * By default every principal the host admitted is treated as the owner — the
 * same trust the local transport already applies today. Pass
 * `ownerPrincipalIds` to restrict ownership to known ids; any other principal
 * is then denied (`not_member`). Placeholder / deactivated principals are
 * always denied.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { AclAction } from './actions.ts'
import { decide, type Acl, type AclDecision, type AclPrincipal, type AclRoleResult } from './evaluate.ts'

/** Principal id used by server-core for the local (unauthenticated) actor. */
export const LOCAL_OWNER_PRINCIPAL_ID = 'local'

export interface LocalAclOptions {
  /** Restrict ownership to these principal ids (default: every admitted principal). */
  ownerPrincipalIds?: Iterable<string>
}

export interface LocalAcl extends Acl {
  readonly kind: 'local-shim'
}

export function createLocalAcl(options: LocalAclOptions = {}): LocalAcl {
  const owners = options.ownerPrincipalIds ? new Set(options.ownerPrincipalIds) : null

  const roleOf = async (principal: AclPrincipal, ref: EntityRef): Promise<AclRoleResult> => {
    const base: AclRoleResult = {
      role: null, source: null, secret: false, tags: [], championAbsent: false, hasChildren: false, kind: ref.kind,
    }
    if (principal.status === 'placeholder') return { ...base, denied: 'placeholder' }
    if (principal.status === 'deactivated') return { ...base, denied: 'inactive' }
    if (owners && !owners.has(principal.id)) return { ...base, denied: 'not_member' }
    // Owner of everything: champion-absent keeps the reviewer path irrelevant;
    // the owner role already satisfies every §8.3 rule.
    return { ...base, role: 'owner', source: 'local-owner', championAbsent: true }
  }

  const shim: LocalAcl = {
    kind: 'local-shim',
    async can(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<boolean> {
      return (await shim.evaluate(principal, action, ref)).allowed
    },
    async evaluate(principal: AclPrincipal, action: AclAction, ref: EntityRef): Promise<AclDecision> {
      return decide(action, await roleOf(principal, ref))
    },
    async evaluateMany(principal: AclPrincipal, action: AclAction, refs: readonly EntityRef[]): Promise<AclDecision[]> {
      return Promise.all(refs.map(ref => shim.evaluate(principal, action, ref)))
    },
    roleOf,
    async isActiveMember(principal: AclPrincipal): Promise<boolean> {
      if (principal.status === 'placeholder' || principal.status === 'deactivated') return false
      return !owners || owners.has(principal.id)
    },
  }
  return shim
}
