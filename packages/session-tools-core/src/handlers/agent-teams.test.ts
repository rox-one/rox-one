import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAgentTeams } from './agent-teams.ts';
import type { SessionToolContext } from '../context.ts';

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
      }),
    );
    payload(
      await handleAgentTeams(captain, {
        action: 'append_mailbox',
        teamId: team.id,
        agentKey: 'captain',
        from: 'alice',
        to: 'captain',
        content: 'diff looks good',
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
    expect(messages[0]?.content).toBe('diff looks good');

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
});
