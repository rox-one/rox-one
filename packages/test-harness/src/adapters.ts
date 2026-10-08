/**
 * W1-10 (#1507) — sibling-contract adapter (stub routing).
 *
 * Single module through which every gate reaches sibling wave-1 contracts.
 * Each entry is a `STUB(#<issue>)` until the owning package lands; swapping
 * in the real implementation is a one-line change here. Stubs live only in
 * files this package owns — never at a sibling's path.
 */
export const SIBLING_CONTRACTS = {
  /** STUB(#1500): command catalogue + CommandDefinition (W1-03). */
  commands: null as null,
  /** STUB(#1501): generatePermissionMatrix() in entities/permissions.ts (W1-04). */
  permissions: null as null,
  /** STUB(#1502): server DDL migrations 02..52 (W1-05). */
  ddl: null as null,
  /** STUB(#1503): zod domain schemas + reference handlers (W1-06). */
  domainSchemas: null as null,
  /** STUB(#1508): riskClass required on every command definition (W1-11). */
  riskClass: null as null,
  /** STUB(#1510): scripts/check-config-paths.ts (W1-13). */
  configPaths: null as null,
  /** STUB(#1512): chrome schemas, right-dock fn, agent-panel context (W1-15). */
  chrome: null as null,
} as const

export type SiblingContractKey = keyof typeof SIBLING_CONTRACTS
