/**
 * OmpAgent session-flow regression suite (fake omp CLI via OMP_CLI_PATH):
 * healthy ready→prompt→complete streams, thinking event mapping, host tool
 * dispatch (set_host_tools → host_tool_call → host_tool_result), model
 * switching (set_model {provider, modelId} shape), turn anchors, and the
 * branch-fork handshake (transcript parsing / anchor resolution).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@craft-agent/core/types';
import { OmpAgent } from '../omp-agent.ts';
import {
  createFakeOmp,
  useFakeOmpEnv,
  makeOmpConfig,
  chatEvents,
  type FakeOmp,
} from './omp-fake-cli.ts';

let fake: FakeOmp | null = null;
let restoreEnv: (() => void) | null = null;
const agents: OmpAgent[] = [];

function setup(scenario = 'healthy', overrides: Parameters<typeof makeOmpConfig>[1] = {}): { agent: OmpAgent; fake: FakeOmp } {
  fake = createFakeOmp(scenario);
  restoreEnv = useFakeOmpEnv(fake);
  const agent = new OmpAgent(makeOmpConfig(fake, overrides));
  agents.push(agent);
  return { agent, fake };
}

afterEach(() => {
  for (const agent of agents.splice(0)) agent.destroy();
  restoreEnv?.();
  restoreEnv = null;
  fake?.cleanup();
  fake = null;
});

async function waitForRpcFrame(
  fake: FakeOmp,
  predicate: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = fake.readRpcLog().find(predicate);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error('timed out waiting for RPC frame');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('OmpAgent session flow — healthy turn', () => {
  it('streams a full turn: text deltas, text_complete, usage-bearing complete', async () => {
    const { agent } = setup('healthy');

    const events = await chatEvents(agent, 'hi', 8_000);

    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text);
    expect(deltas).toEqual(['Hello', ' world']);
    const textComplete = events.find((e) => e.type === 'text_complete') as
      | { text: string; isIntermediate?: boolean }
      | undefined;
    expect(textComplete?.text).toBe('Hello world');
    expect(textComplete?.isIntermediate).toBe(false);
    const complete = events.at(-1);
    expect(complete?.type).toBe('complete');
    expect((complete as { usage?: { inputTokens: number; outputTokens: number } }).usage?.inputTokens).toBe(10);
    expect((complete as { usage?: { outputTokens?: number } }).usage?.outputTokens).toBe(5);
    expect(agent.isProcessing()).toBe(false);
  }, 15_000);

  it('maps OMP thinking stream to thinking_delta / thinking_complete events', async () => {
    const { agent } = setup('healthy');

    const events = await chatEvents(agent, 'hi', 8_000);

    const thinkingDelta = events.find((e) => e.type === 'thinking_delta') as { text: string } | undefined;
    expect(thinkingDelta?.text).toBe('let me think');
    const thinkingComplete = events.find((e) => e.type === 'thinking_complete') as { text: string } | undefined;
    expect(thinkingComplete?.text).toBe('let me think');
    // Thinking precedes text in the stream.
    const types = events.map((e) => e.type);
    expect(types.indexOf('thinking_complete')).toBeLessThan(types.indexOf('text_complete'));
  }, 15_000);

  it('emits an omp_turn_anchor resolved from the OMP transcript', async () => {
    const { agent } = setup('healthy');

    const events = await chatEvents(agent, 'hi', 8_000);

    const anchor = events.find((e) => e.type === 'omp_turn_anchor') as
      | { turnId: string; entryId: string }
      | undefined;
    expect(anchor, `expected omp_turn_anchor in ${events.map((e) => e.type).join(',')}`).toBeDefined();
    expect(anchor!.entryId).toBe('bbbb2222');
  }, 15_000);
});

describe('OmpAgent host tool bridge', () => {
  it('registers session tools via set_host_tools with essential loadMode', async () => {
    const { agent, fake } = setup('healthy');

    const registrationP = waitForRpcFrame(fake, (f) => f.type === 'set_host_tools', 15_000);
    await chatEvents(agent, 'hi', 15_000);
    const registration = await registrationP;
    const tools = registration.tools as Array<{ name: string; loadMode?: string; parameters?: unknown }>;
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain('mcp__session__spawn_session');
    expect(names).toContain('mcp__session__call_llm');
    expect(names).toContain('mcp__session__browser_tool');
    // Host-tool Bash: session name plus unprefixed `bash` so OMP's built-in
    // bash is shadowed by craft-side execution (unlocks later craft-exec).
    expect(names).toContain('mcp__session__bash');
    expect(names).toContain('bash');
    const prefixed = tools.find((t) => t.name === 'mcp__session__bash');
    const alias = tools.find((t) => t.name === 'bash');
    expect(prefixed?.parameters).toEqual(alias?.parameters);
    // 'essential' pins tools into the model schema (default would hide them).
    expect(tools.every((t) => t.loadMode === 'essential')).toBe(true);
  }, 20_000);

  it('dispatches host_tool_call → host_tool_result for registry and unknown tools', async () => {
    const { agent, fake } = setup('host-tool');

    const events = await chatEvents(agent, 'hi', 8_000);

    const results = fake.readRpcLog().filter((f) => f.type === 'host_tool_result');
    expect(results).toHaveLength(2);

    const ok = results.find((f) => f.id === 'htc-1')!;
    const okResult = ok.result as { content: Array<{ type: string; text: string }> };
    expect(okResult.content[0]!.type).toBe('text');
    expect(okResult.content[0]!.text).toContain('Diagram syntax is valid');
    expect(ok.isError).toBeUndefined();

    const unknown = results.find((f) => f.id === 'htc-2')!;
    const unknownResult = unknown.result as { content: Array<{ type: string; text: string }> };
    expect(unknownResult.content[0]!.text).toContain('Unknown host tool');
    expect(unknown.isError).toBe(true);

    // The turn completed after the host tool round-trips.
    expect(events.some((e) => e.type === 'text_complete')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
  });

  it('executes unprefixed bash as a craft host tool', async () => {
    const { agent, fake } = setup('host-tool-bash');
    const events = await chatEvents(agent, 'hi', 8_000);

    const result = fake.readRpcLog().find((f) => f.type === 'host_tool_result' && f.id === 'htc-bash');
    expect(result).toBeDefined();
    const payload = result!.result as { content: Array<{ type: string; text: string }> };
    expect(payload.content[0]!.text).toContain('omp-host-bash');
    expect(payload.content[0]!.text).toContain('exitCode: 0');
    expect(result!.isError).toBeUndefined();
    expect(events.at(-1)?.type).toBe('complete');
  }, 20_000);
});

describe('OmpAgent model switching', () => {
  it('setModel fuzzy-resolves via get_available_models and sends set_model {provider, modelId}', async () => {
    const { agent, fake } = setup('healthy');

    await chatEvents(agent, 'hi', 8_000);
    agent.setModel('kimi-K2');

    const setModel = (await waitForRpcFrame(fake, (f) => f.type === 'set_model')) as {
      provider?: string;
      modelId?: string;
    };
    // Shape per docs/omp-rpc-notes.md §Commands: {provider, modelId} — NOT {model}.
    expect(setModel.provider).toBe('rox');
    expect(setModel.modelId).toBe('kimi-k2');
    expect('model' in setModel).toBe(false);
  });

  it('keeps the OMP default when the craft model has no fuzzy match', async () => {
    const { agent, fake } = setup('healthy');

    await chatEvents(agent, 'hi', 8_000);
    const framesBefore = fake.readRpcLog().length;
    agent.setModel('totally-unrelated-model');

    await new Promise((r) => setTimeout(r, 300));
    const setModelFrames = fake
      .readRpcLog()
      .slice(framesBefore)
      .filter((f) => f.type === 'set_model');
    expect(setModelFrames).toHaveLength(0);
  });
});

describe('OmpAgent branch handshake', () => {
  function writeParentTranscript(fake: FakeOmp): { parentSessionPath: string; parentFile: string } {
    const parentSessionPath = join(fake.workspaceRoot, 'sessions', 'parent-session');
    const parentOmpDir = join(parentSessionPath, 'omp');
    mkdirSync(parentOmpDir, { recursive: true });
    const parentFile = join(parentOmpDir, '2026-08-12_parent.jsonl');
    const entries = [
      { type: 'message', id: 'user0001', parentId: null, message: { role: 'user' } },
      { type: 'message', id: 'asst0001', parentId: 'user0001', message: { role: 'assistant' } },
      { type: 'message', id: 'user0002', parentId: 'asst0001', message: { role: 'user' } },
      { type: 'message', id: 'asst0002', parentId: 'user0002', message: { role: 'assistant' } },
    ];
    writeFileSync(parentFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return { parentSessionPath, parentFile };
  }

  it('mid-history branch: switch_session to the parent transcript, then branch at the user entry after the anchor', async () => {
    const { agent, fake } = setup('healthy');
    const { parentSessionPath, parentFile } = writeParentTranscript(fake);
    (agent as any).config.session.branchFromMessageId = 'craft-msg-1';
    (agent as any).config.session.branchFromSessionPath = parentSessionPath;
    (agent as any).config.session.branchFromSdkTurnId = 'asst0001';
    (agent as any).config.session.branchFromSdkSessionId = 'parent-omp-session';

    const events = await chatEvents(agent, 'branch child turn', 8_000);

    const log = fake.readRpcLog();
    const switchFrame = log.find((f) => f.type === 'switch_session');
    expect(switchFrame?.sessionPath).toBe(parentFile);
    const branchFrame = log.find((f) => f.type === 'branch');
    // OMP's branch cuts at the USER entry following the anchor.
    expect(branchFrame?.entryId).toBe('user0002');
    expect(events.at(-1)?.type).toBe('complete');
  });

  it('tail branch: copies the parent transcript and switch_session to the copy', async () => {
    const { agent, fake } = setup('healthy');
    const parentSessionPath = join(fake.workspaceRoot, 'sessions', 'parent-session');
    const parentOmpDir = join(parentSessionPath, 'omp');
    mkdirSync(parentOmpDir, { recursive: true });
    const parentFile = join(parentOmpDir, '2026-08-12_parent.jsonl');
    const entries = [
      { type: 'message', id: 'user0001', parentId: null, message: { role: 'user' } },
      { type: 'message', id: 'asst0001', parentId: 'user0001', message: { role: 'assistant' } },
    ];
    writeFileSync(parentFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    (agent as any).config.session.branchFromMessageId = 'craft-msg-1';
    (agent as any).config.session.branchFromSessionPath = parentSessionPath;
    (agent as any).config.session.branchFromSdkTurnId = 'asst0001';

    const events = await chatEvents(agent, 'tail branch turn', 8_000);

    const log = fake.readRpcLog();
    const switchFrame = log.find((f) => f.type === 'switch_session');
    // Tail fork: switched to a COPY inside the child's own session dir.
    expect(String(switchFrame?.sessionPath)).toContain(join('sessions', 'session-test', 'omp'));
    expect(String(switchFrame?.sessionPath)).toContain('branched-');
    expect(log.some((f) => f.type === 'branch')).toBe(false);
    expect(events.at(-1)?.type).toBe('complete');
  });

  it('fails loudly when the anchor is missing from the parent transcript', async () => {
    const { agent, fake } = setup('healthy');
    const { parentSessionPath } = writeParentTranscript(fake);
    (agent as any).config.session.branchFromMessageId = 'craft-msg-1';
    (agent as any).config.session.branchFromSessionPath = parentSessionPath;
    (agent as any).config.session.branchFromSdkTurnId = 'missing-anchor';

    const events = await chatEvents(agent, 'branch turn', 8_000);

    const errorEvent = events.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(errorEvent?.message).toContain('missing-anchor');
    expect(events.at(-1)?.type).toBe('complete');
    expect(agent.isProcessing()).toBe(false);
  });
});

describe('OmpAgent transcript parsing (pure)', () => {
  it('parseOmpTranscript tolerantly skips malformed lines', () => {
    const { agent, fake } = setup('healthy');
    const file = join(fake.dir, 't.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'message', id: 'a1', message: { role: 'user' } }),
        'this is not json',
        JSON.stringify({ type: 'message', id: 'b2', message: { role: 'assistant' } }),
        '',
      ].join('\n'),
    );

    const entries = (agent as any).parseOmpTranscript(file);
    expect(entries).toHaveLength(2);
    expect(entries[1].id).toBe('b2');
  });

  it('resolveOmpTranscriptFile prefers a sessionId match, else the newest by name', () => {
    const { agent, fake } = setup('healthy');
    const ompDir = join(fake.dir, 'ompdir');
    mkdirSync(ompDir, { recursive: true });
    writeFileSync(join(ompDir, '2026-01-01_aaa_sess1.jsonl'), '');
    writeFileSync(join(ompDir, '2026-01-02_bbb_sess2.jsonl'), '');

    expect((agent as any).resolveOmpTranscriptFile(ompDir, 'sess1')).toBe(join(ompDir, '2026-01-01_aaa_sess1.jsonl'));
    expect((agent as any).resolveOmpTranscriptFile(ompDir, 'sess2')).toBe(join(ompDir, '2026-01-02_bbb_sess2.jsonl'));
    expect((agent as any).resolveOmpTranscriptFile(ompDir, 'unknown')).toBe(join(ompDir, '2026-01-02_bbb_sess2.jsonl'));
    expect((agent as any).resolveOmpTranscriptFile(ompDir, null)).toBe(join(ompDir, '2026-01-02_bbb_sess2.jsonl'));
    expect((agent as any).resolveOmpTranscriptFile(join(fake.dir, 'missing'), 'x')).toBeNull();
  });

  it('readLastAssistantEntryId returns the last assistant entry id', () => {
    const { agent, fake } = setup('healthy');
    const file = join(fake.dir, 't.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'message', id: 'u1', message: { role: 'user' } }),
        JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant' } }),
        JSON.stringify({ type: 'session', id: 's1' }),
        JSON.stringify({ type: 'message', id: 'u2', message: { role: 'user' } }),
        JSON.stringify({ type: 'message', id: 'a2', message: { role: 'assistant' } }),
      ].join('\n'),
    );
    (agent as any).ompSessionFile = file;

    expect((agent as any).readLastAssistantEntryId()).toBe('a2');
  });
});
