/**
 * Record a SessionApply pointer on AgentTeamsStore (workspace .agent-teams/).
 * Reuses the first-party store. No second orchestrator.
 */

import { AgentTeamsStore } from '../agent-teams/store.ts';
import type { AgentTeamState } from '../agent-teams/types.ts';
import type { SessionApplyApplyResult } from './types.ts';

const TASK_SUBJECT = 'session-apply';

export function recordSessionApplyOnTeam(
  store: AgentTeamsStore,
  teamId: string,
  result: SessionApplyApplyResult,
): AgentTeamState {
  const team = store.readTeam(teamId);
  if (!team) throw new Error(`agent team not found: ${teamId}`);
  const existing = team.tasks.find((task) => task.subject === TASK_SUBJECT);
  return store.upsertTask(teamId, {
    id: existing?.id,
    subject: TASK_SUBJECT,
    status: result.businessCompleted ? 'completed' : existing ? undefined : 'in_progress',
    output: result.pointer,
    description: `SessionApply consumer stub @ ${result.origin} HTTP ${result.status}`,
  });
}
