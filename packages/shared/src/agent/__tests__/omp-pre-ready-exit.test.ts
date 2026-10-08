/**
 * OmpAgent pre-ready exit regression suite ([MOD-AGENT-01], Windows-safe).
 *
 * When the `omp --mode rpc` subprocess exits BEFORE sending the `ready` frame
 * (e.g. no `~/.omp/agent/config.yml` credentials → "No models available…",
 * exit code 1), the turn must reject with a typed, actionable error instead
 * of hanging in `ensureSubprocess()` forever.
 *
 * Unlike `omp-startup-lifecycle.test.ts` (POSIX shell-wrapper fake binary —
 * not spawnable on Windows), this suite mocks `node:child_process` `spawn`
 * directly, so it runs on Win10/Win11 as well as POSIX. Every chat drain is
 * wall-clock bounded: a hang fails the test instead of stalling the suite.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@rox/core/types';
import type { BackendConfig } from '../backend/types.ts';
import { drainWithTimeout } from './omp-fake-cli.ts';

// ---------------------------------------------------------------------------
// Mocked spawn harness (must be installed BEFORE OmpAgent is imported).
// ---------------------------------------------------------------------------

/** Captured argv of every mocked spawn call (one entry per child). */
const spawnedArgv: string[][] = [];

/** Scenarios the mocked child can play. */
type MockScenario =
  | { kind: 'exit-before-ready'; code: number; signal: null; stderr: string }
  | { kind: 'print' };

let scenario: MockScenario = {
  kind: 'exit-before-ready',
  code: 1,
  signal: null,
  stderr: 'No models available. Use /login or set an API key environment variable.\n',
};

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 424242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: string | null = null;

  kill(signal?: string): boolean {
    this.killed = signal ?? 'SIGTERM';
    return true;
  }
}

function fakeSpawn(_bin: string, args: string[] = []): unknown {
  spawnedArgv.push([...args]);
  const child = new FakeChild();
  const current = scenario;

  setImmediate(() => {
    if (current.kind === 'print') {
      const pIdx = args.indexOf('-p');
      const mIdx = args.indexOf('--model');
      const model = mIdx !== -1 ? args[mIdx + 1] : undefined;
      if (model && /unknown/i.test(model)) {
        child.stderr.write(`Error: Model not found: ${model}\n`);
        child.stderr.end();
        child.stdout.end();
        child.exitCode = 1;
        child.emit('exit', 1, null);
        child.emit('close', 1, null);
        return;
      }
      const prompt = (pIdx !== -1 ? args[pIdx + 1] : '') ?? '';
      child.stdout.write(`fake-omp answer: ${prompt.slice(0, 60)}\n`);
      child.stdout.end();
      child.stderr.end();
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      return;
    }

    // RPC spawn that dies before the ready frame.
    child.stderr.write(current.stderr);
    child.stderr.end();
    child.stdout.end();
    child.exitCode = current.code;
    child.emit('exit', current.code, current.signal);
    // 'close' trails 'exit' on a real child; emit it so the deferred
    // exit-time classification settles immediately (no 250ms fallback).
    child.emit('close', current.code, current.signal);
  });

  return child;
}

const realCp = await import('node:child_process');
mock.module('node:child_process', () => ({ ...realCp, spawn: fakeSpawn }));

const { OmpAgent } = await import('../omp-agent.ts');

// ---------------------------------------------------------------------------
// Config / lifecycle helpers.
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
const agents: InstanceType<typeof OmpAgent>[] = [];
const savedOmpPath = process.env.OMP_CLI_PATH;
process.env.OMP_CLI_PATH = 'mocked-omp-for-tests';

function makeConfig(workspaceRoot: string): BackendConfig {
  return {
    provider: 'omp',
    workspace: { id: 'ws-pre-ready', name: 'PreReady', rootPath: workspaceRoot },
    session: {
      id: 'session-pre-ready',
      workspaceRootPath: workspaceRoot,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    },
    isHeadless: true,
  } as unknown as BackendConfig;
}

function setup(next: MockScenario): InstanceType<typeof OmpAgent> {
  scenario = next;
  // resolveOmpExecutableOrExplain() returns OMP_CLI_PATH verbatim; the mocked
  // spawn ignores the binary path, but the seam must still resolve.
  process.env.OMP_CLI_PATH = 'mocked-omp-for-tests';
  const root = mkdtempSync(join(tmpdir(), 'omp-pre-ready-'));
  tmpRoots.push(root);
  const agent = new OmpAgent(makeConfig(root));
  agents.push(agent);
  return agent;
}

afterEach(() => {
  for (const agent of agents.splice(0)) {
    try {
      agent.destroy();
    } catch {
      // destroy is best-effort teardown
    }
  }
  for (const root of tmpRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // temp cleanup is best-effort
    }
  }
  spawnedArgv.length = 0;
  if (savedOmpPath === undefined) delete process.env.OMP_CLI_PATH;
  else process.env.OMP_CLI_PATH = savedOmpPath;
});

function typedError(events: AgentEvent[]): Extract<AgentEvent, { type: 'typed_error' }> {
  const hit = events.find((e) => e.type === 'typed_error');
  expect(hit, `expected a typed_error event, got: ${JSON.stringify(events)}`).toBeDefined();
  return hit as Extract<AgentEvent, { type: 'typed_error' }>;
}

// ---------------------------------------------------------------------------
// [MOD-AGENT-01] early-exit-before-ready must reject, never hang.
// ---------------------------------------------------------------------------

/**
 * Bounded chat drain for the early-exit tests. 20s keeps the anti-hang
 * assertion meaningful (a wedged startup still fails loudly) while staying
 * under the <25s actionable-error DoD and tolerating cold-start init costs
 * (toolchain/credential/skill scans) on Windows CI hosts.
 */
const CHAT_BOUND_MS = 20_000;

describe('OmpAgent pre-ready exit (mocked spawn)', () => {
  it('rejects with actionable OMP_NO_MODELS (bounded, no hang) when stderr says no models', async () => {
    const agent = setup({
      kind: 'exit-before-ready',
      code: 1,
      signal: null,
      stderr: 'No models available. Use /login or set an API key environment variable.\n',
    });

    const events = await drainWithTimeout(agent.chat('hi'), CHAT_BOUND_MS);

    const typed = typedError(events);
    expect(String(typed.error.code)).toBe('OMP_NO_MODELS');
    // Actionable Rox-gateway guidance reaches the user (stderr tail + hint).
    expect(typed.error.message).toMatch(/ROX_API_KEY|config\.yml|models\.yml/i);
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });

  it('classifies a generic non-zero early exit as OMP_START_FAILED (bounded)', async () => {
    const agent = setup({
      kind: 'exit-before-ready',
      code: 1,
      signal: null,
      stderr: 'boom: something broke\n',
    });

    const events = await drainWithTimeout(agent.chat('hi'), CHAT_BOUND_MS);

    expect(String(typedError(events).error.code)).toBe('OMP_START_FAILED');
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });

  it('treats a clean early exit without a ready frame as OMP_PROTOCOL_ERROR (bounded)', async () => {
    const agent = setup({
      kind: 'exit-before-ready',
      code: 0,
      signal: null,
      stderr: '',
    });

    const events = await drainWithTimeout(agent.chat('hi'), CHAT_BOUND_MS);

    expect(String(typedError(events).error.code)).toBe('OMP_PROTOCOL_ERROR');
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// [MOD-AGENT-04] queryLlm model honesty over the one-shot path.
// ---------------------------------------------------------------------------

describe('OmpAgent queryLlm over mocked one-shot spawn', () => {
  it('passes request.model via --model and reports it as the effective model', async () => {
    const agent = setup({ kind: 'print' });

    const result = await agent.queryLlm({ prompt: 'summarize', model: 'rox/standard' });

    expect(result.text).toContain('fake-omp answer');
    expect(result.model).toBe('rox/standard');
    const printCalls = spawnedArgv.filter((argv) => argv.includes('-p'));
    expect(printCalls).toHaveLength(1);
    const mIdx = printCalls[0]!.indexOf('--model');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(printCalls[0]![mIdx + 1]).toBe('rox/standard');
  });

  it('does not fabricate a model when no model was requested', async () => {
    const agent = setup({ kind: 'print' });

    const result = await agent.queryLlm({ prompt: 'summarize' });

    expect(result.text).toContain('fake-omp answer');
    expect(result.model).toBeUndefined();
    const printCalls = spawnedArgv.filter((argv) => argv.includes('-p'));
    expect(printCalls).toHaveLength(1);
    expect(printCalls[0]).not.toContain('--model');
  });
});
