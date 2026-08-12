/**
 * OmpAgent startup/failure lifecycle regression suite.
 *
 * P0 bug (reproduced live): when the omp subprocess exits BEFORE sending the
 * `ready` frame (e.g. a credential-less host prints "No models available…"
 * and exits 1), handleSubprocessExit nulled the ready-wait state without
 * settling it, the 20s timeout guard could never fire, and chatImpl hung
 * inside ensureSubprocess() forever — the session stayed in `processing`.
 *
 * These tests pin the complete startup outcome matrix:
 *   ready → proceed | exit → typed error | spawn error → typed error
 *   | malformed ready → protocol error | timeout → bounded typed timeout
 * Every failure path must leave the session OUT of `processing` (typed_error
 * + error + complete through the AgentEvent flow) and must be wall-clock
 * bounded (drainWithTimeout rejects on stalls).
 */
import { afterEach, describe, expect, it } from 'bun:test';
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

function setup(scenario: string): { agent: OmpAgent; fake: FakeOmp } {
  fake = createFakeOmp(scenario);
  restoreEnv = useFakeOmpEnv(fake);
  const agent = new OmpAgent(makeOmpConfig(fake));
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

function typedError(events: AgentEvent[]): Extract<AgentEvent, { type: 'typed_error' }> {
  const hit = events.find((e) => e.type === 'typed_error');
  expect(hit, `expected a typed_error event, got: ${JSON.stringify(events)}`).toBeDefined();
  return hit as Extract<AgentEvent, { type: 'typed_error' }>;
}

function expectCleanTerminal(events: AgentEvent[]): void {
  const last = events.at(-1);
  expect(last?.type).toBe('complete');
}

describe('OmpAgent startup — subprocess exits before ready', () => {
  it('yields a typed OMP_NO_MODELS error (bounded, no hang) when stderr says no models', async () => {
    const { agent } = setup('exit-no-models');

    const events = await chatEvents(agent, 'hi', 8_000);

    const typed = typedError(events);
    expect(String(typed.error.code)).toBe('OMP_NO_MODELS');
    // Actionable guidance from the captured stderr reaches the user.
    expect(typed.error.message).toMatch(/models\.yml|API key/i);
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('classifies /login stderr as OMP_AUTH_REQUIRED', async () => {
    const { agent } = setup('exit-auth');

    const events = await chatEvents(agent, 'hi', 8_000);

    expect(String(typedError(events).error.code)).toBe('OMP_AUTH_REQUIRED');
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('classifies a generic non-zero exit as OMP_START_FAILED', async () => {
    const { agent } = setup('exit-generic');

    const events = await chatEvents(agent, 'hi', 8_000);

    const typed = typedError(events);
    expect(String(typed.error.code)).toBe('OMP_START_FAILED');
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('treats a clean exit without a ready frame as OMP_PROTOCOL_ERROR', async () => {
    const { agent } = setup('exit-clean');

    const events = await chatEvents(agent, 'hi', 8_000);

    expect(String(typedError(events).error.code)).toBe('OMP_PROTOCOL_ERROR');
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('does not double-report: exactly one error event alongside the typed error', async () => {
    const { agent } = setup('exit-no-models');

    const events = await chatEvents(agent, 'hi', 8_000);

    expect(events.filter((e) => e.type === 'typed_error')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expectCleanTerminal(events);
  });
});

describe('OmpAgent startup — spawn / handshake failures', () => {
  it('yields OMP_NOT_CONFIGURED when the omp binary does not exist (ENOENT)', async () => {
    fake = createFakeOmp('healthy');
    restoreEnv = useFakeOmpEnv(fake);
    process.env.OMP_CLI_PATH = '/nonexistent/omp-binary-that-does-not-exist';
    const agent = new OmpAgent(makeOmpConfig(fake));
    agents.push(agent);

    const events = await chatEvents(agent, 'hi', 8_000);

    expect(String(typedError(events).error.code)).toBe('OMP_NOT_CONFIGURED');
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('rejects a malformed ready frame as OMP_PROTOCOL_ERROR', async () => {
    const { agent } = setup('malformed-ready');

    const events = await chatEvents(agent, 'hi', 8_000);

    expect(String(typedError(events).error.code)).toBe('OMP_PROTOCOL_ERROR');
    expectCleanTerminal(events);
    expect(agent.isProcessing()).toBe(false);
  });

  it('bounds a silent subprocess with a typed OMP_READY_TIMEOUT', async () => {
    const { agent } = setup('never-ready');

    // Shrink only the 20s ready-timeout timer; leave every other timer alone.
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      return originalSetTimeout(fn, ms === 20_000 ? 50 : ms, ...rest);
    }) as typeof setTimeout;

    try {
      const events = await chatEvents(agent, 'hi', 8_000);
      expect(String(typedError(events).error.code)).toBe('OMP_READY_TIMEOUT');
      expectCleanTerminal(events);
      expect(agent.isProcessing()).toBe(false);
    } finally {
      (globalThis as any).setTimeout = originalSetTimeout;
    }
  });
});

describe('OmpAgent startup — abort and recovery', () => {
  it('abort during startup ends the turn quietly and bounded (no error events)', async () => {
    const { agent } = setup('slow-ready');

    const eventsPromise = chatEvents(agent, 'hi', 8_000);
    await new Promise((r) => setTimeout(r, 150));
    const abortPromise = agent.abort('user stop');

    const events = await eventsPromise;
    await abortPromise;

    expect(events.some((e) => e.type === 'complete')).toBe(true);
    expect(events.some((e) => e.type === 'typed_error' || e.type === 'error')).toBe(false);
    expect(agent.isProcessing()).toBe(false);
  });

  it('a failed startup does not poison the agent: next chat() respawns cleanly', async () => {
    const { agent, fake } = setup('exit-no-models');

    const first = await chatEvents(agent, 'hi', 8_000);
    expect(String(typedError(first).error.code)).toBe('OMP_NO_MODELS');
    expect(agent.isProcessing()).toBe(false);

    fake.setScenario('healthy');
    const second = await chatEvents(agent, 'hi', 8_000);

    expect(second.some((e) => e.type === 'text_complete')).toBe(true);
    expect(second.some((e) => e.type === 'typed_error')).toBe(false);
    expectCleanTerminal(second);
    expect(agent.isProcessing()).toBe(false);
  });

  it('supports repeated subprocess lifecycles (chat → reconnect → chat)', async () => {
    const { agent } = setup('healthy');

    const first = await chatEvents(agent, 'one', 8_000);
    expect(first.some((e) => e.type === 'text_complete')).toBe(true);

    await agent.reconnect();

    const second = await chatEvents(agent, 'two', 8_000);
    expect(second.some((e) => e.type === 'text_complete')).toBe(true);
    expectCleanTerminal(second);
    expect(agent.isProcessing()).toBe(false);
  });
});
