import { afterEach, describe, expect, it } from 'bun:test';
import { EventEmitter, once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { PassThrough } from 'node:stream';
import ts from 'typescript';
import type { AgentEvent } from '@rox/core/types';
import { OmpAgent } from '../omp-agent.ts';
import { EventQueue } from '../backend/event-queue.ts';
import { classifyOmpStartupExit } from '../errors.ts';
import { OmpRpcLineGuard, OmpRpcTransport } from '../omp-rpc-transport.ts';
import { redactRegisteredSecrets } from '../../secrets/redact.ts';
import { makeOmpConfig, type FakeOmp } from './omp-fake-cli.ts';

// Execute the actual spawnSubprocess stream/exit/close registrations. The
// decoder, readline, startup classification and terminal handlers are real;
// only the child event source and the inherited-pipe fallback clock are owned.
// No module mocks, executable, authority, provider or process-global clock.
const source = readFileSync(new URL('../omp-agent.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('omp-agent.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const agentClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OmpAgent') as ts.ClassDeclaration;
const spawn = agentClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'spawnSubprocess') as ts.MethodDeclaration;
const namedVariable = (statement: ts.Statement, name: string) => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name);
const statements = spawn.body!.statements;
const first = statements.find(statement => namedVariable(statement, 'isCurrentChild'))!;
const after = statements.find(statement => namedVariable(statement, 'handleTransportError'))!;
if (!first || !after || first.pos >= after.pos) throw new Error('Production subprocess callback boundary was not found');
const compiled = ts.transpileModule(`function install(child) { ${source.slice(first.getStart(ast), after.getStart(ast))} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type Timer = { callback: () => void; delay: number; active: boolean; unref: () => void };
class Clock {
  timers: Timer[] = [];
  set = (callback: () => void, delay: number): Timer => {
    const timer = { callback, delay, active: true, unref() {} };
    this.timers.push(timer);
    return timer;
  };
  clear = (timer: Timer) => { timer.active = false; };
  fire() {
    for (const timer of this.timers.filter(timer => timer.active)) {
      timer.active = false;
      timer.callback();
    }
  }
}
class Child extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kills: string[] = [];
  kill(signal = 'SIGTERM') { this.kills.push(signal); return true; }
  exit(code = 0) { this.exitCode = code; this.emit('exit', code, null); }
  async close(code = this.exitCode) {
    const ended = once(this.stdout, 'end');
    this.stdout.end();
    this.stdout.resume();
    await ended;
    this.stderr.end();
    this.emit('close', code, null);
  }
}
type AgentState = {
  subprocess: ChildProcess | null;
  readline: Interface | null;
  rpcTransport: OmpRpcTransport;
  eventQueue: EventQueue;
  startupInFlight: boolean;
  startupGeneration: number;
  readyAccepted: boolean;
  subprocessReadyResolve: (() => void) | null;
  subprocessReadyReject: ((error: Error) => void) | null;
  _isProcessing: boolean;
  sendCommand: () => Promise<unknown>;
};
const fixtures: Array<{ agent: OmpAgent; dir: string; children: Child[] }> = [];
function fixture(starting = false) {
  const dir = mkdtempSync(join(tmpdir(), 'rox-stdio-close-'));
  const agent = new OmpAgent(makeOmpConfig({ workspaceRoot: dir } as FakeOmp, { model: 'fixture/private' }));
  const state = agent as unknown as AgentState;
  // agent_end's best-effort post-turn state inspection is outside this test;
  // suppress its outgoing request without replacing any lifecycle handler.
  state.sendCommand = async () => ({});
  state.startupInFlight = starting;
  state.readyAccepted = !starting;
  state._isProcessing = !starting;
  const clock = new Clock();
  const install = new Function('createInterface', 'OmpRpcLineGuard', 'classifyOmpStartupExit',
    'redactRegisteredSecrets', 'OMP_STDERR_RING_LIMIT', 'setTimeout', 'clearTimeout', `${compiled}; return install;`)(
    createInterface, OmpRpcLineGuard, classifyOmpStartupExit, redactRegisteredSecrets, 8 * 1024, clock.set, clock.clear,
  ) as (this: OmpAgent, child: Child) => void;
  const owned = { agent, dir, children: [] as Child[] };
  fixtures.push(owned);
  function attach() {
    const child = new Child();
    owned.children.push(child);
    state.subprocess = child as unknown as ChildProcess;
    state.rpcTransport.reset();
    install.call(agent, child);
    state.rpcTransport.enableV2();
    return child;
  }
  return { agent, state, clock, child: attach(), attach };
}
afterEach(() => {
  for (const { agent, dir, children } of fixtures.splice(0)) {
    agent.destroy();
    for (const child of children) {
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
function chunks(frame: Record<string, unknown>): string[] {
  const encoder = new OmpRpcTransport();
  encoder.enableV2();
  return [...encoder.encodeFrames(frame)];
}
function largeResponse(id: string) {
  return chunks({ type: 'response', id, command: 'get_available_models', success: true, data: 'x'.repeat(1_050_000) });
}
function eventSnapshot(queue: EventQueue): AgentEvent[] {
  return [...(queue as unknown as { queue: AgentEvent[] }).queue];
}

describe('OMP actual stream callbacks drain before finalizing child exit', () => {
  it('receives complete final chunk bytes held in stdout until after exit', async () => {
    const { state, child, clock } = fixture();
    let resolved: unknown;
    const requests = state as unknown as { pendingRequests: Map<string, unknown> };
    requests.pendingRequests.set('catalogue', { command: 'get_available_models', timer: undefined,
      resolve: (value: unknown) => { resolved = value; }, reject: () => {} });
    child.stdout.pause();
    for (const frame of largeResponse('catalogue')) child.stdout.write(frame);
    child.exit();
    expect(state.subprocess).toBe(child);
    expect(resolved).toBeUndefined();
    await child.close();
    expect(resolved).toBe('x'.repeat(1_050_000));
    expect(state.subprocess).toBeNull();
    expect(eventSnapshot(state.eventQueue).filter(event => event.type === 'error')).toEqual([
      { type: 'error', message: 'OMP subprocess exited unexpectedly (code 0)' },
    ]);
    expect(clock.timers.filter(timer => timer.active)).toHaveLength(0);
  });

  it('classifies a first chunk delivered after exit as exact truncation at close', async () => {
    const { state, child } = fixture();
    child.stdout.pause();
    child.stdout.write(largeResponse('catalogue')[0]!);
    child.exit();
    await child.close();
    expect(eventSnapshot(state.eventQueue)).toEqual([
      { type: 'error', message: 'OMP RPC chunk sequence was truncated' }, { type: 'complete' },
    ]);
    expect(child.kills).toEqual(['SIGTERM']);
    expect(state.subprocess).toBeNull();
  });

  it('preserves a final successful agent_end line without a trailing newline', async () => {
    const { state, child, clock } = fixture();
    child.stdout.pause();
    child.stdout.write(JSON.stringify({ type: 'agent_end', messages: [] }));
    child.exit();
    await child.close();
    clock.fire();
    expect(eventSnapshot(state.eventQueue)).toEqual([{ type: 'complete' }]);
    expect(state._isProcessing).toBe(false);
    expect(state.subprocess).toBeNull();
  });

  it('settles pre-ready exit immediately at close with the latched final stderr signature', async () => {
    const { state, child, clock } = fixture(true);
    const failures: Array<Error & { ompCode?: string }> = [];
    state.subprocessReadyReject = error => failures.push(error);
    child.exit(1);
    child.stderr.write('No models available. Configure models.yml or an API key.\n');
    child.stderr.write('unrelated diagnostic '.repeat(1024));
    await child.close(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.ompCode).toBe('OMP_NO_MODELS');
    expect(state.startupInFlight).toBe(false);
    expect(clock.timers.filter(timer => timer.active)).toHaveLength(0);
    clock.fire();
    expect(failures).toHaveLength(1);
    expect(eventSnapshot(state.eventQueue)).toEqual([]);
  });

  it('ignores stale predecessor stdout, close and fallback without touching a successor', async () => {
    const { state, child, clock, attach } = fixture();
    child.exit(1);
    const successor = attach();
    successor.stdout.write(largeResponse('unfinished-successor')[0]!);
    await child.close(1);
    clock.fire();
    expect(state.subprocess).toBe(successor);
    expect(eventSnapshot(state.eventQueue)).toEqual([]);
    successor.exit();
    await successor.close();
    expect(eventSnapshot(state.eventQueue)).toEqual([
      { type: 'error', message: 'OMP RPC chunk sequence was truncated' }, { type: 'complete' },
    ]);
  });

  it('bounds inherited open pipes, closes the reader and emits one exact terminal failure', async () => {
    const { state, child, clock } = fixture();
    child.stdout.write(largeResponse('inherited-pipe')[0]!);
    const reader = state.readline!;
    let readerClosed = 0;
    reader.on('close', () => readerClosed++);
    child.exit();
    expect(eventSnapshot(state.eventQueue)).toEqual([]);
    expect(clock.timers.filter(timer => timer.active).map(timer => timer.delay)).toEqual([250]);
    clock.fire();
    expect(readerClosed).toBe(1);
    expect(eventSnapshot(state.eventQueue)).toEqual([
      { type: 'error', message: 'OMP RPC chunk sequence was truncated' }, { type: 'complete' },
    ]);
    await child.close();
    clock.fire();
    expect(eventSnapshot(state.eventQueue).filter(event => event.type === 'complete')).toHaveLength(1);
  });

  it('starts a fresh decoder after truncation and rejects late predecessor bytes', async () => {
    const { state, child, clock, attach } = fixture();
    child.stdout.write(largeResponse('old')[0]!);
    child.exit();
    await child.close();
    expect(eventSnapshot(state.eventQueue)[0]).toEqual({ type: 'error', message: 'OMP RPC chunk sequence was truncated' });
    state.eventQueue.reset();
    state._isProcessing = true;
    state.readyAccepted = true;
    const successor = attach();
    child.emit('exit', 1, null);
    child.emit('close', 1, null);
    clock.fire();
    successor.stdout.write(JSON.stringify({ type: 'agent_end', messages: [] }) + '\n');
    successor.exit();
    await successor.close();
    expect(eventSnapshot(state.eventQueue)).toEqual([{ type: 'complete' }]);
    expect(state.subprocess).toBeNull();
  });
});
