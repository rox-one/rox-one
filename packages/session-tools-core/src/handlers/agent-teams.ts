/**
 * First-party Agent Teams session tool.
 * Wraps AgentTeamsStore (workspace `.agent-teams/`). Not Cordis.
 * Does not flip workbench.harness.agentTeams (default stays false).
 *
 * Identity: roster/DAG/archive are captain-only. Members may claim their
 * assigned tasks and use their own mailbox. Foreign, removed, and ambiguous
 * session identities cannot mutate or read another agent's inbox.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  AgentTeamsStore,
  CAPTAIN_KEY,
  sanitizeKey,
  type AgentTeamState,
} from '@craft-agent/core/platform';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export const AGENT_TEAMS_ACTIONS = [
  'create',
  'list',
  'status',
  'resume',
  'add_member',
  'set_member_session',
  'upsert_task',
  'append_mailbox',
  'read_mailbox',
  'archive',
] as const;

export type AgentTeamsAction = (typeof AGENT_TEAMS_ACTIONS)[number];

export interface AgentTeamsArgs {
  action: AgentTeamsAction;
  teamId?: string;
  name?: string;
  description?: string;
  phase?: 'staged' | 'running';
  memberName?: string;
  role?: string;
  memberSessionId?: string;
  taskId?: string;
  subject?: string;
  taskDescription?: string;
  status?: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  assignee?: string;
  dependencies?: string[];
  output?: string;
  from?: string;
  to?: string;
  content?: string;
  agentKey?: string;
}

type CallerIdentity =
  | { ok: true; role: 'captain'; key: typeof CAPTAIN_KEY }
  | { ok: true; role: 'member'; key: string; name: string }
  | { ok: false; error: string };

function ok(payload: unknown): ToolResult {
  return successResponse(JSON.stringify(payload, null, 2));
}

function resolveStateRoot(ctx: SessionToolContext): string | { error: string } {
  const candidates = [ctx.workingDirectory, ctx.workspacePath].filter(
    (path): path is string => typeof path === 'string' && path.trim().length > 0,
  );
  const home = resolve(homedir());
  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (root === home) continue;
    return root;
  }
  return {
    error:
      'Agent Teams needs a project working directory (not $HOME). Set cwd on the session, then retry.',
  };
}

function storeFor(ctx: SessionToolContext): AgentTeamsStore | { error: string } {
  const root = resolveStateRoot(ctx);
  if (typeof root !== 'string') return root;
  return new AgentTeamsStore({ workspaceRoot: root });
}

function requireTeamId(args: AgentTeamsArgs): string | { error: string } {
  const teamId = args.teamId?.trim();
  if (!teamId) return { error: 'teamId is required for this action.' };
  return teamId;
}

function resolveCaller(team: AgentTeamState, sessionId: string): CallerIdentity {
  const sid = sessionId.trim();
  if (!sid) return { ok: false, error: 'session identity is required.' };
  const asCaptain = team.captainSessionId === sid;
  const matching = team.members.filter(
    (member) => member.sessionId === sid && member.status !== 'removed' && member.sessionId.trim() !== '',
  );
  if (asCaptain && matching.length > 0) {
    return { ok: false, error: 'ambiguous identity: session is both captain and member.' };
  }
  if (matching.length > 1) {
    return { ok: false, error: 'ambiguous identity: session is bound to multiple members.' };
  }
  if (asCaptain) return { ok: true, role: 'captain', key: CAPTAIN_KEY };
  if (matching.length === 1) {
    const member = matching[0]!;
    return { ok: true, role: 'member', key: sanitizeKey(member.name), name: member.name };
  }
  return { ok: false, error: 'session is not a participant of this team.' };
}

function requireCaptain(
  team: AgentTeamState,
  sessionId: string,
): CallerIdentity & { ok: true; role: 'captain' } | { error: string } {
  const identity = resolveCaller(team, sessionId);
  if (!identity.ok) return { error: identity.error };
  if (identity.role !== 'captain') return { error: 'only the captain can change roster or DAG.' };
  return identity;
}

function isFilesystemAlias(raw: string): boolean {
  return /[\\/\0]/.test(raw) || raw.includes('..');
}

function resolveParticipantKey(
  team: AgentTeamState,
  raw: string | undefined,
): string | { error: string } {
  const value = raw?.trim() ?? '';
  if (!value) return { error: 'mailbox key is required.' };
  if (isFilesystemAlias(value)) {
    return { error: 'mailbox key must not be a filesystem path.' };
  }
  const key = sanitizeKey(value);
  if (key === CAPTAIN_KEY) return CAPTAIN_KEY;
  const live = team.members.filter(
    (member) => sanitizeKey(member.name) === key && member.status !== 'removed',
  );
  const removed = team.members.filter(
    (member) => sanitizeKey(member.name) === key && member.status === 'removed',
  );
  if (live.length === 1) return key;
  if (live.length > 1) return { error: 'ambiguous mailbox key.' };
  if (removed.length > 0) return { error: 'member is removed.' };
  return { error: 'unknown mailbox key.' };
}

function loadTeam(
  store: AgentTeamsStore,
  teamId: string,
): AgentTeamState | { error: string } {
  const team = store.readTeam(teamId);
  if (!team) return { error: `agent team not found: ${teamId}` };
  return team;
}

export async function handleAgentTeams(
  ctx: SessionToolContext,
  args: AgentTeamsArgs,
): Promise<ToolResult> {
  const resolved = storeFor(ctx);
  if (!('stateRoot' in resolved)) return errorResponse(resolved.error);
  const store = resolved;

  try {
    switch (args.action) {
      case 'create': {
        const name = args.name?.trim();
        if (!name) return errorResponse('name is required to create a team.');
        const team = store.createTeam({
          name,
          captainSessionId: ctx.sessionId,
          description: args.description,
          phase: args.phase ?? 'staged',
        });
        return ok({ team, stateRoot: store.stateRoot });
      }
      case 'list': {
        return ok({
          teamIds: store.listTeamIds(),
          archivedTeamIds: store.listArchivedTeamIds(),
          stateRoot: store.stateRoot,
        });
      }
      case 'resume': {
        const team =
          store.findTeamByCaptain(ctx.sessionId) ?? store.findTeamByParticipant(ctx.sessionId);
        if (!team) {
          return errorResponse(`no active Agent Team for session ${ctx.sessionId}`);
        }
        const identity = resolveCaller(team, ctx.sessionId);
        if (!identity.ok) return errorResponse(identity.error);
        return ok(store.describePointers(team.id));
      }
      case 'status': {
        const teamId = args.teamId?.trim();
        if (teamId) {
          const team = loadTeam(store, teamId);
          if ('error' in team) return errorResponse(team.error);
          const identity = resolveCaller(team, ctx.sessionId);
          if (!identity.ok) return errorResponse(identity.error);
          return ok(store.describePointers(team.id));
        }
        const team =
          store.findTeamByCaptain(ctx.sessionId) ?? store.findTeamByParticipant(ctx.sessionId);
        if (!team) {
          return ok({
            teamIds: store.listTeamIds(),
            archivedTeamIds: store.listArchivedTeamIds(),
            stateRoot: store.stateRoot,
          });
        }
        const identity = resolveCaller(team, ctx.sessionId);
        if (!identity.ok) return errorResponse(identity.error);
        return ok(store.describePointers(team.id));
      }
      case 'add_member': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const captain = requireCaptain(team, ctx.sessionId);
        if ('error' in captain) return errorResponse(captain.error);
        const memberName = args.memberName?.trim();
        if (!memberName) return errorResponse('memberName is required.');
        const next = store.addMember(teamId, {
          name: memberName,
          role: args.role,
          sessionId: args.memberSessionId,
        });
        return ok({ team: next });
      }
      case 'set_member_session': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const captain = requireCaptain(team, ctx.sessionId);
        if ('error' in captain) return errorResponse(captain.error);
        const memberName = args.memberName?.trim();
        const memberSessionId = args.memberSessionId?.trim();
        if (!memberName || !memberSessionId) {
          return errorResponse('memberName and memberSessionId are required.');
        }
        const next = store.setMemberSession(teamId, memberName, memberSessionId);
        return ok({ team: next });
      }
      case 'upsert_task': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const identity = resolveCaller(team, ctx.sessionId);
        if (!identity.ok) return errorResponse(identity.error);
        const subject = args.subject?.trim();
        if (identity.role === 'captain') {
          if (!subject) return errorResponse('subject is required to upsert a task.');
          const next = store.upsertTask(teamId, {
            id: args.taskId,
            subject,
            description: args.taskDescription,
            status: args.status,
            assignee: args.assignee,
            dependencies: args.dependencies,
            output: args.output,
          });
          return ok({ team: next });
        }
        if (!args.taskId) {
          return errorResponse('only the captain can create tasks.');
        }
        const current = team.tasks.find((task) => task.id === args.taskId);
        if (!current) return errorResponse(`task not found: ${args.taskId}`);
        const assignedKey = current.assignee ? sanitizeKey(current.assignee) : '';
        if (assignedKey !== identity.key) {
          return errorResponse('members can only update tasks assigned to them.');
        }
        if (
          args.dependencies &&
          JSON.stringify(args.dependencies) !== JSON.stringify(current.dependencies)
        ) {
          return errorResponse('only the captain can change the task DAG.');
        }
        if (args.assignee && sanitizeKey(args.assignee) !== identity.key) {
          return errorResponse('members cannot reassign tasks.');
        }
        const next = store.upsertTask(teamId, {
          id: args.taskId,
          subject: subject || current.subject,
          description: args.taskDescription,
          status: args.status,
          assignee: current.assignee,
          dependencies: current.dependencies,
          output: args.output,
        });
        return ok({ team: next });
      }
      case 'append_mailbox': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const identity = resolveCaller(team, ctx.sessionId);
        if (!identity.ok) return errorResponse(identity.error);
        const fromKey = resolveParticipantKey(team, args.from);
        if (typeof fromKey !== 'string') return errorResponse(fromKey.error);
        if (fromKey !== identity.key) {
          return errorResponse('from must match the calling session identity.');
        }
        const toKey = resolveParticipantKey(team, args.to);
        if (typeof toKey !== 'string') return errorResponse(toKey.error);
        const inboxKey = resolveParticipantKey(team, args.agentKey || args.to);
        if (typeof inboxKey !== 'string') return errorResponse(inboxKey.error);
        if (inboxKey !== toKey) {
          return errorResponse('agentKey must match the recipient mailbox.');
        }
        const content = args.content?.trim();
        if (!content) return errorResponse('content is required.');
        const message = store.createMessage(fromKey, toKey, content);
        store.appendMailbox(teamId, inboxKey, message);
        return ok({ message, teamId, agentKey: inboxKey });
      }
      case 'read_mailbox': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const identity = resolveCaller(team, ctx.sessionId);
        if (!identity.ok) return errorResponse(identity.error);
        const agentKey = resolveParticipantKey(team, args.agentKey || (identity.role === 'captain' ? CAPTAIN_KEY : identity.key));
        if (typeof agentKey !== 'string') return errorResponse(agentKey.error);
        if (identity.role !== 'captain' && agentKey !== identity.key) {
          return errorResponse('members can only read their own mailbox.');
        }
        return ok({ teamId, agentKey, messages: store.readMailbox(teamId, agentKey) });
      }
      case 'archive': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const team = loadTeam(store, teamId);
        if ('error' in team) return errorResponse(team.error);
        const captain = requireCaptain(team, ctx.sessionId);
        if ('error' in captain) return errorResponse(captain.error);
        store.archiveTeam(teamId);
        return ok({ archived: teamId, archivedTeamIds: store.listArchivedTeamIds() });
      }
      default: {
        const _exhaustive: never = args.action;
        return errorResponse(`unsupported Agent Teams action: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Agent Teams failed: ${message}`);
  }
}
