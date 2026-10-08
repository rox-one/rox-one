/**
 * W1-04 (#1501) — ACL role lattice.
 *
 * DATA-MODEL §8.1. One lattice for every resource type, ordered by the
 * Operately access level each role maps to:
 *
 *   minimal (1) < viewer (10) < commenter (40) < editor (70) < manager (90) < owner (100)
 *
 * `no_access` (0) is the absence of a role (`null`). The Lark special roles
 * (`follower`, `guest`, `free_busy`) are stored in `acl_entry.role` but are
 * folded onto the lattice before evaluation (see `effectiveRole`).
 *
 * Naming note: the W1-04 package card spells the lattice
 * "viewer / commenter / editor / full_access / owner". The DDL (`503-acl.sql`)
 * and DATA-MODEL §8.1 call the fourth step `manager`; that is the canonical
 * name here and `full_access` / `admin` are accepted as aliases of it via
 * `normalizeRoleAlias`. Operately *levels* convert through the §8.1 table
 * (`full` 100 → owner, `admin` 90 → manager).
 *
 * Clean-room: no Operately source is copied; only the published numeric
 * levels are reused as data.
 */

/** Lattice roles in ascending order. Part of the contracts-v1 freeze. */
export const ACL_ROLES = ['minimal', 'viewer', 'commenter', 'editor', 'manager', 'owner'] as const

export type AclRole = (typeof ACL_ROLES)[number]

/** Lark special roles; stored as-is, evaluated through `effectiveRole`. */
export const ACL_SPECIAL_ROLES = ['follower', 'guest', 'free_busy'] as const

export type AclSpecialRole = (typeof ACL_SPECIAL_ROLES)[number]

/** Every value accepted by `acl_entry.role` (DDL `503-acl.sql`). */
export type AclStoredRole = AclRole | AclSpecialRole

/** Operately access levels (numeric values are the Operately wire values). */
export const OPERATELY_ACCESS_LEVELS = {
  no_access: 0,
  minimal_access: 1,
  view_access: 10,
  comment_access: 40,
  edit_access: 70,
  admin_access: 90,
  full_access: 100,
} as const

export type OperatelyAccessLevelName = keyof typeof OPERATELY_ACCESS_LEVELS

/** Role → Operately level (DATA-MODEL §8.1 table). */
export const ROLE_LEVEL: Readonly<Record<AclRole, number>> = {
  minimal: 1,
  viewer: 10,
  commenter: 40,
  editor: 70,
  manager: 90,
  owner: 100,
}

const ROLE_SET: ReadonlySet<string> = new Set(ACL_ROLES)
const SPECIAL_SET: ReadonlySet<string> = new Set(ACL_SPECIAL_ROLES)

export function isAclRole(value: unknown): value is AclRole {
  return typeof value === 'string' && ROLE_SET.has(value)
}

export function isAclStoredRole(value: unknown): value is AclStoredRole {
  return typeof value === 'string' && (ROLE_SET.has(value) || SPECIAL_SET.has(value))
}

/** Numeric rank; `null` (no access) ranks 0. */
export function roleLevel(role: AclRole | null | undefined): number {
  return role ? ROLE_LEVEL[role] : 0
}

/** True when `role` is at least `min` on the lattice. `null` is never enough. */
export function roleAtLeast(role: AclRole | null | undefined, min: AclRole): boolean {
  return roleLevel(role) >= ROLE_LEVEL[min]
}

/** Highest of two roles (`null` = no access). */
export function maxRole(a: AclRole | null | undefined, b: AclRole | null | undefined): AclRole | null {
  const left = a ?? null
  const right = b ?? null
  if (!left) return right
  if (!right) return left
  return ROLE_LEVEL[left] >= ROLE_LEVEL[right] ? left : right
}

/** Lowest of two roles; used to cap a role (e.g. guests). */
export function minRole(a: AclRole | null | undefined, b: AclRole): AclRole | null {
  if (!a) return null
  return ROLE_LEVEL[a] <= ROLE_LEVEL[b] ? a : b
}

/**
 * Fold a stored role onto the lattice:
 * - `follower` (Lark task follower) reads → `viewer`;
 * - `guest` (Lark external guest grant) reads → `viewer`;
 * - `free_busy` (calendar free/busy only) → `minimal` (title/status, no content).
 */
export function effectiveRole(role: AclStoredRole): AclRole {
  switch (role) {
    case 'follower':
    case 'guest':
      return 'viewer'
    case 'free_busy':
      return 'minimal'
    default:
      return role
  }
}

/** Operately level → role (DATA-MODEL §8.1). Levels between steps round down; 0 → null. */
export function roleFromOperatelyLevel(level: number): AclRole | null {
  if (!Number.isFinite(level) || level <= 0) return null
  let best: AclRole | null = null
  for (const role of ACL_ROLES) {
    if (ROLE_LEVEL[role] <= level) best = role
  }
  return best
}

export function operatelyLevelForRole(role: AclRole | null): number {
  return roleLevel(role)
}

const ROLE_ALIASES: Readonly<Record<string, AclRole>> = {
  // Package-card / Operately role names.
  full_access: 'manager',
  admin: 'manager',
  admin_access: 'manager',
  edit: 'editor',
  edit_access: 'editor',
  comment: 'commenter',
  comment_access: 'commenter',
  view: 'viewer',
  view_access: 'viewer',
  minimal_access: 'minimal',
  full: 'owner',
}

/**
 * Normalise a role name from any vocabulary (DDL, package card, Operately) to
 * a lattice role. Unknown names (including `no_access`) → `null`.
 */
export function normalizeRoleAlias(name: string): AclRole | null {
  const key = name.trim().toLowerCase()
  if (isAclRole(key)) return key
  if (SPECIAL_SET.has(key)) return effectiveRole(key as AclSpecialRole)
  return ROLE_ALIASES[key] ?? null
}
