import { describe, expect, it } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmpRuntimeObserver, type OmpRuntimeObservation } from '../omp-runtime-observer.ts';
import { OmpRuntimeTraceBridge } from '../omp-runtime-trace-bridge.ts';
import { OmpAgent } from '../omp-agent.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv } from './omp-fake-cli.ts';
import type { AgentEvent } from '@rox/core/types';
import type { HostBashObservation, SessionToolContext } from '@rox/session-tools-core';
import { setHostBashPort } from '@rox/session-tools-core';

let testNativeSequence = 0;
const native = (hook: string, payload: Record<string, unknown>, overrides: Partial<OmpRuntimeObservation> = {}): OmpRuntimeObservation => ({
  version: 1, id: `event-${crypto.randomUUID()}`, sourceId: 'factory-child', sourceSeq: ++testNativeSequence,
  runId: 'current-turn', observedAt: 100, elapsedMs: 10, nativeSessionId: 'native-child',
  agent: { kind: 'sub', id: 'Child', name: 'scout', depth: 1, parentId: 'Main' },
  model: { provider: 'fixture', id: 'worker', contextWindow: 200000 }, cwd: '/fixture', payload, hook, ...overrides,
});

describe('OMP native runtime observation transport', () => {
  it('binds real hook payloads without mutating tools, permissions or prompt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const previousEnv = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH, key: process.env.ROX_API_KEY,
      shortToken: process.env.ROX_OBSERVER_SHORT_TOKEN, longerToken: process.env.ROX_OBSERVER_LONGER_TOKEN };
    const events: OmpRuntimeObservation[] = [];
    const errors: Error[] = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => { if (event.agent.id === 'ActualNativeId') events.push(event); }, error => errors.push(error));
    try {
      Object.assign(process.env, observer.env, { ROX_API_KEY: 'SECRET_FIXTURE_API_KEY',
        ROX_OBSERVER_SHORT_TOKEN: 'six7!?', ROX_OBSERVER_LONGER_TOKEN: 'SECRET_FIXTURE_API_KEY_private-suffix' });
      observer.beginRun('current-turn');
      const handlers = new Map<string, Function>();
      const tools = Object.freeze(['read', 'yield']);
      const factory = (await import(observer.extensionPath)).default;
      factory({ on: (hook: string, handler: Function) => handlers.set(hook, handler), getActiveTools: () => tools,
        getAllTools: () => tools.map(name => ({ name })), getThinkingLevel: () => 'high' });
      const ctx = { agent: { kind: 'sub' as const, id: 'ActualNativeId', name: 'scout SECRET_FIXTURE_API_KEY', depth: 2, parentId: 'ActualParentId' },
        sessionManager: { getSessionId: () => 'actual-native-session' }, cwd: '/fixture/SECRET_FIXTURE_API_KEY', model: { provider: 'fixture', id: 'worker', contextWindow: 200000 },
        getContextUsage: () => ({ tokens: 123, contextWindow: 200000, percent: 0.0615 }) };
      const parentHooks = new Map<string, Function>();
      factory({ on: (hook: string, handler: Function) => parentHooks.set(hook, handler), getActiveTools: () => tools,
        getAllTools: () => tools.map(name => ({ name })), getThinkingLevel: () => 'high' });
      const parent = { ...ctx, agent: { kind: 'main', id: 'ActualParentId', name: 'parent', depth: 0 } };
      parentHooks.get('before_agent_start')!({ prompt: 'parent', systemPrompt: [] }, parent);
      parentHooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'actual-parent-call:0' }, parent);
      const prompt = { prompt: 'Assignment with SECRET_FIXTURE_API_KEY', systemPrompt: ['Keep restrictions'], images: [{ type: 'image', mimeType: 'image/png', data: 'pixels' }] };
      let accessorReads = 0;
      const args = Object.assign(JSON.parse('{"__proto__":{"marker":"fixture"}}'), { path: '/fixture/a', Authorization: 'Bearer private' });
      Object.defineProperty(args, 'password', { enumerable: true, get: () => { accessorReads++; throw new Error('Private getter must not execute'); } });
      Object.defineProperty(args, 'publicGetter', { enumerable: true, get: () => { accessorReads++; return 'uncaptured'; } });
      expect(handlers.get('before_agent_start')!(prompt, ctx)).toBeUndefined();
      expect(handlers.get('tool_execution_start')!({ toolCallId: 'real-call', toolName: 'read', args }, ctx)).toBeUndefined();
      const privateText = 'password="unregistered quoted value" password=\'unregistered single value\'\nCookie: session=unregistered-cookie; private-attr=value\nKnown opaque values: six7!? SECRET_FIXTURE_API_KEY_private-suffix';
      const privateJSON = JSON.stringify({ password: 'unregistered JSON value', env: { CUSTOM: 'unregistered ENV value' }, inputTokens: 99 });
      handlers.get('tool_execution_end')!({ toolCallId: 'real-call', toolName: 'read', result: { content: [{ type: 'text', text: privateText }, { type: 'text', text: privateJSON }] }, isError: false }, ctx);
      observer.drain();
      expect(events).toHaveLength(3);
      expect(events[0]!.agent).toEqual({ ...ctx.agent, name: 'scout [REDACTED]' });
      expect(events[0]!.cwd).toBe('/fixture/[REDACTED]');
      expect(events[0]!.sourceSeq).toBe(1);
      expect(events[2]!.sourceSeq).toBe(3);
      expect(events[0]!.payload.prompt).toBe('Assignment with [REDACTED]');
      expect(accessorReads).toBe(0);
      expect(events[1]!.payload.args).toEqual({ ['__proto__']: { marker: 'fixture' }, path: '/fixture/a', Authorization: '[REDACTED]', password: '[REDACTED]', publicGetter: '[Accessor omitted]' });
      expect(Object.hasOwn(events[1]!.payload.args as object, '__proto__')).toBe(true);
      expect((events[1]!.payload.args as Record<string, unknown>).marker).toBeUndefined();
      expect(prompt.prompt).toBe('Assignment with SECRET_FIXTURE_API_KEY');
      expect(ctx.agent.name).toBe('scout SECRET_FIXTURE_API_KEY');
      expect(tools).toEqual(['read', 'yield']);
      const stored = readFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, 'utf8');
      expect(stored).not.toContain('SECRET_FIXTURE_API_KEY');
      expect(stored).not.toContain('pixels');
      for (const value of ['unregistered quoted value', 'unregistered single value', 'unregistered-cookie', 'unregistered JSON value', 'unregistered ENV value', 'six7!?', '_private-suffix']) {
        expect(stored).not.toContain(value);
        expect(JSON.stringify(events)).not.toContain(value);
      }
      expect(stored).toContain('inputTokens');
      expect(errors).toHaveLength(0);
    } finally {
      observer.dispose();
      expect(existsSync(join(root, 'observer'))).toBe(false);
      for (const [key, value] of Object.entries({ ROX_RUNTIME_OBSERVATION_PATH: previousEnv.path, ROX_RUNTIME_CONTROL_PATH: previousEnv.control, ROX_API_KEY: previousEnv.key,
        ROX_OBSERVER_SHORT_TOKEN: previousEnv.shortToken, ROX_OBSERVER_LONGER_TOKEN: previousEnv.longerToken })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts an incomplete final frame exactly once and rejects oversized frames', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const events: OmpRuntimeObservation[] = [];
    const errors: Error[] = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => events.push(event), error => errors.push(error));
    try {
      const line = JSON.stringify(native('agent_start', {}));
      appendFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, line.slice(0, 50));
      observer.drain();
      expect(events).toHaveLength(0);
      appendFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, line.slice(50) + '\n');
      observer.drain(); observer.drain();
      expect(events).toHaveLength(1);
      appendFileSync(observer.env.ROX_RUNTIME_OBSERVATION_PATH!, 'x'.repeat(524289));
      observer.drain();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain('exceeded limit');
    } finally { observer.dispose(); rmSync(root, { recursive: true, force: true }); }
  });

  it('bounds captured context and marks the actual loss', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const previous = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
    const events: OmpRuntimeObservation[] = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => events.push(event), () => {});
    try {
      Object.assign(process.env, observer.env);
      observer.beginRun('current-turn');
      const hooks = new Map<string, Function>();
      (await import(observer.extensionPath)).default({ on: (name: string, fn: Function) => hooks.set(name, fn), getActiveTools: () => [], getAllTools: () => [], getThinkingLevel: () => 'high' });
      hooks.get('before_agent_start')!({ prompt: 'x'.repeat(90000), systemPrompt: [] }, {
        agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, sessionManager: { getSessionId: () => 'root' }, cwd: '/fixture', getContextUsage: () => undefined,
      });
      observer.drain();
      expect(events[0]!.truncated).toBe(true);
      expect((events[0]!.payload.prompt as string).length).toBe(32768);
    } finally {
      observer.dispose();
      if (previous.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previous.path;
      if (previous.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previous.control;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds delayed descendant starts to their actual native spawn reservation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const previous = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
    const events: OmpRuntimeObservation[] = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => events.push(event), () => {});
    try {
      Object.assign(process.env, observer.env);
      observer.beginRun('originating-run');
      const factory = (await import(observer.extensionPath)).default;
      const parentHooks = new Map<string, Function>();
      const childHooks = new Map<string, Function>();
      const api = (hooks: Map<string, Function>) => ({ on: (name: string, handler: Function) => hooks.set(name, handler),
        getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read' }, { name: 'hidden-tool' }], getThinkingLevel: () => 'high' });
      factory(api(parentHooks)); factory(api(childHooks));
      const parent = { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, sessionManager: { getSessionId: () => 'parent-session' }, cwd: '/fixture', getContextUsage: () => undefined };
      const child = { ...parent, agent: { kind: 'sub', id: 'reserved-child', name: 'child', depth: 1, parentId: 'Main' } };
      parentHooks.get('before_agent_start')!({ prompt: 'parent', systemPrompt: [] }, parent);
      parentHooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'reserved-child' }, parent);
      observer.beginRun('next-user-run');
      childHooks.get('before_agent_start')!({ prompt: 'delayed actual child', systemPrompt: [] }, child);
      observer.drain();
      expect(events.at(-1)?.runId).toBe('originating-run');
      expect(events.at(-1)?.payload.toolDefinitions).toEqual([{ name: 'read' }]);
    } finally {
      observer.dispose();
      if (previous.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previous.path;
      if (previous.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previous.control;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds generated child ids to a unique actual-parent reservation and refuses ambiguous cross-turn starts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const previous = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
    const events: OmpRuntimeObservation[] = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => events.push(event), () => {});
    try {
      Object.assign(process.env, observer.env);
      observer.beginRun('originating-run');
      const factory = (await import(observer.extensionPath)).default;
      const parentHooks = new Map<string, Function>();
      const childHooks = new Map<string, Function>();
      const api = (hooks: Map<string, Function>) => ({ on: (name: string, handler: Function) => hooks.set(name, handler),
        getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read' }, { name: 'hidden-tool' }], getThinkingLevel: () => 'high' });
      factory(api(parentHooks)); factory(api(childHooks));
      const parent = { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, sessionManager: { getSessionId: () => 'parent-session' }, cwd: '/fixture', getContextUsage: () => undefined };
      const child = { ...parent, agent: { kind: 'sub', id: 'GeneratedNativeChild', name: 'child', depth: 1, parentId: 'Main' } };
      parentHooks.get('before_agent_start')!({ prompt: 'parent', systemPrompt: [] }, parent);
      parentHooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'parent-call-A:0' }, parent);
      observer.beginRun('next-user-run');
      childHooks.get('before_agent_start')!({ prompt: 'delayed actual child', systemPrompt: [] }, child);
      observer.drain();
      expect(events.at(-1)?.runId).toBe('originating-run');
      expect(events.at(-1)?.payload.toolDefinitions).toEqual([{ name: 'read' }]);
      parentHooks.get('before_agent_start')!({ prompt: 'next parent', systemPrompt: [] }, parent);
      parentHooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'parent-call-B:0' }, parent);
      const beforeAmbiguous = events.length;
      observer.drain();
      const afterParent = events.length;
      const previousStderr = process.stderr.write;
      const diagnostics: string[] = [];
      process.stderr.write = ((value: string) => { diagnostics.push(value); return true; }) as typeof process.stderr.write;
      try {
        childHooks.get('before_agent_start')!({ prompt: 'ambiguous child', systemPrompt: [] }, { ...child, agent: { ...child.agent, id: 'UnboundNewId' } });
        childHooks.get('tool_execution_start')!({ toolCallId: 'unbound', toolName: 'read', args: {} }, child);
      } finally { process.stderr.write = previousStderr; }
      observer.drain();
      expect(events.length).toBe(afterParent);
      expect(afterParent).toBeGreaterThan(beforeAmbiguous);
      expect(diagnostics.join('')).toContain('cannot bind native child');
      // Actual task-result identity closes A, leaving only B's dispatch.
      parentHooks.get('tool_execution_end')!({ toolCallId: 'parent-call-A', toolName: 'task', result: { details: { results: [{ index: 0, id: 'GeneratedNativeChild' }] } } }, parent);
      childHooks.get('before_agent_start')!({ prompt: 'new child B', systemPrompt: [] }, { ...child, agent: { ...child.agent, id: 'NewNativeChildB' } });
      observer.drain();
      expect(events.at(-1)?.runId).toBe('next-user-run');
    } finally {
      observer.dispose();
      if (previous.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previous.path;
      if (previous.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previous.control;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds actual native lifecycle ids and parent tool calls for synchronous and renamed tasks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-observation-'));
    const previous = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
    const raw: OmpRuntimeObservation[] = [];
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('original-dispatch', 'parent request');
    const observations: ReturnType<OmpRuntimeTraceBridge['map']> = [];
    const observer = new OmpRuntimeObserver(join(root, 'observer'), event => { raw.push(event); observations.push(...bridge.map(event)); }, () => {});
    try {
      Object.assign(process.env, observer.env);
      observer.beginRun('original-dispatch');
      const listeners: Function[] = [];
      const factory = (await import(observer.extensionPath)).default;
      const hooks = new Map<string, Function>();
      const childHooks = new Map<string, Function>();
      const api = (handlers: Map<string, Function>) => ({ on: (name: string, handler: Function) => handlers.set(name, handler),
        events: { on: (channel: string, listener: Function) => { if (channel === 'task:subagent:lifecycle') listeners.push(listener); return () => {}; } },
        getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read' }], getThinkingLevel: () => 'high' });
      factory(api(hooks)); factory(api(childHooks));
      const parent = { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, sessionManager: { getSessionId: () => 'native-parent' }, cwd: '/fixture', getContextUsage: () => undefined };
      const child = (id: string) => ({ ...parent, agent: { kind: 'sub', id, name: 'worker', depth: 1, parentId: 'Main' }, sessionManager: { getSessionId: () => `native-${id}` } });
      hooks.get('before_agent_start')!({ prompt: 'parent', systemPrompt: [] }, parent);
      hooks.get('tool_execution_start')!({ toolName: 'task', toolCallId: 'actual-parent-call', args: {} }, parent);
      hooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'actual-parent-call:0' }, parent);
      observer.beginRun('new-user-control');
      for (const listener of listeners) listener({ status: 'started', id: 'NativeAllocatedId', parentToolCallId: 'actual-parent-call', index: 0 });
      childHooks.get('before_agent_start')!({ prompt: 'actual child assignment', systemPrompt: [] }, child('NativeAllocatedId'));
      // A named synchronous task gets a uniqueness suffix after spawn hook.
      hooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey: 'requested-label' }, parent);
      for (const listener of listeners) listener({ status: 'started', id: 'requested-label-2', parentToolCallId: 'actual-parent-call', index: 1 });
      childHooks.get('before_agent_start')!({ prompt: 'actual renamed task', systemPrompt: [] }, child('requested-label-2'));
      observer.drain();
      const identities = raw.filter(event => event.hook === 'subagent_identity');
      expect(identities.map(event => event.payload.id)).toEqual(['NativeAllocatedId', 'requested-label-2']);
      expect(identities.every(event => event.runId === 'original-dispatch')).toBe(true);
      const assignments = observations.filter(event => event.kind === 'agent.assigned');
      expect(assignments.map(event => event.agentId)).toEqual(['NativeAllocatedId', 'requested-label-2']);
      expect(assignments.every(event => event.kind === 'agent.assigned' && event.payload.assignment.nativeKind === 'task' && event.parentSpanId === 'tool:actual-parent-call')).toBe(true);
    } finally {
      observer.dispose();
      if (previous.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previous.path;
      if (previous.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previous.control;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it('refuses late lifecycle and result bindings after the same parent dispatch receipt is reused across runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-observer-custody-'));
  const previous = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
  const events: OmpRuntimeObservation[] = [];
  const observer = new OmpRuntimeObserver(join(root, 'observer'), event => events.push(event), () => {});
  const stderr = process.stderr.write;
  const diagnostics: string[] = [];
  try {
    Object.assign(process.env, observer.env);
    process.stderr.write = ((value: string) => { diagnostics.push(value); return true; }) as typeof process.stderr.write;
    const factory = (await import(observer.extensionPath)).default;
    const parentHooks = new Map<string, Function>();
    const childHooks = new Map<string, Function>();
    const listeners: Function[] = [];
    const api = (hooks: Map<string, Function>) => ({ on: (name: string, handler: Function) => hooks.set(name, handler),
      events: { on: (name: string, handler: Function) => { if (name === 'task:subagent:lifecycle') listeners.push(handler); } },
      getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read' }], getThinkingLevel: () => 'high' });
    factory(api(parentHooks)); factory(api(childHooks));
    const parent = { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, sessionManager: { getSessionId: () => 'native-parent' }, cwd: '/fixture', getContextUsage: () => undefined };
    const child = (id: string) => ({ ...parent, agent: { kind: 'sub', id, name: 'worker', depth: 1, parentId: 'Main' }, sessionManager: { getSessionId: () => `native-${id}` } });
    const dispatch = (run: string, call: string, spawnKey: string) => {
      observer.beginRun(run);
      parentHooks.get('before_agent_start')!({ prompt: run, systemPrompt: [] }, parent);
      parentHooks.get('tool_execution_start')!({ toolName: 'task', toolCallId: call, args: {} }, parent);
      parentHooks.get('before_subagent_spawn')!({ invocationKind: 'task', spawnKey }, parent);
    };
    dispatch('original-run', 'reused-call', 'reused-call:0');
    dispatch('successor-run', 'reused-call', 'reused-call:0');
    for (const listener of listeners) listener({ status: 'started', id: 'LateOriginalChild', parentToolCallId: 'reused-call', index: 0 });
    childHooks.get('before_agent_start')!({ prompt: 'late original child', systemPrompt: [] }, child('LateOriginalChild'));
    parentHooks.get('tool_execution_end')!({ toolCallId: 'reused-call', toolName: 'task', result: { details: { results: [{ index: 0, id: 'LateResultChild' }] } } }, parent);
    childHooks.get('before_agent_start')!({ prompt: 'late original result child', systemPrompt: [] }, child('LateResultChild'));
    dispatch('successor-run', 'fresh-call', 'fresh-call:0');
    childHooks.get('before_agent_start')!({ prompt: 'late child after reused reservation closes', systemPrompt: [] }, child('LateChildAfterClosure'));

    // Renamed task actors have no exact spawn-key lookup; the genuine parent
    // call fallback must also refuse a call receipt reused by another run.
    dispatch('renamed-original-run', 'reused-renamed-call', 'requested-label-A');
    dispatch('renamed-successor-run', 'reused-renamed-call', 'requested-label-B');
    for (const listener of listeners) listener({ status: 'started', id: 'requested-label-A-2', parentToolCallId: 'reused-renamed-call', index: 0 });
    childHooks.get('before_agent_start')!({ prompt: 'late renamed child', systemPrompt: [] }, child('requested-label-A-2'));
    observer.drain();
    expect(events.filter(event => event.hook === 'subagent_identity')).toHaveLength(0);
    expect(events.filter(event => event.agent.kind === 'sub')).toHaveLength(0);
    expect(diagnostics.join('')).toContain('cannot bind native child');
    for (const listener of listeners) listener({ status: 'started', id: 'FreshProvenChild', parentToolCallId: 'fresh-call', index: 0 });
    childHooks.get('before_agent_start')!({ prompt: 'fresh child with exact native receipt', systemPrompt: [] }, child('FreshProvenChild'));
    observer.drain();
    expect(events.filter(event => event.hook === 'subagent_identity').map(event => event.payload.id)).toEqual(['FreshProvenChild']);
    expect(events.filter(event => event.agent.kind === 'sub').map(event => event.agent.id)).toEqual(['FreshProvenChild']);
    expect(events.at(-1)?.runId).toBe('successor-run');
  } finally {
    process.stderr.write = stderr;
    observer.dispose();
    if (previous.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previous.path;
    if (previous.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previous.control;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('OMP typed native runtime bridge', () => {
  it('uses actual child identities and exact delivered prompt, with unknown/estimated measurements', () => {
    const bridge = new OmpRuntimeTraceBridge();
    bridge.beginRun('current-turn', 'Original ROX request');
    bridge.map(native('before_subagent_spawn', { invocationKind: 'task', spawnKey: 'Child' }, { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 } }));
    const events = bridge.map(native('before_agent_start', { prompt: 'Actual delivered child assignment', systemPrompt: ['child restrictions'], tools: ['read', 'yield'], contextUsage: { tokens: 25 } }));
    const assignment = events.find(event => event.kind === 'agent.assigned');
    expect(assignment?.kind).toBe('agent.assigned');
    if (assignment?.kind !== 'agent.assigned') throw new Error('Missing assignment');
    expect(assignment.agentId).toBe('Child');
    expect(assignment.parentAgentId).toBe('root');
    expect(assignment.payload.assignment.nativeKind).toBe('task');
    expect(assignment.payload.assignment.prompt.text).toBe('Actual delivered child assignment');
    expect(assignment.payload.assignment.tools).toEqual(['read', 'yield']);
    const context = events.find(event => event.kind === 'context.captured');
    if (context?.kind !== 'context.captured') throw new Error('Missing context');
    expect(context.payload.snapshot.inputTokens).toMatchObject({ state: 'known', value: 25, origin: 'estimated' });
    expect(context.payload.snapshot.coverage.state).toBe('partial');
    expect(context.payload.snapshot.blocks[0]?.content.tokens).toEqual({ state: 'unknown', reason: 'not-emitted' });
  });

  it('uses the actual registry parent when mirrored native buses reuse a provider tool id', () => {
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('current-turn', 'request');
    bridge.map(native('subagent_identity', { id: 'Grandchild', invocationKind: 'task', parentToolCallId: 'same-provider-call', index: 0 }, { agent: { kind: 'main', id: 'Main', name: 'main', depth: 0 }, nativeSessionId: 'root-native' }));
    bridge.map(native('subagent_identity', { id: 'Grandchild', invocationKind: 'task', parentToolCallId: 'same-provider-call', index: 0 }, { agent: { kind: 'sub', id: 'ActualParent', name: 'parent', depth: 1, parentId: 'Main' }, nativeSessionId: 'actual-parent-native' }));
    const events = bridge.map(native('before_agent_start', { prompt: 'actual grandchild', systemPrompt: [], tools: ['read', 'yield'] }, { agent: { kind: 'sub', id: 'Grandchild', name: 'grandchild', depth: 2, parentId: 'ActualParent' }, nativeSessionId: 'grandchild-native' }));
    const assignment = events.find(event => event.kind === 'agent.assigned');
    expect(assignment?.parentAgentId).toBe('ActualParent');
    expect(assignment?.parentSpanId).toBe('native:actual-parent-native:tool:same-provider-call');
  });

  it('does not duplicate root tool/reasoning/usage and drops stale cancelled turns', () => {
    const bridge = new OmpRuntimeTraceBridge();
    bridge.beginRun('current-turn', 'request');
    const main = { kind: 'main' as const, id: 'Main', name: 'main', depth: 0 };
    expect(bridge.map(native('tool_execution_start', { toolName: 'read', toolCallId: 'tc', args: {} }, { agent: main }))).toEqual([]);
    expect(bridge.map(native('message_update', { assistantMessageEvent: { type: 'thinking_delta', delta: 'public provider text' } }, { agent: main }))).toEqual([]);
    expect(bridge.map(native('message_end', { message: { role: 'assistant', usage: { input: 20, output: 5 } } }, { agent: main }))).toEqual([]);
    expect(bridge.map(native('agent_start', {}, { runId: 'old-turn' }))).toEqual([]);
  });

  it('keeps child terminal identity and does not invent zero exit code or separated streams', () => {
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('current-turn', 'request');
    const start = bridge.map(native('tool_execution_start', { toolName: 'bash', toolCallId: 'real-tc', args: { command: 'echo fixture' } }));
    const end = bridge.map(native('tool_execution_end', { toolName: 'bash', toolCallId: 'real-tc', result: { content: [{ type: 'text', text: 'combined native output' }], details: {} }, isError: false }));
    const terminalStart = start.find(event => event.kind === 'terminal.started');
    const terminalEnd = end.find(event => event.kind === 'terminal.completed');
    expect(terminalStart?.spanId).toBe(terminalEnd?.spanId);
    if (terminalEnd?.kind !== 'terminal.completed') throw new Error('Missing terminal');
    expect(terminalEnd.toolUseId).toBe('real-tc');
    expect(terminalEnd.payload.command).toBe('echo fixture');
    expect(terminalEnd.payload.exitCode).toEqual({ state: 'unknown', reason: 'not-emitted' });
    expect(terminalEnd.payload.stdout).toBeUndefined();
    expect(terminalEnd.payload.stderr).toBeUndefined();
  });

  it('publishes only committed structured todo authority state, preserves blocked and immutable versions', () => {
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('current-turn', 'request');
    const phases = [{ name: 'Phase', tasks: [{ content: 'A', status: 'blocked', blocker: 'input unavailable' }] }];
    const event = native('tool_execution_end', { toolName: 'todo', toolCallId: 'tc', isError: false, result: { details: { op: 'block', phases } } });
    const first = bridge.map(event);
    const published = first.find(value => value.kind === 'plan.published');
    if (published?.kind !== 'plan.published') throw new Error('Missing plan');
    expect(published.payload.plan.version).toBe(1);
    expect(published.payload.plan.tasks[0]?.status).toBe('blocked');
    expect(bridge.map(event)).toEqual([]);
    const revised = bridge.map({ ...event, id: 'second', sourceSeq: event.sourceSeq + 1 }).find(value => value.kind === 'plan.revised');
    if (revised?.kind !== 'plan.revised') throw new Error('Missing revision');
    expect(revised.payload.plan.version).toBe(2);
    expect(published.payload.plan.version).toBe(1);
    expect(bridge.map({ ...event, sourceSeq: event.sourceSeq + 2, payload: { ...event.payload, result: { details: { op: 'view', phases } } } }).some(value => value.kind === 'plan.revised')).toBe(false);
  });

  it('marks cumulative native reasoning snapshots and read-confirmed skills explicitly', () => {
    const bridge = new OmpRuntimeTraceBridge();
    bridge.beginRun('current-turn', 'request', new Map([['fixture-skill', '/fixture/skill/SKILL.md']]));
    const first = bridge.map(native('message_update', { assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'one' } }));
    const second = bridge.map(native('message_update', { assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'two' } }));
    const reasoning = second.find(event => event.kind === 'reasoning.output');
    if (reasoning?.kind !== 'reasoning.output') throw new Error('Missing reasoning');
    expect(reasoning.payload.content.text).toBe('onetwo');
    expect(reasoning.payload.content.isDelta).toBe(false);
    expect(first[0]?.sourceEventId).not.toBe(second[0]?.sourceEventId);
    const main = { kind: 'main' as const, id: 'Main', name: 'main', depth: 0 };
    bridge.map(native('tool_execution_start', { toolName: 'read', toolCallId: 'skill-read', args: { path: '/fixture/skill/SKILL.md' } }, { agent: main }));
    const read = bridge.map(native('tool_execution_end', { toolName: 'read', toolCallId: 'skill-read', result: { content: [{ type: 'text', text: 'Skill body actually returned to model' }] }, isError: false }, { agent: main }));
    const loaded = read.find(event => event.kind === 'skill.loaded');
    if (loaded?.kind !== 'skill.loaded') throw new Error('Missing skill loaded');
    expect(loaded.payload.capability.id).toBe('fixture-skill');
    expect(loaded.payload.content?.text).toBe('Skill body actually returned to model');
    expect(read.some(event => event.kind === 'skill.applied')).toBe(false);
  });

  it('retains a single OMP user stream through native scheduled continuations', () => {
    const fake = createFakeOmp();
    const agent = new OmpAgent(makeOmpConfig(fake));
    const internals = agent as unknown as { handleAgentEnd: (message: Record<string, unknown>) => void; eventQueue: { isComplete: boolean } };
    try {
      internals.handleAgentEnd({ type: 'agent_end', willContinue: true, messages: [] });
      expect(internals.eventQueue.isComplete).toBe(false);
      internals.handleAgentEnd({ type: 'agent_end', messages: [] });
      expect(internals.eventQueue.isComplete).toBe(true);
    } finally { agent.destroy(); fake.cleanup(); }
  });

  it('keeps original user text apart from actual BaseAgent skill-read directives', async () => {
    const fake = createFakeOmp();
    const restore = useFakeOmpEnv(fake);
    const skillRoot = join(fake.workspaceRoot, 'skills', 'fixture-skill');
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, 'SKILL.md'), '---\nname: Fixture skill\ndescription: Fixture instructions\n---\nRead only.\n');
    const agent = new OmpAgent(makeOmpConfig(fake));
    let capturedOriginal: string | undefined;
    const internals = agent as unknown as { runtimeTraceBridge: OmpRuntimeTraceBridge };
    const actualBegin = internals.runtimeTraceBridge.beginRun.bind(internals.runtimeTraceBridge);
    internals.runtimeTraceBridge.beginRun = (runId, original, skills) => { capturedOriginal = original; actualBegin(runId, original, skills); };
    try {
      const raw = 'Use [skill:fixture-skill] on this request';
      const events = await chatEvents(agent, raw, 8000);
      expect(capturedOriginal).toBe(raw);
      expect(fake.readRpcLog().find(frame => frame.type === 'prompt')?.message).toContain('MUST read the following skill instruction files');
      expect(events.some(event => event.type === 'runtime_observation' && event.observation.kind === 'skill.selected')).toBe(true);
      expect(events.some(event => event.type === 'runtime_observation' && event.observation.kind === 'skill.loaded')).toBe(false);
    } finally { agent.destroy(); restore(); fake.cleanup(); }
  });

  it('reports a native emitter sequence gap without calling it a root journal gap', () => {
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('current-turn', 'request');
    const first = native('agent_start', {}, { sourceSeq: 1 });
    bridge.map(first);
    const events = bridge.map({ ...first, id: 'later-frame', sourceSeq: 3 });
    const coverage = events.find(event => event.kind === 'trace.coverage');
    if (coverage?.kind !== 'trace.coverage') throw new Error('Missing coverage');
    expect(coverage.payload.coverage.missing).toContain('native-source-gap');
    expect(events.some(event => event.kind === 'trace.gap')).toBe(false);
  });

  it('preserves actual native fallback readback and its explicit decision evidence', () => {
    const bridge = new OmpRuntimeTraceBridge(); bridge.beginRun('current-turn', 'request');
    const evidence = { from: 'fixture/primary', to: 'fallback/worker', role: 'task', reason: 'Native request rejected; configured fallback selected.' };
    const events = bridge.map(native('retry_fallback_applied', evidence, { model: { provider: 'fallback', id: 'worker' } }));
    const changed = events.find(event => event.kind === 'model.changed');
    if (changed?.kind !== 'model.changed') throw new Error('Missing actual fallback model readback');
    expect(changed.payload.model.confirmed).toMatchObject({ state: 'known', value: 'fallback/worker', origin: 'observed' });
    const decision = events.find(event => event.kind === 'decision.recorded');
    if (decision?.kind !== 'decision.recorded') throw new Error('Missing explicit native decision');
    expect(decision.payload.provenance).toBe('explicit');
    expect(JSON.parse(decision.payload.content.text!)).toEqual(evidence);
  });

  it('forwards native host toolCallId without substituting the RPC frame id', async () => {
    const fake = createFakeOmp();
    const agent = new OmpAgent(makeOmpConfig(fake));
    const internals = agent as unknown as {
      handleHostToolCall: (frame: Record<string, unknown>) => void;
      executeHostToolCall: (frameId: string, name: string, args: Record<string, unknown>, toolCallId?: string) => Promise<void>;
    };
    let received: unknown[] | undefined;
    internals.executeHostToolCall = async (...args) => { received = args; };
    try {
      internals.handleHostToolCall({ id: 'rpc-frame', toolCallId: 'native-provider-call', toolName: 'bash', arguments: { command: 'echo fixture' } });
      expect(received).toEqual(['rpc-frame', 'bash', { command: 'echo fixture' }, 'native-provider-call']);
    } finally { agent.destroy(); fake.cleanup(); }
  });

  it('delivers actual host stdout/stderr and rejects late evidence from an older run', async () => {
    const fake = createFakeOmp();
    const agent = new OmpAgent(makeOmpConfig(fake));
    const internals = agent as unknown as {
      _isProcessing: boolean; runtimeObservationRunId: string;
      createHostBashObserver: (toolCallId: string, generation: string, active: () => boolean) => (evidence: HostBashObservation) => void;
      getSessionToolContext: () => SessionToolContext;
      executeHostSessionTool: (name: string, args: Record<string, unknown>, observer?: (evidence: HostBashObservation) => void) => Promise<{ content: string; isError: boolean }>;
      eventQueue: { enqueue: (event: AgentEvent) => void; isComplete: boolean };
    };
    const events: AgentEvent[] = [];
    let actualSidecarCalls = 0;
    setHostBashPort(async () => { actualSidecarCalls++; throw new Error('env-less fixture sidecar must be bypassed'); });
    internals._isProcessing = true;
    internals.runtimeObservationRunId = 'originating-run';
    internals.eventQueue.enqueue = event => events.push(event);
    const observer = internals.createHostBashObserver('exact-provider-tool-id', 'originating-run', () => true);
    const cached = internals.getSessionToolContext();
    try {
      expect(typeof cached.getHostBashEnv).toBe('function');
      const result = await internals.executeHostSessionTool('bash', { command: "printf 'actual-out'; printf 'actual-err' >&2; exit 7" }, observer);
      expect(actualSidecarCalls).toBe(0);
      expect(result.isError).toBe(true);
      expect(cached.hostBashObserver).toBeUndefined();
      const observations = events.flatMap(event => event.type === 'runtime_observation' ? [event.observation] : []);
      expect(observations[0]?.kind).toBe('terminal.started');
      expect(observations.every(event => event.toolUseId === 'exact-provider-tool-id')).toBe(true);
      expect(observations.every(event => event.attemptId === undefined)).toBe(true);
      const final = observations.at(-1)!;
      if (final.kind !== 'terminal.completed') throw new Error('Missing real host command completion');
      expect(final.payload).toMatchObject({ stdout: { text: 'actual-out', isDelta: false }, stderr: { text: 'actual-err', isDelta: false }, exitCode: { state: 'known', value: 7 }, durationMs: { state: 'known' }, timedOut: false, execution: 'local', status: 'failed' });
      expect(final.elapsedMs).toBeGreaterThanOrEqual(0);
      const captured = events.length;
      internals.runtimeObservationRunId = 'new-user-run';
      observer({ phase: 'completed', execution: 'local', command: 'old', cwd: fake.workspaceRoot,
        occurredAt: Date.now(), monotonicMs: performance.now(), result: { stdout: 'late', stderr: '', exitCode: 0, timedOut: false, cwd: fake.workspaceRoot, durationMs: 1 } });
      expect(events).toHaveLength(captured);
    } finally { setHostBashPort(null); internals._isProcessing = false; agent.destroy(); fake.cleanup(); }
  });

  it('creates a new attempt only for an actually started legacy-port fallback without a managed environment', async () => {
    const fake = createFakeOmp();
    const agent = new OmpAgent(makeOmpConfig(fake));
    const internals = agent as unknown as {
      _isProcessing: boolean; runtimeObservationRunId: string;
      getSessionToolContext: () => SessionToolContext;
      createHostBashObserver: (toolCallId: string, generation: string, active: () => boolean) => (evidence: HostBashObservation) => void;
      executeHostSessionTool: (name: string, args: Record<string, unknown>, observer?: (evidence: HostBashObservation) => void) => Promise<{ content: string; isError: boolean }>;
      eventQueue: { enqueue: (event: AgentEvent) => void };
    };
    const events: AgentEvent[] = [];
    // The optional legacy port cannot carry the production managed environment.
    // This fixture exercises that supported port explicitly; the previous case
    // retains the actual managed-context local execution and stdout/stderr proof.
    const currentContext = internals.getSessionToolContext.bind(agent);
    internals.getSessionToolContext = () => ({ ...currentContext(), getHostBashEnv: undefined });
    let actualSidecarCalls = 0;
    setHostBashPort(async () => { actualSidecarCalls++; throw new Error('fixture sidecar unavailable'); });
    internals._isProcessing = true;
    internals.runtimeObservationRunId = 'actual-fallback-run';
    internals.eventQueue.enqueue = event => events.push(event);
    try {
      const actualContext = internals.getSessionToolContext();
      expect(typeof actualContext.getHostBashEnv).toBe('function');
      // The optional legacy port cannot accept managed per-call environments.
      // Clone only this fixture caller; the production cached context is intact.
      internals.getSessionToolContext = () => ({ ...actualContext, getHostBashEnv: undefined });
      const observer = internals.createHostBashObserver('same-native-tool-id', 'actual-fallback-run', () => true);
      const result = await internals.executeHostSessionTool('bash', { command: "printf 'local-fallback-output'" }, observer);
      expect(actualSidecarCalls).toBe(1);
      expect(result.isError).toBe(false);
      const observations = events.flatMap(event => event.type === 'runtime_observation' ? [event.observation] : []);
      const sidecar = observations.filter(event => event.kind.startsWith('terminal.') && 'execution' in event.payload && event.payload.execution === 'sidecar');
      const local = observations.filter(event => event.kind.startsWith('terminal.') && 'execution' in event.payload && event.payload.execution === 'local');
      expect(sidecar.map(event => event.kind)).toEqual(['terminal.started', 'terminal.completed']);
      expect(sidecar.every(event => event.attemptId === undefined)).toBe(true);
      expect(local[0]?.kind).toBe('terminal.started');
      expect(local.at(-1)?.kind).toBe('terminal.completed');
      expect(local[0]?.attemptId).toBe('same-native-tool-id:local:2');
      expect(local.every(event => event.attemptId === local[0]?.attemptId)).toBe(true);
      expect(observations.every(event => event.toolUseId === 'same-native-tool-id' && event.spanId === 'tool:same-native-tool-id')).toBe(true);
      const completed = local.at(-1)!;
      if (completed.kind !== 'terminal.completed') throw new Error('Missing actual fallback completion');
      expect(completed.payload).toMatchObject({ status: 'succeeded', stdout: { text: 'local-fallback-output', isDelta: false }, exitCode: { state: 'known', value: 0 } });
    } finally { setHostBashPort(null); internals._isProcessing = false; agent.destroy(); fake.cleanup(); }
  });
});
