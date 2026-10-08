/**
 * W1-04 (#1501) — ACL actions.
 *
 * The action vocabulary is part of the contracts-v1 freeze: keep it in this
 * single exported const array and only ever append (PLAN §1.2 RFC).
 * Rules per action live in `../entities/permissions.ts` (DATA-MODEL §8.3).
 */

import type { Rox2Permission } from '../rox2/platform-contract.ts'

export const ACL_ACTIONS = [
  /** See title / status in trees, listings and the Work Map (no content). */
  'view_title',
  /** Read the entity and its full preview. */
  'view',
  'comment',
  'react',
  /** Edit fields, add targets / checks / milestones, move tasks between statuses. */
  'edit',
  'check_in',
  /** Acknowledge a check-in or retrospective. */
  'acknowledge',
  /** Close / reopen / pause / resume / move between spaces. */
  'close',
  'delete',
  /** Share / change privacy / manage collaborators. */
  'manage_access',
  /** Create a child inside this container (space / list / folder / project). */
  'create_child',
  /** Transfer ownership. */
  'transfer',
] as const

export type AclAction = (typeof ACL_ACTIONS)[number]

const ACTION_SET: ReadonlySet<string> = new Set(ACL_ACTIONS)

export function isAclAction(value: unknown): value is AclAction {
  return typeof value === 'string' && ACTION_SET.has(value)
}

/**
 * Closest Rox2 platform verb per action (DATA-MODEL §8.1 "Rox2 verbs granted")
 * so command definitions declared with a `Rox2Permission` verb can be mapped
 * onto an ACL action. `comment`/`react` have no Rox2 verb of their own and map
 * to `read` (the minimum Rox2 grant they imply).
 */
export const ACL_ACTION_ROX2_VERB: Readonly<Record<AclAction, Rox2Permission>> = {
  view_title: 'read',
  view: 'read',
  comment: 'read',
  react: 'read',
  edit: 'write',
  check_in: 'write',
  acknowledge: 'write',
  close: 'write',
  delete: 'destroy',
  manage_access: 'share',
  create_child: 'write',
  transfer: 'share',
}

/** Rox2 verb → ACL action used when a command only declares a Rox2 verb. */
export function aclActionForRox2Verb(verb: Rox2Permission): AclAction | null {
  switch (verb) {
    case 'read':
      return 'view'
    case 'write':
    case 'publish':
      return 'edit'
    case 'share':
      return 'manage_access'
    case 'destroy':
      return 'delete'
    default:
      // spend / device-read / cloud-send are execution permissions, not ACL.
      return null
  }
}
