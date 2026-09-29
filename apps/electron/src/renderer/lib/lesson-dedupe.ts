/**
 * Display-side dedupe for memory lessons: the store can hold the same rule in
 * two wordings (e.g. «Раскрытые ранее credentials НЕ использовать повторно…»
 * and «Никогда не использовать ранее раскрытые credentials…»). The panel shows
 * one of them and keeps the rest behind a «show similar» toggle.
 */

const MIN_TOKEN = 4
const STEM = 5
export const LESSON_SIMILARITY_THRESHOLD = 0.5

/** Crude, language-agnostic stems: lowercase words ≥4 chars cut to 5 chars. */
export function lessonTokens(rule: string): Set<string> {
  const out = new Set<string>()
  for (const word of rule.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length < MIN_TOKEN) continue
    out.add(word.slice(0, STEM))
  }
  return out
}

export function lessonSimilarity(a: string, b: string): number {
  const ta = lessonTokens(a)
  const tb = lessonTokens(b)
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0
  let shared = 0
  for (const token of ta) if (tb.has(token)) shared += 1
  return shared / (ta.size + tb.size - shared)
}

/**
 * Keep the first lesson of every similarity cluster (input order = priority),
 * returning the near-duplicates separately.
 */
export function dedupeSimilarLessons<T extends { rule: string }>(
  items: readonly T[],
  threshold = LESSON_SIMILARITY_THRESHOLD,
): { unique: T[]; similar: T[] } {
  const unique: T[] = []
  const similar: T[] = []
  for (const item of items) {
    if (unique.some((kept) => lessonSimilarity(kept.rule, item.rule) >= threshold)) similar.push(item)
    else unique.push(item)
  }
  return { unique, similar }
}
