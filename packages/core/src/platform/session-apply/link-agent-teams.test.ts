import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTeamsStore } from '../agent-teams/store.ts';
import type { SessionApplyApplyResult } from './types.ts';
import { recordSessionApplyOnTeam } from './link-agent-teams.ts';

function applyResult(
  overrides: Pick<SessionApplyApplyResult, 'status' | 'businessCompleted'> &
    Partial<SessionApplyApplyResult>,
): SessionApplyApplyResult {
  return {
    ok: true,
    origin: 'https://conation.dev',
    body: { applied: true },
    pointer: 'https://conation.dev/session-apply#team=alpha',
    transportAccepted: true,
    ...overrides,
  };
}

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

  it('writes a session-apply pointer on HTTP 202 without marking the task completed', () => {
    store.createTeam({ name: 'alpha', captainSessionId: 'cap-1' });
    const next = recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 202,
      businessCompleted: false,
    }));
    const task = next.tasks.find((t) => t.subject === 'session-apply');
    expect(task?.output).toBe('https://conation.dev/session-apply#team=alpha');
    expect(task?.status).not.toBe('completed');
    expect(task?.status).toBe('in_progress');
  });

  it('marks the team task completed only when businessCompleted is true', () => {
    store.createTeam({ name: 'alpha', captainSessionId: 'cap-1' });
    const next = recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 200,
      businessCompleted: true,
    }));
    const task = next.tasks.find((t) => t.subject === 'session-apply');
    expect(task?.status).toBe('completed');
    expect(task?.output).toBe('https://conation.dev/session-apply#team=alpha');
  });

  it('promotes a 202 in-flight task to completed on a later businessCompleted apply', () => {
    store.createTeam({ name: 'alpha', captainSessionId: 'cap-1' });
    recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 202,
      businessCompleted: false,
    }));
    const next = recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 200,
      businessCompleted: true,
    }));
    const task = next.tasks.find((t) => t.subject === 'session-apply');
    expect(task?.status).toBe('completed');
  });

  it('keeps an in-flight task incomplete when a later apply is still not businessCompleted', () => {
    store.createTeam({ name: 'alpha', captainSessionId: 'cap-1' });
    recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 202,
      businessCompleted: false,
    }));
    const next = recordSessionApplyOnTeam(store, 'alpha', applyResult({
      status: 202,
      businessCompleted: false,
      pointer: 'https://conation.dev/session-apply#team=alpha&retry=2',
    }));
    const task = next.tasks.find((t) => t.subject === 'session-apply');
    expect(task?.status).not.toBe('completed');
    expect(task?.output).toBe('https://conation.dev/session-apply#team=alpha&retry=2');
  });
});
