/**
 * Test harness for OmpAgent: a fake `omp` CLI binary driven by a scenario
 * file, injected through the OMP_CLI_PATH override seam
 * (resolveOmpExecutableOrExplain). The fake speaks the NDJSON RPC protocol
 * (docs/omp-rpc-notes.md) well enough to exercise startup, prompt streams,
 * host-tool dispatch, model switching and branch handshakes, and can also
 * fail in scripted ways (exit before ready, malformed ready, silence).
 *
 * The fake is a plain CJS script executed by the current runtime
 * (process.execPath) through a generated shell wrapper.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@craft-agent/core/types';
import type { BackendConfig } from '../backend/types.ts';

export interface FakeOmp {
  /** Temp dir holding the fake binary + control files. */
  dir: string;
  /** Workspace root for the agent config (sessions live under it). */
  workspaceRoot: string;
  /** Executable path for OMP_CLI_PATH. */
  binPath: string;
  /** Scenario control file — rewrite between turns to change behavior. */
  scenarioFile: string;
  /** NDJSON log of every inbound frame the fake received. */
  rpcLog: string;
  /** Log of argv for every fake invocation (one JSON array per line). */
  argvLog: string;
  /** Transcript JSONL the fake writes at turn end (anchor resolution). */
  transcriptFile: string;
  setScenario(name: string): void;
  readRpcLog(): Array<Record<string, unknown>>;
  readArgvLog(): string[][];
  cleanup(): void;
}

const FAKE_OMP_JS = String.raw`'use strict';
const fs = require('node:fs');
const readline = require('node:readline');

const SCENARIO_FILE = process.env.FAKE_OMP_SCENARIO_FILE || '';
const RPC_LOG = process.env.FAKE_OMP_RPC_LOG || '';
const ARGV_LOG = process.env.FAKE_OMP_ARGV_LOG || '';
const TRANSCRIPT_FILE = process.env.FAKE_OMP_TRANSCRIPT_FILE || '';

if (ARGV_LOG) {
  fs.appendFileSync(ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
}

function readScenario() {
  if (!SCENARIO_FILE) return 'healthy';
  try { return fs.readFileSync(SCENARIO_FILE, 'utf8').trim(); } catch { return 'healthy'; }
}

function logRpc(obj) {
  if (!RPC_LOG) return;
  try { fs.appendFileSync(RPC_LOG, JSON.stringify(obj) + '\n'); } catch {}
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const READY_FRAME = {
  type: 'ready',
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576,
};

// ---------- print mode (omp -p <prompt>) — queryLlm / runMiniCompletion ----------
const pIdx = process.argv.indexOf('-p');
if (pIdx !== -1) {
  const mIdx = process.argv.indexOf('--model');
  const model = mIdx !== -1 ? process.argv[mIdx + 1] : undefined;
  if (model && /unknown/i.test(model)) {
    fs.writeSync(2, 'Error: Model not found: ' + model + '\n');
    process.exit(1);
  }
  const prompt = process.argv[pIdx + 1] || '';
  fs.writeSync(1, 'fake-omp answer: ' + prompt.slice(0, 60) + '\n');
  process.exit(0);
}

const scenario = readScenario();
let hostToolResultsReceived = 0;

function hang() {
  setInterval(() => {}, 60000);
}

function writeTranscript() {
  if (!TRANSCRIPT_FILE) return;
  const entries = [
    { type: 'message', id: 'aaaa1111', parentId: null, message: { role: 'user' } },
    { type: 'message', id: 'bbbb2222', parentId: 'aaaa1111', message: { role: 'assistant' } },
  ];
  try { fs.writeFileSync(TRANSCRIPT_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n'); } catch {}
}

function emitTurnStream() {
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.001 } };
  const assistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
    stopReason: 'stop',
    usage,
  };
  send({ type: 'agent_start' });
  send({ type: 'turn_start' });
  send({ type: 'message_start', message: { role: 'user' } });
  send({ type: 'message_end', message: { role: 'user' } });
  send({ type: 'message_start', message: { role: 'assistant' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'let me think' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end', content: 'let me think' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_start' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'Hello world' } });
  send({ type: 'message_end', message: assistantMessage });
  send({ type: 'turn_end', message: assistantMessage });
  writeTranscript();
  send({ type: 'agent_end', messages: [{ role: 'user' }, assistantMessage] });
}

function rpcLoop() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    logRpc(msg);
    const id = msg.id;
    const respond = (data) => {
      if (id !== undefined) send({ id, type: 'response', command: msg.type, success: true, data });
    };
    switch (msg.type) {
      case 'prompt':
        respond(true);
        if (scenario === 'host-tool') {
          send({ type: 'agent_start' });
          send({ type: 'turn_start' });
          send({ type: 'host_tool_call', id: 'htc-1', toolName: 'mcp__session__mermaid_validate', arguments: { code: 'graph TD\n  A-->B' } });
          send({ type: 'host_tool_call', id: 'htc-2', toolName: 'mcp__session__no_such_tool', arguments: {} });
        } else if (scenario === 'host-tool-bash') {
          send({ type: 'agent_start' });
          send({ type: 'turn_start' });
          send({ type: 'host_tool_call', id: 'htc-bash', toolName: 'bash', arguments: { command: 'echo omp-host-bash' } });
        } else {
          emitTurnStream();
        }
        break;
      case 'host_tool_result':
        hostToolResultsReceived += 1;
        if (scenario === 'host-tool' && hostToolResultsReceived >= 2) {
          emitTurnStream();
        }
        if (scenario === 'host-tool-bash' && hostToolResultsReceived >= 1) {
          emitTurnStream();
        }
        break;
      case 'extension_ui_response':
        break;
      case 'get_state':
        respond({
          sessionId: 'fake-omp-session-id',
          sessionFile: TRANSCRIPT_FILE || undefined,
          model: 'rox/kimi-k3',
        });
        break;
      case 'set_host_tools':
        respond({ toolNames: (msg.tools || []).map((t) => t.name) });
        break;
      case 'get_available_models':
        respond([
          { provider: 'rox', id: 'kimi-k3', name: 'Kimi K3' },
          { provider: 'rox', id: 'kimi-k2', name: 'Kimi K2' },
        ]);
        break;
      case 'switch_session':
        respond({ cancelled: false });
        break;
      case 'branch':
        respond({ text: 'branch source text', cancelled: false });
        break;
      default:
        respond(true);
    }
  });
}

switch (scenario) {
  case 'exit-no-models':
    fs.writeSync(2, 'No models available. Use /login or set an API key environment variable.\n');
    process.exit(1);
    break;
  case 'exit-auth':
    fs.writeSync(2, 'Error: authentication required - run omp /login to sign in.\n');
    process.exit(1);
    break;
  case 'exit-generic':
    fs.writeSync(2, 'boom: something broke\n');
    process.exit(1);
    break;
  case 'exit-clean':
    process.exit(0);
    break;
  case 'malformed-ready':
    send({ type: 'ready', protocolVersion: 'oops-not-a-number' });
    hang();
    break;
  case 'never-ready':
    hang();
    break;
  case 'slow-ready':
    setTimeout(() => {
      send(READY_FRAME);
      rpcLoop();
    }, 1500);
    break;
  case 'healthy':
  case 'host-tool':
  case 'host-tool-bash':
  default:
    send(READY_FRAME);
    rpcLoop();
    break;
}
`;

export function createFakeOmp(scenario = 'healthy'): FakeOmp {
  const dir = mkdtempSync(join(tmpdir(), 'omp-fake-'));
  const workspaceRoot = join(dir, 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });

  const scriptPath = join(dir, 'fake-omp.js');
  writeFileSync(scriptPath, FAKE_OMP_JS);

  const binPath = join(dir, 'fake-omp');
  writeFileSync(binPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  chmodSync(binPath, 0o755);

  const scenarioFile = join(dir, 'scenario');
  writeFileSync(scenarioFile, scenario);
  const rpcLog = join(dir, 'rpc.log');
  const argvLog = join(dir, 'argv.log');
  const transcriptFile = join(dir, 'fake-transcript.jsonl');

  return {
    dir,
    workspaceRoot,
    binPath,
    scenarioFile,
    rpcLog,
    argvLog,
    transcriptFile,
    setScenario(name: string) {
      writeFileSync(scenarioFile, name);
    },
    readRpcLog() {
      if (!existsSync(rpcLog)) return [];
      return readFileSync(rpcLog, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    readArgvLog() {
      if (!existsSync(argvLog)) return [];
      return readFileSync(argvLog, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as string[]);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ENV_KEYS = [
  'OMP_CLI_PATH',
  'FAKE_OMP_SCENARIO_FILE',
  'FAKE_OMP_RPC_LOG',
  'FAKE_OMP_ARGV_LOG',
  'FAKE_OMP_TRANSCRIPT_FILE',
] as const;

/**
 * Point OMP_CLI_PATH (and the fake's control env) at the fake binary.
 * Returns a restore function.
 */
export function useFakeOmpEnv(fake: FakeOmp): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);

  process.env.OMP_CLI_PATH = fake.binPath;
  process.env.FAKE_OMP_SCENARIO_FILE = fake.scenarioFile;
  process.env.FAKE_OMP_RPC_LOG = fake.rpcLog;
  process.env.FAKE_OMP_ARGV_LOG = fake.argvLog;
  process.env.FAKE_OMP_TRANSCRIPT_FILE = fake.transcriptFile;

  return () => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function makeOmpConfig(fake: FakeOmp, overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'omp',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: fake.workspaceRoot,
    } as BackendConfig['workspace'],
    session: {
      id: 'session-test',
      workspaceRootPath: fake.workspaceRoot,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as NonNullable<BackendConfig['session']>,
    isHeadless: true,
    ...overrides,
  };
}

/**
 * Drain an agent event generator with a hard wall-clock bound. Rejects when
 * the generator stalls — this is the anti-hang assertion for the pre-ready
 * exit bug (chatImpl used to await ensureSubprocess() forever).
 */
export async function drainWithTimeout(
  gen: AsyncGenerator<AgentEvent>,
  timeoutMs = 10_000,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`event generator did not complete within ${timeoutMs}ms (got ${events.length} events)`);
    }
    const result = await Promise.race([
      gen.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`event generator stalled after ${events.length} events`)), remaining),
      ),
    ]);
    if (result.done) return events;
    events.push(result.value);
  }
}

export function chatEvents(agent: { chat: (m: string) => AsyncGenerator<AgentEvent> }, message: string, timeoutMs = 10_000): Promise<AgentEvent[]> {
  return drainWithTimeout(agent.chat(message), timeoutMs);
}
