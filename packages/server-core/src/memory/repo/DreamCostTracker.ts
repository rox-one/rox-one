/**
 * DreamCostTracker — usage → USD for the background memory "dream" (spec §9).
 *
 * A dream calls the distillation mini-model; the price table below maps a
 * known model id to its USD cost per 1M input/output tokens. Two honest
 * outcomes exist for a call:
 *  - the provider returned a usage block → exact USD, `estimated:false`;
 *  - usage is missing (or the model is unknown) → the tracker marks the
 *    figure `estimated:true`; for missing usage the runner approximates the
 *    token counts from text length at ≈4 chars/token (`costFromText`).
 *
 * `record`/`todayTotal` keep a per-bank ledger so the UI can show the day's
 * spend per bank (`todayTotal` ISO-date keyed, UTC). Journal-friendly: USD is
 * rounded to 6 decimals.
 *
 * Fail-soft: nothing here throws on bad input — an unpriceable call is a
 * zero-USD estimate, never a crash in the dream loop.
 */

/** USD prices per 1M tokens for one model. */
export interface DreamModelPrice {
  inPerM: number
  outPerM: number
}

export interface DreamCostUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface DreamCostResult {
  usd: number
  estimated: boolean
}

export interface DreamCostSummary {
  usd: number
  /** true when at least one contributing call was an estimate. */
  estimated: boolean
}

/**
 * Default price table for the models a dream is likely to use, USD per 1M
 * tokens. Values are public list prices at the time of writing; an unknown
 * model (a user-pinned one) is priced as an estimate at 0 unless the caller
 * injects a table covering it.
 */
export const DEFAULT_DREAM_PRICING: Record<string, DreamModelPrice> = {
  'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.6 },
  'gpt-4.1-mini': { inPerM: 0.4, outPerM: 1.6 },
  'gpt-4.1-nano': { inPerM: 0.1, outPerM: 0.4 },
  'claude-3-5-haiku': { inPerM: 0.8, outPerM: 4 },
  'claude-3-5-haiku-latest': { inPerM: 0.8, outPerM: 4 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
  'gemini-2.0-flash': { inPerM: 0.1, outPerM: 0.4 },
  'gemini-2.5-flash': { inPerM: 0.3, outPerM: 2.5 },
}

/** The approximation the dream uses when the provider omits a usage block. */
export const CHARS_PER_TOKEN = 4

/** Token approximation used for missing usage: ceil(chars / 4). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1e6) / 1e6
}

interface CostEntry {
  bankId: string
  usd: number
  estimated: boolean
  /** ISO timestamp; its first 10 chars are the UTC day key. */
  ts: string
}

const MAX_ENTRIES = 5000

export class DreamCostTracker {
  private readonly pricing: Record<string, DreamModelPrice>
  private readonly entries: CostEntry[] = []

  constructor(pricing?: Record<string, DreamModelPrice>) {
    this.pricing = { ...DEFAULT_DREAM_PRICING, ...(pricing ?? {}) }
  }

  /** Normalized (trimmed, lowercased) price lookup; undefined for unknown models. */
  priceFor(model: string): DreamModelPrice | undefined {
    if (!model) return undefined
    return this.pricing[model.trim().toLowerCase()] ?? this.pricing[model.trim()]
  }

  /**
   * Exact cost when the model is known and at least one token count is present;
   * otherwise a zero-USD estimate (`estimated:true`).
   */
  cost(model: string, usage: DreamCostUsage): DreamCostResult {
    const price = this.priceFor(model)
    if (!price) return { usd: 0, estimated: true }
    const hasInput = typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
    const hasOutput = typeof usage?.outputTokens === 'number' && Number.isFinite(usage.outputTokens)
    if (!hasInput && !hasOutput) return { usd: 0, estimated: true }
    const input = hasInput ? Math.max(0, usage.inputTokens as number) : 0
    const output = hasOutput ? Math.max(0, usage.outputTokens as number) : 0
    const usd = (input / 1_000_000) * price.inPerM + (output / 1_000_000) * price.outPerM
    return { usd: round6(usd), estimated: false }
  }

  /**
   * Cost for a call whose provider omitted usage: token counts are estimated
   * from text length (≈4 chars/token) and the result is always an estimate.
   */
  costFromText(
    model: string,
    inputText: string,
    outputText: string,
  ): DreamCostResult & { inputTokens: number; outputTokens: number } {
    const inputTokens = estimateTokens(inputText)
    const outputTokens = estimateTokens(outputText)
    const priced = this.cost(model, { inputTokens, outputTokens })
    // A known model with estimated tokens still computes USD, but the figure is
    // an approximation by construction.
    return { usd: priced.usd, estimated: true, inputTokens, outputTokens }
  }

  /** Append one bank's spend. `estimated` marks approximated figures. */
  record(bankId: string, usd: number, ts: string, estimated = false): void {
    if (!bankId || !Number.isFinite(usd) || usd < 0) return
    this.entries.push({ bankId, usd: round6(usd), estimated: estimated === true, ts })
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
  }

  /** Sum of today's (UTC) recorded spend for one bank. */
  todayTotal(bankId: string, now: Date = new Date()): number {
    return this.todaySummary(bankId, now).usd
  }

  /** Today's (UTC) spend plus whether any contributing call was an estimate. */
  todaySummary(bankId: string, now: Date = new Date()): DreamCostSummary {
    const day = now.toISOString().slice(0, 10)
    let usd = 0
    let estimated = false
    for (const entry of this.entries) {
      if (entry.bankId !== bankId) continue
      if (entry.ts.slice(0, 10) !== day) continue
      usd += entry.usd
      if (entry.estimated) estimated = true
    }
    return { usd: round6(usd), estimated }
  }
}