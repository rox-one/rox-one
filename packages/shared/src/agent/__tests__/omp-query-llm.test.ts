/**
 * OmpAgent.queryLlm — model honesty contract (packages/shared/CLAUDE.md
 * §queryLlm backend contract):
 * - MUST honor request.model (backend-specific fallback only when the model
 *   is unresolvable; always report the *effective* model),
 * - MUST NOT return a fabricated LLMQueryResult.model that doesn't match what
 *   was actually used.
 *
 * The old implementation ran `omp -p` (OMP's own default model) while
 * returning `{ model: this._model }` — a fabrication. These tests pin the
 * fixed behavior against the fake omp CLI (argv log + scripted failures).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { OmpAgent } from '../omp-agent.ts';
import {
  createFakeOmp,
  useFakeOmpEnv,
  makeOmpConfig,
  type FakeOmp,
} from './omp-fake-cli.ts';

let fake: FakeOmp | null = null;
let restoreEnv: (() => void) | null = null;
const agents: OmpAgent[] = [];

function setup(scenario = 'healthy'): { agent: OmpAgent; fake: FakeOmp } {
  fake = createFakeOmp(scenario);
  restoreEnv = useFakeOmpEnv(fake);
  const agent = new OmpAgent(makeOmpConfig(fake, { model: 'kimi-K3' }));
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

describe('OmpAgent.queryLlm — model honesty', () => {
  it('passes request.model through to omp via --model and reports it as effective', async () => {
    const { agent, fake } = setup();

    const result = await agent.queryLlm({ prompt: 'summarize', model: 'kimi-k2' });

    expect(result.text).toContain('fake-omp answer');
    expect(result.model).toBe('kimi-k2');
    const printCalls = fake.readArgvLog().filter((argv) => argv.includes('-p'));
    expect(printCalls).toHaveLength(1);
    const mIdx = printCalls[0]!.indexOf('--model');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(printCalls[0]![mIdx + 1]).toBe('kimi-k2');
  });

  it('does not fabricate a model when no model was requested (OMP default is unknown)', async () => {
    const { agent, fake } = setup();

    const result = await agent.queryLlm({ prompt: 'summarize' });

    expect(result.text).toContain('fake-omp answer');
    // Truthful: the one-shot used OMP's own configured default, which the
    // backend did not pin — it must NOT claim this._model was used.
    expect(result.model).toBeUndefined();
    const printCalls = fake.readArgvLog().filter((argv) => argv.includes('-p'));
    expect(printCalls).toHaveLength(1);
    expect(printCalls[0]).not.toContain('--model');
  });

  it('falls back to the OMP default with a truthful warning when the requested model is rejected', async () => {
    const { agent, fake } = setup();

    const result = await agent.queryLlm({ prompt: 'summarize', model: 'unknown-model-x' });

    expect(result.text).toContain('fake-omp answer');
    // The effective model is the OMP default — not the rejected request and
    // not this._model. Reported honestly as unknown + a visible warning.
    expect(result.model).toBeUndefined();
    expect(result.warning).toMatch(/unknown-model-x/);
    const printCalls = fake.readArgvLog().filter((argv) => argv.includes('-p'));
    expect(printCalls).toHaveLength(2);
    expect(printCalls[0]).toContain('--model');
    expect(printCalls[1]).not.toContain('--model');
  });

  it('prepends the system prompt to the one-shot prompt', async () => {
    const { agent, fake } = setup();

    await agent.queryLlm({ prompt: 'USER-PART', systemPrompt: 'SYSTEM-PART', model: 'kimi-k2' });

    const printCalls = fake.readArgvLog().filter((argv) => argv.includes('-p'));
    const prompt = printCalls[0]![printCalls[0]!.indexOf('-p') + 1]!;
    expect(prompt).toBe('SYSTEM-PART\n\nUSER-PART');
  });

  it('propagates non-model failures instead of silently falling back', async () => {
    const { agent, fake } = setup();
    // Point at a binary that does not exist → spawn failure, not a model error.
    process.env.OMP_CLI_PATH = '/nonexistent/omp-binary-nope';

    await expect(agent.queryLlm({ prompt: 'x', model: 'kimi-k2' })).rejects.toThrow();
  });
});

describe('OmpAgent.runMiniCompletion', () => {
  it('returns trimmed stdout text from the one-shot', async () => {
    const { agent } = setup();

    const out = await agent.runMiniCompletion('title for: hello');

    expect(out).toContain('fake-omp answer');
  });
});
