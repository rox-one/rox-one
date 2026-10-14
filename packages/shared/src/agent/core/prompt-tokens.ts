/**
 * One definition of "prompt tokens" for every backend: non-cached input plus
 * cache reads plus cache writes. Providers report these separately (Anthropic,
 * pi-ai, OMP); `AgentEventUsage.inputTokens` always carries the sum so cache-hit
 * and context-window math is the same on every backend.
 */
export function promptTokens(input: number | null | undefined, cacheRead?: number | null, cacheWrite?: number | null): number {
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return n(input) + n(cacheRead) + n(cacheWrite);
}

/** Running sum of prompt+output over every model request of one turn. */
export class TurnRequestTotals {
  private prompt = 0;
  private output = 0;
  private count = 0;
  add(prompt: number, output: number): void {
    this.prompt += Math.max(0, prompt || 0);
    this.output += Math.max(0, output || 0);
    this.count++;
  }
  /** Totals for the turn, or undefined when no request reported usage. */
  take(): { promptTokens: number; outputTokens: number; requests: number } | undefined {
    const out = this.count > 0 ? { promptTokens: this.prompt, outputTokens: this.output, requests: this.count } : undefined;
    this.reset();
    return out;
  }
  reset(): void { this.prompt = 0; this.output = 0; this.count = 0; }
}
