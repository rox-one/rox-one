import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTeamsStore } from '../agent-teams/store.ts';
import { recordSessionApplyOnTeam } from './link-agent-teams.ts';

describe('recordSessionApplyOnTeam', () => {
  let workspace: string;
  let store: AgentTeamsStore;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'rox-session-apply-'));
    store = new AgentTeamsStore({ workspaceRoot: workspace });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes a session-apply task pointer onto the team', () => {
    store.createTeam({ name: 'alpha', captainSessionId: 'cap-1' });
    const next = recordSessionApplyOnTeam(store, 'alpha', {
      ok: true,
      origin: 'https://conation.dev',
      status: 202,
      body: { applied: true },
      pointer: 'https://conation.dev/session-apply#team=alpha',
    });
    const task = next.tasks.find((t) => t.subject === 'session-apply');
    expect(task?.output).toBe('https://conation.dev/session-apply#team=alpha');
    expect(task?.status).toBe('completed');
  });
});
