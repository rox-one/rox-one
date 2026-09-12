/**
 * First-party Agent Teams session tool.
 * Wraps AgentTeamsStore (workspace `.agent-teams/`). Not Cordis.
 * Does not flip workbench.harness.agentTeams (default stays false).
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { AgentTeamsStore } from '@craft-agent/core/platform';
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
        return ok(store.describePointers(team.id));
      }
      case 'status': {
        const teamId = args.teamId?.trim();
        if (teamId) {
          const pointers = store.describePointers(teamId);
          if (!pointers) return errorResponse(`agent team not found: ${teamId}`);
          return ok(pointers);
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
        return ok(store.describePointers(team.id));
      }
      case 'add_member': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const memberName = args.memberName?.trim();
        if (!memberName) return errorResponse('memberName is required.');
        const team = store.addMember(teamId, {
          name: memberName,
          role: args.role,
          sessionId: args.memberSessionId,
        });
        return ok({ team });
      }
      case 'set_member_session': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const memberName = args.memberName?.trim();
        const memberSessionId = args.memberSessionId?.trim();
        if (!memberName || !memberSessionId) {
          return errorResponse('memberName and memberSessionId are required.');
        }
        const team = store.setMemberSession(teamId, memberName, memberSessionId);
        return ok({ team });
      }
      case 'upsert_task': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const subject = args.subject?.trim();
        if (!subject) return errorResponse('subject is required to upsert a task.');
        const team = store.upsertTask(teamId, {
          id: args.taskId,
          subject,
          description: args.taskDescription,
          status: args.status,
          assignee: args.assignee,
          dependencies: args.dependencies,
          output: args.output,
        });
        return ok({ team });
      }
      case 'append_mailbox': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const agentKey = args.agentKey?.trim() || args.to?.trim();
        const from = args.from?.trim();
        const to = args.to?.trim();
        const content = args.content?.trim();
        if (!agentKey || !from || !to || !content) {
          return errorResponse('agentKey (or to), from, to, and content are required.');
        }
        const message = store.createMessage(from, to, content);
        store.appendMailbox(teamId, agentKey, message);
        return ok({ message, teamId, agentKey });
      }
      case 'read_mailbox': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
        const agentKey = args.agentKey?.trim() || 'captain';
        return ok({ teamId, agentKey, messages: store.readMailbox(teamId, agentKey) });
      }
      case 'archive': {
        const teamId = requireTeamId(args);
        if (typeof teamId !== 'string') return errorResponse(teamId.error);
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
