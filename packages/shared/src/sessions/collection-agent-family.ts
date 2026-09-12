/**
 * Agent-family classification for collection chips (Issue 05).
 * Families are OR-matched within the chip list.
 */

export const COLLECTION_AGENT_FAMILY_VALUES = [
  'claude',
  'codex',
  'hermes',
  'opencode',
  'omp',
  'other',
] as const

export type CollectionAgentFamily = (typeof COLLECTION_AGENT_FAMILY_VALUES)[number]

export function isCollectionAgentFamily(value: unknown): value is CollectionAgentFamily {
  return typeof value === 'string' && (COLLECTION_AGENT_FAMILY_VALUES as readonly string[]).includes(value)
}

function haystack(model?: string | null, llmConnection?: string | null): string {
  return `${model ?? ''} ${llmConnection ?? ''}`.toLowerCase()
}

/**
 * Classify a session from model id + optional LLM connection name.
 * More specific product families win before the catch-all `other`.
 */
export function classifyAgentFamily(input: {
  model?: string | null
  llmConnection?: string | null
}): CollectionAgentFamily {
  const hay = haystack(input.model, input.llmConnection)
  if (/\bclaude\b/.test(hay) || hay.includes('anthropic')) return 'claude'
  if (/\bcodex\b/.test(hay)) return 'codex'
  if (/\bhermes\b/.test(hay)) return 'hermes'
  if (/\bopencode\b/.test(hay) || hay.includes('open-code')) return 'opencode'
  if (/\bomp\b/.test(hay) || hay.includes('rox/') || hay.includes('rox-cli') || hay.includes('oh-my-pi')) {
    return 'omp'
  }
  return 'other'
}

/** Provider key for real harness icons. Null means "do not invent a brand". */
export type CollectionHarnessProvider = 'anthropic' | 'openai' | 'omp'

/**
 * Map a session's model/connection onto a bundled provider icon.
 * Unknown families stay null so the UI never falls back to a fake Claude mark.
 */
export function collectionHarnessProvider(input: {
  model?: string | null
  llmConnection?: string | null
}): CollectionHarnessProvider | null {
  switch (classifyAgentFamily(input)) {
    case 'claude':
      return 'anthropic'
    case 'codex':
      return 'openai'
    case 'omp':
      return 'omp'
    case 'hermes':
    case 'opencode':
    case 'other':
      return null
  }
}
