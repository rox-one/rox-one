/**
 * Minimal durable Agent Teams state (Rox first-party).
 *
 * Layout under `<workspace>/.agent-teams/<teamId>/`:
 * - `team.json` — roster + task DAG pointers
 * - `inbox/<agentKey>.jsonl` — mailbox per captain/member
 *
 * Not Cordis / @nanmicoder/dsh-agent-teams. Quality-gates and live DAG UI
 * are out of scope for this store.
 */

/** Task lifecycle statuses in progression order. */
export type AgentTeamTaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TERMINAL_TASK_STATUSES: readonly AgentTeamTaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentTeamMemberStatus = 'idle' | 'working' | 'removed';

/** One teammate: Rox session id + role labels. */
export interface AgentTeamMember {
  /** Rox session id from spawn_session (empty until spawned). */
  sessionId: string;
  /** Unique display name inside the team. */
  name: string;
  /** Role description, e.g. researcher / engineer / reviewer. */
  role?: string;
  status: AgentTeamMemberStatus;
  joinedAt: number;
}

/** One dependency-aware task. */
export interface AgentTeamTask {
  /** Stable id within the team (`t1`, `t2`, …). */
  id: string;
  subject: string;
  description?: string;
  status: AgentTeamTaskStatus;
  /** Member name or `captain`. */
  assignee?: string;
  /** Task ids that must be `completed` before claim. */
  dependencies: string[];
  output?: string;
  createdAt: number;
  updatedAt: number;
}

/** One durable mailbox message. */
export interface AgentTeamMessage {
  id: string;
  /** `captain` or a member name. */
  from: string;
  /** `captain` or a member name. */
  to: string;
  content: string;
  ts: number;
  readAt?: number;
}

/**
 * Durable team record (team.json).
 * Mailboxes live beside this file under `inbox/`.
 */
export interface AgentTeamState {
  /** Original team name. */
  name: string;
  /** Sanitized directory id. */
  id: string;
  description?: string;
  /** Rox session id of the captain. */
  captainSessionId: string;
  createdAt: number;
  updatedAt: number;
  /** Teammates only; captain is the owning session. */
  members: AgentTeamMember[];
  tasks: AgentTeamTask[];
  /** Monotonic task id counter. */
  taskSeq: number;
  phase?: 'staged' | 'running' | 'archived';
}

export interface CreateAgentTeamInput {
  name: string;
  captainSessionId: string;
  description?: string;
  /** Optional pre-seeded roster (sessionId may be empty until spawn). */
  members?: Array<Pick<AgentTeamMember, 'name'> & Partial<AgentTeamMember>>;
  /** Optional staged tasks. */
  tasks?: Array<
    Pick<AgentTeamTask, 'subject'> &
      Partial<Omit<AgentTeamTask, 'id' | 'createdAt' | 'updatedAt' | 'subject'>>
  >;
  phase?: 'staged' | 'running';
}

export interface AddAgentTeamMemberInput {
  name: string;
  sessionId?: string;
  role?: string;
  status?: AgentTeamMemberStatus;
}

export interface UpsertAgentTeamTaskInput {
  id?: string;
  subject: string;
  description?: string;
  status?: AgentTeamTaskStatus;
  assignee?: string;
  dependencies?: string[];
  output?: string;
}
