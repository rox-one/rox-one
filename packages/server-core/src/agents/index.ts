/**
 * W1-11 (#1508) — The agent-governance surface of the local authority
 * (`@rox/server-core` internal import path `./agents`).
 *
 * The workspace service consumes the same modules: the stores and the JSONL
 * audit log are the local reference implementation, and the middleware chain is
 * authority-agnostic (it only talks to `PolicyGovernancePorts`).
 */

export {
  AGENTS_COMMAND_MODULE,
  AGENTS_GOVERNANCE_SCHEMAS,
  bindAgentsGovernance,
} from './module.ts'

export {
  agentsGovernanceChain,
  installAgentsGovernance,
  type InstallAgentsGovernanceOptions,
} from './governance-install.ts'

export {
  HeldNotificationInbox,
  agentSubject,
  configureAgentsRuntime,
  createAgentsRuntime,
  getAgentsRuntime,
  policyPortsFor,
  rateLimitPolicyFor,
  type AgentInvocation,
  type AgentInvocationPort,
  type AgentInvocationRequest,
  type AgentsRuntime,
  type ApprovedCommandDispatchPort,
  type CreateAgentsRuntimeOptions,
} from './runtime.ts'

export {
  InMemoryGovernanceStore,
  InMemoryIdentityStore,
  type ChatMemberRecord,
  type PrincipalRecord,
  type WorkspaceRecord,
} from './store.ts'

export {
  InMemoryRateLimiter,
  rateLimitBucketKey,
  type InMemoryRateLimiterOptions,
  type RateLimitConsumption,
} from './rate-limit.ts'

export { JsonlAuditLog, auditFileName, auditMonthOf, type JsonlAuditLogOptions } from './audit-log.ts'

export {
  activatePlaceholder,
  browsePublicChats,
  createChat,
  createWorkspace,
  decideApproval,
  ensurePlaceholder,
  invitationTokenHash,
  invitationTokens,
  invitePeople,
  invokeAgent,
  joinChat,
  leaveChat,
  mergePlaceholder,
  newInvitationToken,
  pauseAgent,
  provisionPersonalAgent,
  setChatVisibility,
  verifyInvitationToken,
} from './handlers.ts'
