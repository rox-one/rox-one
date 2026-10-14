/**
 * Composer stats line (DeepSeek Harness style): turns + steps, total tokens,
 * cache hit %, context usage %. Every metric is derived from data the session
 * already carries; a metric without a source is `null` and is not rendered.
 */

export interface ComposerStatsInput {
  messages: ReadonlyArray<{ role: string }>
  tokenUsage?: {
    inputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    contextWindow?: number
  } | null
  /** Used when the session has not reported a context window yet (model catalog). */
  fallbackContextWindow?: number | null
}

export interface ComposerStats {
  turns: number
  steps: number
  totalTokens: number | null
  /** 0–100, last request: cache-read share of the prompt. */
  cacheHitPercent: number | null
  /** 0–100, last request prompt size vs. the model context window. */
  contextPercent: number | null
}

const positive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

export function computeComposerStats({ messages, tokenUsage, fallbackContextWindow }: ComposerStatsInput): ComposerStats {
  let turns = 0
  let steps = 0
  for (const m of messages) {
    if (m.role === 'user') turns++
    else if (m.role === 'tool') steps++
  }
  const input = tokenUsage?.inputTokens
  const cacheRead = tokenUsage?.cacheReadTokens
  const window = positive(tokenUsage?.contextWindow) ? tokenUsage!.contextWindow! : (positive(fallbackContextWindow) ? fallbackContextWindow : null)
  return {
    turns,
    steps,
    totalTokens: positive(tokenUsage?.totalTokens) ? tokenUsage!.totalTokens! : null,
    // inputTokens already includes cache reads (SessionManager / event adapters).
    cacheHitPercent: positive(input) && typeof cacheRead === 'number' && Number.isFinite(cacheRead) && cacheRead >= 0
      ? Math.min(100, Math.round((cacheRead / input) * 100))
      : null,
    contextPercent: positive(input) && window ? Math.min(100, Math.round((input / window) * 100)) : null,
  }
}

/** 950 → "950", 3 200 → "3.2K", 3 200 000 → "3.2M". */
export function formatCompactTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size
      const text = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')
      // 999.95K rounds to "1000K" → promote to the next unit.
      if (text === '1000' && suffix !== 'B') return suffix === 'K' ? '1M' : '1B'
      return `${text}${suffix}`
    }
  }
  return String(n)
}
