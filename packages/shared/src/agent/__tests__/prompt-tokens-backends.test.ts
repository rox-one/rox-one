import { describe, expect, it } from 'bun:test';
import { promptTokens, TurnRequestTotals } from '../core/prompt-tokens.ts';
import { toAgentEventUsage } from '../omp-agent.ts';
import { ClaudeEventAdapter, claudeTurnTotals } from '../backend/claude/event-adapter.ts';
import { PiEventAdapter } from '../backend/pi/event-adapter.ts';

describe('promptTokens', () => {
  it('sums input + cache read + cache write, ignoring bad values', () => {
    expect(promptTokens(100, 900, 50)).toBe(1050);
    expect(promptTokens(100, undefined, null)).toBe(100);
    expect(promptTokens(NaN, -5, 10)).toBe(10);
  });
  it('TurnRequestTotals sums requests and resets on take', () => {
    const t = new TurnRequestTotals();
    expect(t.take()).toBeUndefined();
    t.add(1000, 10); t.add(1200, 20);
    expect(t.take()).toEqual({ promptTokens: 2200, outputTokens: 30, requests: 2 });
    expect(t.take()).toBeUndefined();
  });
});

describe('omp backend', () => {
  it('normalizes input to include cache reads and writes', () => {
    const u = toAgentEventUsage({ input: 40, output: 7, cacheRead: 960, cacheWrite: 0, cost: { total: 0.01 } })!;
    expect(u.inputTokens).toBe(1000);
    expect(u.cacheReadTokens).toBe(960);
    // cache hit = 96%, never >100%
    expect(u.cacheReadTokens! / u.inputTokens).toBeLessThanOrEqual(1);
  });
});

describe('claude backend', () => {
  it('turn totals are the delta of the cumulative modelUsage', () => {
    const first = claudeTurnTotals({ m: { inputTokens: 100, cacheReadInputTokens: 900, cacheCreationInputTokens: 0, outputTokens: 50 } }, null);
    expect(first.totals).toMatchObject({ promptTokens: 1000, outputTokens: 50 });
    const second = claudeTurnTotals({ m: { inputTokens: 150, cacheReadInputTokens: 2850, cacheCreationInputTokens: 0, outputTokens: 80 } }, first.snapshot);
    expect(second.totals).toMatchObject({ promptTokens: 2000, outputTokens: 30 });
  });
  it('a drop restarts the baseline; an empty snapshot yields no totals', () => {
    const fresh = claudeTurnTotals({ m: { inputTokens: 10, outputTokens: 5 } }, { promptTokens: 5000, outputTokens: 500 });
    expect(fresh.totals).toMatchObject({ promptTokens: 10, outputTokens: 5 });
    const empty = claudeTurnTotals({}, { promptTokens: 5000, outputTokens: 500 });
    expect(empty.totals).toBeUndefined();
    expect(empty.snapshot).toEqual({ promptTokens: 5000, outputTokens: 500 });
  });
  it('complete event carries prompt-size input and requestTotals', async () => {
    const adapter = new ClaudeEventAdapter({ onDebug: () => {}, mapSDKError: () => null } as any);
    adapter.startTurn();
    const events = await adapter.adapt({
      type: 'result', subtype: 'success',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 },
      total_cost_usd: 0, session_id: 's',
      modelUsage: { m: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 80, cacheCreationInputTokens: 10, contextWindow: 200000 } },
    } as any);
    const complete = events.find(e => e.type === 'complete') as any;
    expect(complete.usage.inputTokens).toBe(100);
    expect(complete.usage.cacheReadTokens).toBe(80);
    expect(complete.usage.requestTotals).toMatchObject({ promptTokens: 100, outputTokens: 5 });
  });
});

describe('pi backend', () => {
  const assistant = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'stop', content: [], usage: { input, output, cacheRead, cacheWrite, totalTokens: 0, cost: { total: 0 } } },
  });
  it('input includes cache reads and writes; requestTotals sums every request', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    const out: any[] = [];
    for (const e of [assistant(10, 90, 0, 4), assistant(20, 180, 0, 6), { type: 'agent_end', messages: [] }]) {
      out.push(...adapter.adaptEvent(e as any));
    }
    const updates = out.filter(e => e.type === 'usage_update');
    expect(updates.map(u => u.usage.inputTokens)).toEqual([100, 200]);
    const complete = out.find(e => e.type === 'complete');
    expect(complete.usage.inputTokens).toBe(200);
    expect(complete.usage.requestTotals).toMatchObject({ promptTokens: 300, outputTokens: 10, requests: 2 });
  });
});
