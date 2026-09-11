import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_TEAMS_STATE_DIR,
  AgentTeamsStore,
  CAPTAIN_KEY,
  mailboxPath,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
} from './store.ts';

describe('AgentTeamsStore', () => {
  let workspace: string;
  let store: AgentTeamsStore;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'rox-agent-teams-'));
    store = new AgentTeamsStore({ workspaceRoot: workspace });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('uses workspace .agent-teams as state root', () => {
    expect(store.stateRoot).toBe(join(workspace, AGENT_TEAMS_STATE_DIR));
  });

  it('sanitizes unicode and punctuation keys without collapsing CJK', () => {
    expect(sanitizeKey('Research Lead')).toBe('research-lead');
    expect(sanitizeKey('Исследователь')).toBe('исследователь');
    expect(sanitizeKey('!!!')).toMatch(/^k-[0-9a-f]{8}$/);
  });

  it('creates team.json + captain/member mailbox pointers', () => {
    const team = store.createTeam({
      name: 'Review Squad',
      captainSessionId: 'sess-captain',
      description: 'PR review',
      members: [{ name: 'alice', role: 'reviewer' }],
      tasks: [{ subject: 'Read diff', dependencies: [] }],
    });
    expect(team.id).toBe('review-squad');
    expect(team.phase).toBe('staged');
    expect(team.members).toHaveLength(1);
    expect(team.tasks[0]?.id).toBe('t1');
    expect(existsSync(join(store.stateRoot, 'review-squad', 'team.json'))).toBe(true);
    expect(existsSync(mailboxPath(store.stateRoot, team.id, CAPTAIN_KEY))).toBe(true);
    expect(existsSync(mailboxPath(store.stateRoot, team.id, 'alice'))).toBe(true);
    const disk = JSON.parse(
      readFileSync(join(store.stateRoot, 'review-squad', 'team.json'), 'utf8'),
    ) as { version: number; team: { id: string } };
    expect(disk.version).toBe(1);
    expect(disk.team.id).toBe('review-squad');
  });

  it('persists roster session ids and finds by captain/participant', () => {
    store.createTeam({
      name: 'alpha',
      captainSessionId: 'cap-1',
      members: [{ name: 'bob' }],
    });
    store.setMemberSession('alpha', 'bob', 'sess-bob');
    expect(store.findTeamByCaptain('cap-1')?.id).toBe('alpha');
    expect(store.findTeamByParticipant('sess-bob')?.members[0]?.sessionId).toBe('sess-bob');
    expect(store.findTeamByCaptain('missing')).toBeUndefined();
  });

  it('enforces task dependency + status transitions', () => {
    store.createTeam({
      name: 'deps',
      captainSessionId: 'cap',
      tasks: [
        { subject: 'A' },
        { subject: 'B', dependencies: ['t1'] },
      ],
    });
    expect(transitionError('pending', 'completed')).toBeTruthy();
    expect(() =>
      store.upsertTask('deps', {
        id: 't2',
        subject: 'B',
        status: 'claimed',
        assignee: 'captain',
        dependencies: ['t1'],
      }),
    ).toThrow(/dependencies not completed/);
    store.upsertTask('deps', { id: 't1', subject: 'A', status: 'claimed' });
    store.upsertTask('deps', { id: 't1', subject: 'A', status: 'in_progress' });
    store.upsertTask('deps', { id: 't1', subject: 'A', status: 'completed', output: 'done' });
    const blocked = unsatisfiedDependencies(store.readTeam('deps')!.tasks, ['t1']);
    expect(blocked).toEqual([]);
    store.upsertTask('deps', {
      id: 't2',
      subject: 'B',
      status: 'claimed',
      assignee: 'captain',
      dependencies: ['t1'],
    });
    expect(store.readTeam('deps')!.tasks.find((t) => t.id === 't2')?.status).toBe('claimed');
  });

  it('appends and reads JSONL mailbox messages', () => {
    store.createTeam({ name: 'mail', captainSessionId: 'cap' });
    const msg = store.createMessage('captain', 'alice', 'hello');
    store.addMember('mail', { name: 'alice', sessionId: 's-a' });
    store.appendMailbox('mail', 'alice', msg);
    const box = store.readMailbox('mail', 'alice');
    expect(box).toHaveLength(1);
    expect(box[0]?.content).toBe('hello');
    const pointers = store.describePointers('mail');
    expect(pointers?.mailboxes.map((m) => m.agentKey).sort()).toEqual(['alice', 'captain']);
    expect(pointers?.mailboxes[0]?.path).toContain('inbox/');
  });

  it('archives team under .agent-teams/archive/', () => {
    store.createTeam({ name: 'done', captainSessionId: 'cap' });
    store.archiveTeam('done');
    expect(store.listTeamIds()).toEqual([]);
    expect(store.listArchivedTeamIds()).toEqual(['done']);
    expect(existsSync(join(store.stateRoot, 'archive', 'done', 'team.json'))).toBe(true);
  });

  it('rejects duplicate team create', () => {
    store.createTeam({ name: 'once', captainSessionId: 'cap' });
    expect(() => store.createTeam({ name: 'once', captainSessionId: 'cap' })).toThrow(
      /already exists/,
    );
  });
});
