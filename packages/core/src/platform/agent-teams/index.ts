/**
 * Rox first-party Agent Teams durable store.
 * Flag `workbench.harness.agentTeams` stays default false (UI gate only).
 */
export {
  AGENT_TEAMS_STATE_DIR,
  CAPTAIN_KEY,
  TASK_TRANSITIONS,
  AgentTeamsStore,
  isTerminalTaskStatus,
  mailboxPath,
  mailboxPointer,
  resolveAgentTeamsRoot,
  sanitizeKey,
  teamDir,
  transitionError,
  unsatisfiedDependencies,
} from './store.ts';
export type { AgentTeamsStoreOptions } from './store.ts';
export type {
  AddAgentTeamMemberInput,
  AgentTeamMember,
  AgentTeamMemberStatus,
  AgentTeamMessage,
  AgentTeamState,
  AgentTeamTask,
  AgentTeamTaskStatus,
  CreateAgentTeamInput,
  UpsertAgentTeamTaskInput,
} from './types.ts';
export { TERMINAL_TASK_STATUSES } from './types.ts';
