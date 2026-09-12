/**
 * Provider-aware token estimate + actual usage reconciliation (Rox issue 24).
 * Wraps the existing 4-chars/token heuristic. No extra tokenizer dependency.
 */
import { estimateTokens } from '../utils/large-response.ts'

export type TokenProviderFamily = 'openai' | 'anthropic' | 'rox' | 'unknown'

/** Characters per token by provider family. OpenAI/Rox stay at the shared 4-char heuristic. */
const CHARS_PER_TOKEN: Record<TokenProviderFamily, number> = {
  openai: 4,
  anthropic: 3.5,
  rox: 4,
  unknown: 4,
}

export function providerFamilyFromType(providerType: string | undefined): TokenProviderFamily {
  const value = (providerType ?? '').toLowerCase()
  if (value === 'omp' || value === 'rox') return 'rox'
  if (value.includes('anthropic')) return 'anthropic'
  if (value.includes('openai')) return 'openai'
  return 'unknown'
}

export function estimateProviderTokens(text: string, family: TokenProviderFamily): number {
  if (family === 'openai' || family === 'rox' || family === 'unknown') {
    return estimateTokens(text)
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN[family])
}

export type TokenReconciliation = {
  estimated: number
  actual: number
  delta: number
  driftRatio: number
}

export function reconcileTokenUsage(estimated: number, actual: number): TokenReconciliation {
  const safeEstimated = Math.max(0, estimated)
  const safeActual = Math.max(0, actual)
  const delta = safeActual - safeEstimated
  const driftRatio = safeEstimated === 0 ? (safeActual === 0 ? 0 : 1) : delta / safeEstimated
  return { estimated: safeEstimated, actual: safeActual, delta, driftRatio }
}
