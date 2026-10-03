import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OmpAgent } from '../omp-agent.ts';
import { ompStateHasModel, resolveVerifiedOmpModelTarget } from '../omp-model-selection.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

let fake: FakeOmp | undefined;
let restore: (() => void) | undefined;
let agent: OmpAgent | undefined;

function setup(scenario: string, model = 'rox/standard') {
  fake = createFakeOmp(scenario);
  restore = useFakeOmpEnv(fake);
  agent = new OmpAgent(makeOmpConfig(fake, { model }));
  return { agent, fake };
}

async function waitForRpcFrame(fake: FakeOmp, predicate: (frame: Record<string, unknown>) => boolean) {
  const deadline = Date.now() + Math.max(2_000, Number(process.env.ROX_OMP_TEST_TIMEOUT_MS) || 0);
  while (Date.now() < deadline) {
    const frame = fake.readRpcLog().find(predicate);
    if (frame) return frame;
    await Bun.sleep(10);
  }
  throw new Error('Expected fake OMP RPC frame did not arrive');
}

afterEach(() => {
  agent?.destroy();
  restore?.();
  fake?.cleanup();
  agent = undefined;
  fake = undefined;
  restore = undefined;
});

describe('OMP requested model before provider execution', () => {
  it('pins and reads back the requested model before the first prompt', async () => {
    const { agent, fake } = setup('model-public');
    const events = await chatEvents(agent, 'QA model selection', 8_000);
    expect(events.some(e => e.type === 'text_complete')).toBe(true);
    const frames = fake.readRpcLog();
    const selection = frames.findIndex(f => f.type === 'set_model');
    const prompt = frames.findIndex(f => f.type === 'prompt');
    expect(selection).toBeGreaterThanOrEqual(0);
    expect(selection).toBeLessThan(prompt);
    expect(frames.slice(selection + 1, prompt).some(f => f.type === 'get_state')).toBe(true);
    expect(frames[prompt]?.observedModel).toEqual({ provider: 'rox', id: 'standard' });
  });

  it('pins again after a real child respawn instead of inheriting its default', async () => {
    const { agent, fake } = setup('model-public');
    await chatEvents(agent, 'first turn', 8_000);
    await agent.reconnect();
    await chatEvents(agent, 'after reconnect', 8_000);
    expect(fake.readArgvLog()).toHaveLength(2);
    expect(fake.readRpcLog().filter(f => f.type === 'set_model')).toHaveLength(2);
    expect(fake.readRpcLog().filter(f => f.type === 'prompt').map(f => f.observedModel))
      .toEqual([{ provider: 'rox', id: 'standard' }, { provider: 'rox', id: 'standard' }]);
  });

  for (const scenario of ['model-reject', 'model-wrong-readback', 'model-missing-readback', 'model-legacy-catalog']) {
    it(`does not execute a prompt when the model cannot be verified: ${scenario}`, async () => {
      const { agent, fake } = setup(scenario);
      const events = await chatEvents(agent, 'must not reach another provider', 8_000);
      expect(fake.readRpcLog().filter(f => f.type === 'prompt')).toHaveLength(0);
      expect(events.some(e => e.type === 'error')).toBe(true);
      expect(events.some(e => e.type === 'text_complete')).toBe(false);
      expect(events.at(-1)?.type).toBe('complete');
      expect(agent.isProcessing()).toBe(false);
    });
  }

  for (const model of ['rox/not-kimi-k2', 'rox/invalid-kimi-k3']) {
    it(`does not execute an unknown qualified model sharing a catalog suffix: ${model}`, async () => {
      const { agent, fake } = setup('model-public', model);
      const events = await chatEvents(agent, 'invalid exact model must not execute', 8_000);
      expect(fake.readRpcLog().filter((frame) => frame.type === 'prompt')).toHaveLength(0);
      expect(events.some((event) => event.type === 'error')).toBe(true);
      expect(events.some((event) => event.type === 'text_complete')).toBe(false);
      expect(events.at(-1)?.type).toBe('complete');
    });
  }

  it('verifies a runtime model update before the next prompt', async () => {
    const { agent, fake } = setup('model-public');
    await chatEvents(agent, 'first turn', 8_000);
    await agent.updateRuntimeConfig({ model: 'rox/kimi-k2' });
    await chatEvents(agent, 'updated turn', 8_000);
    expect(fake.readRpcLog().filter((frame) => frame.type === 'prompt').map((frame) => frame.observedModel))
      .toEqual([{ provider: 'rox', id: 'standard' }, { provider: 'rox', id: 'kimi-k2' }]);
  });

  it('uses the latest runtime update arriving during the initial model pin', async () => {
    const { agent, fake } = setup('model-delayed');
    const eventsPending = chatEvents(agent, 'first turn with delayed selection', 8_000);
    await waitForRpcFrame(fake, (frame) => frame.type === 'set_model');
    const updatePending = agent.updateRuntimeConfig({ model: 'rox/kimi-k2' });
    const [events] = await Promise.all([eventsPending, updatePending]);
    expect(events.some((event) => event.type === 'text_complete')).toBe(true);
    const prompts = fake.readRpcLog().filter((frame) => frame.type === 'prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.observedModel).toEqual({ provider: 'rox', id: 'kimi-k2' });
  });

  it('recovers from a rejected selection on a new child without a poisoned queue', async () => {
    const { agent, fake } = setup('model-reject');
    expect((await chatEvents(agent, 'rejected turn', 8_000))
      .some((event) => event.type === 'error')).toBe(true);
    fake.setScenario('model-public');
    await agent.reconnect();
    expect((await chatEvents(agent, 'retry on a fresh child', 8_000))
      .some((event) => event.type === 'text_complete')).toBe(true);
    const prompts = fake.readRpcLog().filter((frame) => frame.type === 'prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.observedModel).toEqual({ provider: 'rox', id: 'standard' });
  });

  it('handles an asynchronous stale stdin EPIPE during teardown', async () => {
    const { agent } = setup('model-public');
    await chatEvents(agent, 'first turn', 8_000);
    const child = (agent as any).subprocess;
    await agent.reconnect();
    const pipeError = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    expect(() => child.stdin.emit('error', pipeError)).not.toThrow();
    expect((await chatEvents(agent, 'after stale pipe error', 8_000))
      .some((event) => event.type === 'text_complete')).toBe(true);
  });

  it('pins after branch restoration, which can restore a different model', async () => {
    const { agent, fake } = setup('model-branch');
    const parentSessionPath = join(fake.workspaceRoot, 'sessions', 'parent');
    const parentDir = join(parentSessionPath, 'omp');
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, '2026-09-30_parent.jsonl'), [
      { type:'session', version:3, id:'parent-omp', cwd:fake.workspaceRoot },
      { type: 'message', id: 'user1', message: { role: 'user' } },
      { type: 'message', id: 'assistant1', message: { role: 'assistant' } },
      { type: 'message', id: 'user2', message: { role: 'user' } },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    Object.assign((agent as any).config.session, {
      branchFromMessageId: 'craft-1', branchFromSessionPath: parentSessionPath,
      branchFromSdkTurnId: 'assistant1', branchFromSdkSessionId: 'parent-omp',
    });
    await chatEvents(agent, 'branch turn', 8_000);
    const frames = fake.readRpcLog();
    expect(frames.findIndex((frame) => frame.type === 'set_model'))
      .toBeGreaterThan(frames.findIndex((frame) => frame.type === 'fork'));
    expect(frames.find((frame) => frame.type === 'prompt')?.observedModel)
      .toEqual({ provider: 'rox', id: 'standard' });
  });
});

describe('OMP catalog and actual model identity', () => {
  // Generated cases cover both catalog ID shapes used by managed providers.
  for (const tier of ['explore', 'standard', 'max', 'vision', 'fast']) {
    for (const id of [tier, `rox/${tier}`]) {
      it(`keeps the actual catalog identity for rox/${tier} → ${id}`, () => {
        expect(resolveVerifiedOmpModelTarget(`rox/${tier}`, [
          { provider: 'cursor', id: tier }, { provider: 'rox', id },
        ])).toEqual({ provider: 'rox', modelId: id });
      });
    }
    it(`does not infer a rox/${tier} alias from another provider or internal model`, () => {
      expect(resolveVerifiedOmpModelTarget(`rox/${tier}`, [
        { provider: 'cursor', id: tier }, { provider: 'rox', id: 'kimi-k3' },
        { provider: 'rox', id: `other-${tier}` },
      ])).toBeNull();
    });
  }

  it('preserves legacy unqualified matching and constrains explicit providers', () => {
    expect(resolveVerifiedOmpModelTarget('kimi-K3', [{ provider: 'rox', id: 'kimi-k3' }]))
      .toEqual({ provider: 'rox', modelId: 'kimi-k3' });
    expect(resolveVerifiedOmpModelTarget('rox/kimi-k3', [{ provider: 'cursor', id: 'kimi-k3' }]))
      .toBeNull();
    for (const requested of ['rox/not-kimi-k2', 'rox/invalid-kimi-k3', 'rox/kimi-K3']) {
      expect(resolveVerifiedOmpModelTarget(requested, [
        { provider: 'rox', id: 'kimi-k2' }, { provider: 'rox', id: 'kimi-k3' },
      ])).toBeNull();
    }
    for (const id of ['kimi-k2', 'rox/kimi-k2']) {
      expect(resolveVerifiedOmpModelTarget('rox/kimi-k2', [{ provider: 'rox', id }]))
        .toEqual({ provider: 'rox', modelId: id });
    }
  });

  it('requires the provider and model in actual state, including legacy string states', () => {
    const target = { provider: 'rox', modelId: 'standard' };
    for (const state of [null, {}, { model: {} }, { model: 'standard' },
      { model: { provider: 'cursor', id: 'standard' } },
      { model: { provider: 'rox', id: 'kimi-k3' } }]) {
      expect(ompStateHasModel(state, target)).toBe(false);
    }
    expect(ompStateHasModel({ model: { provider: 'rox', id: 'standard' } }, target)).toBe(true);
    expect(ompStateHasModel({ model: 'rox/standard' }, target)).toBe(true);
  });
});
