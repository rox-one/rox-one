/**
 * Workspace-local durable Agent Teams store.
 *
 * Path root: `<workspaceRoot>/.agent-teams/` (override via options.stateDirName
 * or an absolute stateRoot). Does **not** consult `workbench.harness.agentTeams`
 * — the Appearance flag only gates UI/palette; this module is always usable
 * for skill/runtime read/write when callers choose to use it.
 *
 * Cordis `@nanmicoder/dsh-agent-teams` stays on H6 skip-list; this is Rox
 * first-party file state only (no Timeline, no second orchestrator).
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type {
  AddAgentTeamMemberInput,
  AgentTeamMember,
  AgentTeamMemberStatus,
  AgentTeamMessage,
  AgentTeamState,
  AgentTeamTask,
  AgentTeamTaskStatus,
  CreateAgentTeamInput,
  UpsertAgentTeamTaskInput,
} from './types.ts';
import { TERMINAL_TASK_STATUSES } from './types.ts';

export { TERMINAL_TASK_STATUSES };
export type {
  AddAgentTeamMemberInput,
  AgentTeamMember,
  AgentTeamMessage,
  AgentTeamState,
  AgentTeamTask,
  AgentTeamTaskStatus,
  CreateAgentTeamInput,
  UpsertAgentTeamTaskInput,
} from './types.ts';

/** Default directory name under the workspace root. */
export const AGENT_TEAMS_STATE_DIR = '.agent-teams';

/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain';

const TEAM_FILE = 'team.json';
const INBOX_DIR = 'inbox';
const ARCHIVE_DIR = 'archive';
const FILE_VERSION = 1 as const;

/** Allowed task status transitions (terminal statuses have none). */
export const TASK_TRANSITIONS: Readonly<Record<AgentTeamTaskStatus, readonly AgentTeamTaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const MAX_KEY_LENGTH = 48;

function keyDigest(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 8);
}

/**
 * Fold a free-form name into a safe path/key segment (Unicode letters/digits
 * survive; everything else folds to `-`).
 */
export function sanitizeKey(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned === '') return `k-${keyDigest(name)}`;
  const points = [...cleaned];
  if (points.length > MAX_KEY_LENGTH) {
    return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(name)}`;
  }
  return cleaned;
}

/** Resolve absolute state root from a workspace path. */
export function resolveAgentTeamsRoot(
  workspaceRoot: string,
  stateDirName: string = AGENT_TEAMS_STATE_DIR,
): string {
  if (isAbsolute(stateDirName)) return stateDirName;
  return join(workspaceRoot, stateDirName);
}

export function teamDir(stateRoot: string, teamId: string): string {
  return join(stateRoot, sanitizeKey(teamId));
}

export function mailboxPath(stateRoot: string, teamId: string, agentKey: string): string {
  return join(teamDir(stateRoot, teamId), INBOX_DIR, `${sanitizeKey(agentKey)}.jsonl`);
}

/** Relative mailbox pointer recorded for skill/docs (posix-ish). */
export function mailboxPointer(teamId: string, agentKey: string): string {
  return `${sanitizeKey(teamId)}/${INBOX_DIR}/${sanitizeKey(agentKey)}.jsonl`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function atomicWriteJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, payload, 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch {
    writeFileSync(filePath, payload, 'utf8');
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function unsatisfiedDependencies(
  tasks: readonly AgentTeamTask[],
  dependencies: readonly string[],
): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return dependencies.filter((id) => byId.get(id)?.status !== 'completed');
}

export function transitionError(
  current: AgentTeamTaskStatus,
  next: AgentTeamTaskStatus,
): string | undefined {
  if (current === next) return undefined;
  if (!TASK_TRANSITIONS[current].includes(next)) {
    return `task status cannot move from "${current}" to "${next}"`;
  }
  return undefined;
}

function parseMember(raw: unknown): AgentTeamMember | null {
  if (!isObject(raw)) return null;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return null;
  const status: AgentTeamMemberStatus =
    raw.status === 'working' || raw.status === 'removed' || raw.status === 'idle'
      ? raw.status
      : 'idle';
  return {
    name: raw.name.trim(),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
    role: typeof raw.role === 'string' ? raw.role : undefined,
    status,
    joinedAt: typeof raw.joinedAt === 'number' ? raw.joinedAt : Date.now(),
  };
}

function parseTask(raw: unknown): AgentTeamTask | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.subject !== 'string' || raw.subject.trim().length === 0) return null;
  const status = raw.status;
  const okStatus =
    status === 'pending' ||
    status === 'claimed' ||
    status === 'in_progress' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled';
  const dependencies = Array.isArray(raw.dependencies)
    ? raw.dependencies.filter((d): d is string => typeof d === 'string')
    : [];
  const now = Date.now();
  return {
    id: raw.id,
    subject: raw.subject.trim(),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    status: okStatus ? status : 'pending',
    assignee: typeof raw.assignee === 'string' ? raw.assignee : undefined,
    dependencies,
    output: typeof raw.output === 'string' ? raw.output : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function parseTeam(raw: unknown): AgentTeamState | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return undefined;
  if (typeof raw.captainSessionId !== 'string' || raw.captainSessionId.length === 0) {
    return undefined;
  }
  const members = Array.isArray(raw.members)
    ? raw.members.map(parseMember).filter((m): m is AgentTeamMember => m !== null)
    : [];
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.map(parseTask).filter((t): t is AgentTeamTask => t !== null)
    : [];
  const phase =
    raw.phase === 'staged' || raw.phase === 'running' || raw.phase === 'archived'
      ? raw.phase
      : 'running';
  const now = Date.now();
  return {
    name: raw.name.trim(),
    id: sanitizeKey(raw.id),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    captainSessionId: raw.captainSessionId,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    members,
    tasks,
    taskSeq: typeof raw.taskSeq === 'number' && raw.taskSeq >= 0 ? raw.taskSeq : tasks.length,
    phase,
  };
}

export interface AgentTeamsStoreOptions {
  /** Absolute workspace root (or any parent of the state dir). */
  workspaceRoot: string;
  /** Directory name under workspace, or absolute override. Default `.agent-teams`. */
  stateDirName?: string;
}

/**
 * File-backed Agent Teams store for one workspace.
 * Read/write works regardless of the Appearance flag default (false).
 */
export class AgentTeamsStore {
  readonly stateRoot: string;

  constructor(options: AgentTeamsStoreOptions) {
    this.stateRoot = resolveAgentTeamsRoot(
      options.workspaceRoot,
      options.stateDirName ?? AGENT_TEAMS_STATE_DIR,
    );
  }

  listTeamIds(): string[] {
    if (!existsSync(this.stateRoot)) return [];
    return readdirSync(this.stateRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== ARCHIVE_DIR)
      .filter((entry) => existsSync(join(this.stateRoot, entry.name, TEAM_FILE)))
      .map((entry) => entry.name)
      .sort();
  }

  readTeam(teamId: string): AgentTeamState | undefined {
    const file = join(teamDir(this.stateRoot, teamId), TEAM_FILE);
    if (!existsSync(file)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      const versioned = isObject(raw) && 'team' in raw ? (raw as { team: unknown }).team : raw;
      return parseTeam(versioned);
    } catch {
      return undefined;
    }
  }

  writeTeam(state: AgentTeamState): void {
    const id = sanitizeKey(state.id);
    const next: AgentTeamState = {
      ...state,
      id,
      updatedAt: Date.now(),
      members: state.members.map((m) => ({ ...m })),
      tasks: state.tasks.map((t) => ({ ...t, dependencies: [...t.dependencies] })),
    };
    const dir = teamDir(this.stateRoot, id);
    ensureDir(join(dir, INBOX_DIR));
    atomicWriteJson(join(dir, TEAM_FILE), { version: FILE_VERSION, team: next });
  }

  createTeam(input: CreateAgentTeamInput): AgentTeamState {
    const id = sanitizeKey(input.name);
    if (this.readTeam(id)) {
      throw new Error(`agent team already exists: ${id}`);
    }
    if (!input.captainSessionId.trim()) {
      throw new Error('captainSessionId is required');
    }
    const now = Date.now();
    const members: AgentTeamMember[] = (input.members ?? []).map((m) => ({
      name: m.name.trim(),
      sessionId: m.sessionId ?? '',
      role: m.role,
      status: m.status ?? 'idle',
      joinedAt: m.joinedAt ?? now,
    }));
    const seen = new Set<string>();
    for (const m of members) {
      const key = sanitizeKey(m.name);
      if (seen.has(key) || key === CAPTAIN_KEY) {
        throw new Error(`duplicate or reserved member name: ${m.name}`);
      }
      seen.add(key);
    }
    let taskSeq = 0;
    const tasks: AgentTeamTask[] = (input.tasks ?? []).map((t) => {
      taskSeq += 1;
      return {
        id: `t${taskSeq}`,
        subject: t.subject.trim(),
        description: t.description,
        status: t.status ?? 'pending',
        assignee: t.assignee,
        dependencies: [...(t.dependencies ?? [])],
        output: t.output,
        createdAt: now,
        updatedAt: now,
      };
    });
    const state: AgentTeamState = {
      name: input.name.trim(),
      id,
      description: input.description,
      captainSessionId: input.captainSessionId.trim(),
      createdAt: now,
      updatedAt: now,
      members,
      tasks,
      taskSeq,
      phase: input.phase ?? 'staged',
    };
    this.writeTeam(state);
    // Ensure captain mailbox file exists as a pointer target.
    ensureDir(dirname(mailboxPath(this.stateRoot, id, CAPTAIN_KEY)));
    if (!existsSync(mailboxPath(this.stateRoot, id, CAPTAIN_KEY))) {
      writeFileSync(mailboxPath(this.stateRoot, id, CAPTAIN_KEY), '', 'utf8');
    }
    for (const m of members) {
      const path = mailboxPath(this.stateRoot, id, m.name);
      if (!existsSync(path)) writeFileSync(path, '', 'utf8');
    }
    return this.readTeam(id)!;
  }

  findTeamByCaptain(captainSessionId: string): AgentTeamState | undefined {
    for (const id of this.listTeamIds()) {
      const team = this.readTeam(id);
      if (team && team.captainSessionId === captainSessionId && team.phase !== 'archived') {
        return team;
      }
    }
    return undefined;
  }

  findTeamByParticipant(sessionId: string): AgentTeamState | undefined {
    for (const id of this.listTeamIds()) {
      const team = this.readTeam(id);
      if (!team || team.phase === 'archived') continue;
      if (team.captainSessionId === sessionId) return team;
      if (team.members.some((m) => m.sessionId === sessionId && m.status !== 'removed')) {
        return team;
      }
    }
    return undefined;
  }

  addMember(teamId: string, input: AddAgentTeamMemberInput): AgentTeamState {
    const team = this.readTeam(teamId);
    if (!team) throw new Error(`agent team not found: ${teamId}`);
    const name = input.name.trim();
    const key = sanitizeKey(name);
    if (key === CAPTAIN_KEY) throw new Error('member name "captain" is reserved');
    if (team.members.some((m) => sanitizeKey(m.name) === key && m.status !== 'removed')) {
      throw new Error(`member already exists: ${name}`);
    }
    const now = Date.now();
    const member: AgentTeamMember = {
      name,
      sessionId: input.sessionId ?? '',
      role: input.role,
      status: input.status ?? 'idle',
      joinedAt: now,
    };
    const members = [
      ...team.members.filter((m) => sanitizeKey(m.name) !== key),
      member,
    ];
    this.writeTeam({ ...team, members });
    const path = mailboxPath(this.stateRoot, team.id, name);
    ensureDir(dirname(path));
    if (!existsSync(path)) writeFileSync(path, '', 'utf8');
    return this.readTeam(teamId)!;
  }

  setMemberSession(teamId: string, memberName: string, sessionId: string): AgentTeamState {
    const team = this.readTeam(teamId);
    if (!team) throw new Error(`agent team not found: ${teamId}`);
    const key = sanitizeKey(memberName);
    const members = team.members.map((m) =>
      sanitizeKey(m.name) === key ? { ...m, sessionId } : m,
    );
    if (!members.some((m) => sanitizeKey(m.name) === key)) {
      throw new Error(`member not found: ${memberName}`);
    }
    this.writeTeam({ ...team, members });
    return this.readTeam(teamId)!;
  }

  upsertTask(teamId: string, input: UpsertAgentTeamTaskInput): AgentTeamState {
    const team = this.readTeam(teamId);
    if (!team) throw new Error(`agent team not found: ${teamId}`);
    const now = Date.now();
    let tasks = [...team.tasks];
    let taskSeq = team.taskSeq;
    if (input.id) {
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx < 0) throw new Error(`task not found: ${input.id}`);
      const current = tasks[idx]!;
      const nextStatus = input.status ?? current.status;
      if (input.status) {
        const err = transitionError(current.status, nextStatus);
        if (err) throw new Error(err);
      }
      if (nextStatus === 'claimed' || nextStatus === 'in_progress') {
        const blocked = unsatisfiedDependencies(tasks, input.dependencies ?? current.dependencies);
        if (blocked.length > 0) {
          throw new Error(`dependencies not completed: ${blocked.join(', ')}`);
        }
      }
      tasks[idx] = {
        ...current,
        subject: input.subject.trim(),
        description: input.description ?? current.description,
        status: nextStatus,
        assignee: input.assignee ?? current.assignee,
        dependencies: input.dependencies ? [...input.dependencies] : [...current.dependencies],
        output: input.output ?? current.output,
        updatedAt: now,
      };
    } else {
      taskSeq += 1;
      tasks.push({
        id: `t${taskSeq}`,
        subject: input.subject.trim(),
        description: input.description,
        status: input.status ?? 'pending',
        assignee: input.assignee,
        dependencies: [...(input.dependencies ?? [])],
        output: input.output,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.writeTeam({ ...team, tasks, taskSeq });
    return this.readTeam(teamId)!;
  }

  createMessage(from: string, to: string, content: string): AgentTeamMessage {
    return {
      id: randomUUID(),
      from,
      to,
      content,
      ts: Date.now(),
    };
  }

  appendMailbox(teamId: string, agentKey: string, message: AgentTeamMessage): void {
    if (!this.readTeam(teamId)) throw new Error(`agent team not found: ${teamId}`);
    const path = mailboxPath(this.stateRoot, teamId, agentKey);
    ensureDir(dirname(path));
    appendFileSync(path, `${JSON.stringify(message)}\n`, 'utf8');
  }

  readMailbox(teamId: string, agentKey: string): AgentTeamMessage[] {
    const path = mailboxPath(this.stateRoot, teamId, agentKey);
    if (!existsSync(path)) return [];
    const text = readFileSync(path, 'utf8');
    if (!text.trim()) return [];
    const out: AgentTeamMessage[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as unknown;
        if (!isObject(raw)) continue;
        if (typeof raw.id !== 'string' || typeof raw.from !== 'string') continue;
        if (typeof raw.to !== 'string' || typeof raw.content !== 'string') continue;
        if (typeof raw.ts !== 'number') continue;
        out.push({
          id: raw.id,
          from: raw.from,
          to: raw.to,
          content: raw.content,
          ts: raw.ts,
          readAt: typeof raw.readAt === 'number' ? raw.readAt : undefined,
        });
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  /** Roster + relative mailbox pointers for inspector/skill summaries. */
  describePointers(teamId: string): {
    team: AgentTeamState;
    mailboxes: Array<{ agentKey: string; path: string }>;
  } | undefined {
    const team = this.readTeam(teamId);
    if (!team) return undefined;
    const keys = [CAPTAIN_KEY, ...team.members.map((m) => m.name)];
    return {
      team,
      mailboxes: keys.map((agentKey) => ({
        agentKey,
        path: mailboxPointer(team.id, agentKey),
      })),
    };
  }

  archiveTeam(teamId: string): void {
    const team = this.readTeam(teamId);
    if (!team) throw new Error(`agent team not found: ${teamId}`);
    this.writeTeam({ ...team, phase: 'archived' });
    const from = teamDir(this.stateRoot, team.id);
    const to = join(this.stateRoot, ARCHIVE_DIR, team.id);
    ensureDir(dirname(to));
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
  }

  listArchivedTeamIds(): string[] {
    const archiveRoot = join(this.stateRoot, ARCHIVE_DIR);
    if (!existsSync(archiveRoot)) return [];
    return readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(archiveRoot, entry.name, TEAM_FILE)))
      .map((entry) => entry.name)
      .sort();
  }
}

/** True when a status is terminal. */
export function isTerminalTaskStatus(status: AgentTeamTaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

