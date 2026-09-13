/**
 * Rox SessionApply consumer stub.
 * Flag `workbench.conation.sessionApply` stays default false (UI/network gate).
 */
export { SessionApplyClient } from './client.ts';
export { recordSessionApplyOnTeam } from './link-agent-teams.ts';
export {
  DEFAULT_APPLY_PATH,
  DEFAULT_OPERATOR_ORIGIN,
  DEFAULT_READ_PATH,
  SessionApplyFlagOffError,
  SessionApplyHttpError,
  SESSION_APPLY_SUCCESS_STATUSES,
  isSessionApplySuccessStatus,
} from './types.ts';
export type {
  SessionApplyApplyInput,
  SessionApplyApplyResult,
  SessionApplyClientOptions,
  SessionApplyReadResult,
} from './types.ts';
