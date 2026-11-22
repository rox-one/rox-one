/**
 * Public surface of the Rox Cloud operations guards.
 *
 * Nothing here reaches the network or a database: both guards are in-memory,
 * dependency-free and take an injectable clock, so any API layer can own the
 * storage and keep the rules.
 */

export { OpsError } from './types.ts';
export type {
  AuditAction,
  AuditEntry,
  AuditInput,
  KillProvider,
  KillRequest,
  KillScope,
  KillState,
  OpsErrorCode,
} from './types.ts';

export { GENESIS_HASH, createAuditLog } from './audit.ts';
export type { AuditChainCheck, AuditFilter, AuditLog, AuditLogOptions } from './audit.ts';

export { createKillSwitch } from './kill-switch.ts';
export type { CreateKillSwitchOptions, KillRequestInput, KillSwitch } from './kill-switch.ts';
