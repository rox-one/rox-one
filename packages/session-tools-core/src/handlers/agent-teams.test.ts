import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAgentTeams } from './agent-teams.ts';
import type { SessionToolContext } from '../context.ts';
import { AgentTeamsStore } from '@craft-agent/core/platform';

const dirs: string[] = [];

function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-agent-teams-tool-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspace: string, sessionId = 'cap-1'): SessionToolContext {
  return {
    sessionId,
    workspacePath: workspace,
    workingDirectory: workspace,
  } as SessionToolContext;
}

function payload(result: Awaited<ReturnType<typeof handleAgentTeams>>): Record<string, unknown> {
  expect(result.isError).toBeFalsy();
  const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : '';
  return JSON.parse(text) as Record<string, unknown>;
}

async function errText(
  result: Awaited<ReturnType<typeof handleAgentTeams>>,
): Promise<string> {
  expect(result.isError).toBe(true);
  return result.content[0] && 'text' in result.content[0] ? result.content[0].text : '';
}

describe('handleAgentTeams', () => {
  it('runs a captain roster / mailbox / resume / archive scenario on .agent-teams', async () => {
    const workspace = tmpWorkspace();
    const captain = ctx(workspace, 'cap-1');

    const created = payload(
      await handleAgentTeams(captain, { action: 'create', name: 'Review Squad', phase: 'staged' }),
    );
    const team = created.team as { id: string; captainSessionId: string; phase: string };
    expect(team.id).toBe('review-squad');
    expect(team.captainSessionId).toBe('cap-1');
    expect(team.phase).toBe('staged');
    expect(String(created.stateRoot)).toContain('.agent-teams');

    payload(
      await handleAgentTeams(captain, {
        action: 'add_member',
        teamId: team.id,
        memberName: 'alice',
        role: 'reviewer',
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'set_member_session',
        teamId: team.id,
        memberName: 'alice',
        memberSessionId: 'sess-alice',
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'upsert_task',
        teamId: team.id,
        subject: 'Read diff',
        assignee: 'alice',
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'append_mailbox',
        teamId: team.id,
        agentKey: 'captain',
        from: 'captain',
        to: 'captain',
        content: 'please review',
      }),
    );

    const alice = ctx(workspace, 'sess-alice');
    payload(
      await handleAgentTeams(alice, {
        action: 'append_mailbox',
        teamId: team.id,
        from: 'alice',
        to: 'captain',
        content: 'diff looks good',
      }),
    );
    payload(
      await handleAgentTeams(alice, {
        action: 'upsert_task',
        teamId: team.id,
        taskId: 't1',
        status: 'claimed',
      }),
    );

    const resumed = payload(await handleAgentTeams(captain, { action: 'resume' }));
    const resumedTeam = resumed.team as { id: string; members: Array<{ sessionId: string }> };
    expect(resumedTeam.id).toBe('review-squad');
    expect(resumedTeam.members[0]?.sessionId).toBe('sess-alice');

    const mail = payload(
      await handleAgentTeams(captain, { action: 'read_mailbox', teamId: team.id, agentKey: 'captain' }),
    );
    const messages = mail.messages as Array<{ content: string }>;
    expect(messages.map((m) => m.content)).toEqual(['please review', 'diff looks good']);

    const archived = payload(await handleAgentTeams(captain, { action: 'archive', teamId: team.id }));
    expect(archived.archived).toBe('review-squad');
    const listed = payload(await handleAgentTeams(captain, { action: 'list' }));
    expect(listed.teamIds).toEqual([]);
    expect(listed.archivedTeamIds).toEqual(['review-squad']);
  });

  it('refuses $HOME as the Agent Teams state root', async () => {
    const home = homedir();
    const result = await handleAgentTeams(
      { sessionId: 'cap-home', workspacePath: home, workingDirectory: home } as SessionToolContext,
      { action: 'create', name: 'Nope' },
    );
    expect(result.isError).toBe(true);
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : '';
    expect(text.toLowerCase()).toContain('not $home');
  });

  it('does not invent a second orchestrator or enable the Appearance flag', async () => {
    const src = await Bun.file(new URL('./agent-teams.ts', import.meta.url)).text();
    expect(src).toContain('Does not flip workbench.harness.agentTeams');
    expect(src).toContain('Not Cordis');
    expect(src).not.toContain('dsh-agent-teams');
    expect(src).not.toContain('defaultValue: true');
  });

  it('keeps roster and DAG mutations captain-only and mailbox reads participant-scoped', async () => {
    const workspace = tmpWorkspace();
    const captain = ctx(workspace, 'cap-1');
    const created = payload(
      await handleAgentTeams(captain, { action: 'create', name: 'Gate', phase: 'staged' }),
    );
    const teamId = (created.team as { id: string }).id;
    payload(
      await handleAgentTeams(captain, {
        action: 'add_member',
        teamId,
        memberName: 'alice',
        memberSessionId: 'sess-alice',
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'upsert_task',
        teamId,
        subject: 'A',
        assignee: 'alice',
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'upsert_task',
        teamId,
        subject: 'B',
        dependencies: ['t1'],
      }),
    );

    const alice = ctx(workspace, 'sess-alice');
    const stranger = ctx(workspace, 'sess-stranger');

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'add_member',
          teamId,
          memberName: 'bob',
        }),
      ),
    ).toMatch(/only the captain/i);

    expect(
      await errText(
        await handleAgentTeams(stranger, { action: 'status', teamId }),
      ),
    ).toMatch(/not a participant/i);

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'upsert_task',
          teamId,
          subject: 'sneaky',
        }),
      ),
    ).toMatch(/only the captain can create tasks/i);

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'upsert_task',
          teamId,
          taskId: 't2',
          status: 'claimed',
          dependencies: ['t1'],
        }),
      ),
    ).toMatch(/assigned to them/i);

    const beforeDag = new AgentTeamsStore({ workspaceRoot: workspace }).readTeam(teamId)!;
    const dagFail = await handleAgentTeams(captain, {
      action: 'upsert_task',
      teamId,
      taskId: 't2',
      subject: 'B',
      status: 'claimed',
      dependencies: ['t1'],
    });
    expect(dagFail.isError).toBe(true);
    expect(await errText(dagFail)).toMatch(/dependencies not completed/);
    const afterDag = new AgentTeamsStore({ workspaceRoot: workspace }).readTeam(teamId)!;
    expect(afterDag.tasks.find((t) => t.id === 't2')?.status).toBe('pending');
    expect(afterDag.updatedAt).toBe(beforeDag.updatedAt);

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'append_mailbox',
          teamId,
          from: 'captain',
          to: 'alice',
          content: 'spoof',
        }),
      ),
    ).toMatch(/from must match/i);

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'read_mailbox',
          teamId,
          agentKey: 'captain',
        }),
      ),
    ).toMatch(/own mailbox/i);

    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'append_mailbox',
          teamId,
          from: 'alice',
          to: 'captain',
          agentKey: 'alice/../captain',
          content: 'alias',
        }),
      ),
    ).toMatch(/filesystem path/i);

    const store = new AgentTeamsStore({ workspaceRoot: workspace });
    const live = store.readTeam(teamId)!;
    store.writeTeam({
      ...live,
      members: live.members.map((m) =>
        m.name === 'alice' ? { ...m, status: 'removed' as const } : m,
      ),
    });
    expect(
      await errText(
        await handleAgentTeams(alice, {
          action: 'append_mailbox',
          teamId,
          from: 'alice',
          to: 'captain',
          content: 'after removal',
        }),
      ),
    ).toMatch(/not a participant|removed/i);
  });
});
