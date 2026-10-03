/**
 * Pure model for the Memory (Память) screen: facets, search, sort, keyword
 * topics, near-duplicates and the context token budget. Everything here is
 * derived from the lessons on disk — no invented numbers.
 */
import type { Lesson, LessonScope } from '@rox/shared/memory/types'
import { LESSONS_HEADER_TOKENS, lessonTokens, selectContextLessons } from '@rox/shared/memory/context-select'
import { lessonSimilarity, lessonTokens as stemTokens } from './lesson-dedupe'

export type MemorySort = 'usage' | 'recency' | 'tokens' | 'conflicts'
export type UsageBucket = 'never' | 'some' | 'often'
export type StatusFacet = 'pinned' | 'disabled' | 'inContext' | 'negative' | 'conflicts' | 'merged'

export interface MemoryFilter {
  scope?: LessonScope | null
  category?: string | null
  tag?: string | null
  trigger?: string | null
  usage?: UsageBucket | null
  status?: StatusFacet | null
  topic?: string | null
  query?: string
}

/** Stable identity across both stores (mirrors server lessonKey + scope). */
export function lessonId(lesson: Pick<Lesson, 'scope' | 'rule'>): string {
  return `${lesson.scope}:${lesson.rule.trim().toLowerCase()}`
}

export function usageBucket(lesson: Lesson): UsageBucket {
  const n = lesson.usageCount ?? 0
  return n === 0 ? 'never' : n >= 5 ? 'often' : 'some'
}

/** Lessons the agent receives right now (per store, same rule as the server). */
export function contextSelection(lessons: readonly Lesson[]): Set<string> {
  const out = new Set<string>()
  for (const scope of ['global', 'workspace'] as const) {
    for (const lesson of selectContextLessons(lessons.filter((l) => l.scope === scope))) out.add(lessonId(lesson))
  }
  return out
}

export interface TokenBudget {
  injectedTokens: number
  injectedCount: number
  activeTokens: number
  activeCount: number
  disabledCount: number
}

export function tokenBudget(lessons: readonly Lesson[], inContext: Set<string>): TokenBudget {
  let injectedTokens = 0
  let injectedCount = 0
  let activeTokens = 0
  let activeCount = 0
  let disabledCount = 0
  for (const lesson of lessons) {
    if (lesson.disabled) { disabledCount++; continue }
    const tokens = lessonTokens(lesson)
    activeTokens += tokens
    activeCount++
    if (inContext.has(lessonId(lesson))) { injectedTokens += tokens; injectedCount++ }
  }
  if (injectedCount) injectedTokens += LESSONS_HEADER_TOKENS
  return { injectedTokens, injectedCount, activeTokens, activeCount, disabledCount }
}

const STOP_WORDS = [
  // ru (stems are first 5 chars of words ≥4 chars)
  'всегд', 'никог', 'нужно', 'надо', 'перед', 'после', 'когда', 'чтобы', 'котор', 'этого', 'этот', 'если', 'только', 'также',
  'очень', 'более', 'можно', 'нельз', 'должн', 'следу', 'через', 'вмест', 'между', 'время', 'сразу', 'самом', 'своих', 'своим',
  'любые', 'любой', 'всего', 'всех', 'всем', 'даже', 'пользо', 'польз', 'марка', 'марку', 'марк', 'agent', 'агент', 'агента',
  'использ', 'испол', 'делат', 'сдела', 'будет', 'есть', 'него', 'тогда', 'того', 'может', 'отдел', 'сохра', 'основ', 'оставл', 'клиен', 'такой', 'такие',
  // en
  'always', 'alway', 'never', 'shoul', 'shoul', 'before', 'befor', 'after', 'when', 'with', 'that', 'this', 'from', 'into', 'must',
  'only', 'model', 'user', 'users', 'using', 'which', 'there', 'their', 'about', 'every', 'other', 'without', 'witho', 'instead', 'inste',
]
const STOP = new Set(STOP_WORDS.map((word) => word.slice(0, 5)))

export interface Topic {
  id: string
  label: string
  lessonIds: string[]
}

/**
 * Keyword topics: every lesson joins the group of its most shared stem
 * (document frequency ≥ 3, not a stopword, not in >35% of lessons).
 * Labels use the most frequent full word behind the stem.
 */
export function clusterTopics(lessons: readonly Lesson[]): { topics: Topic[]; topicOf: Map<string, string> } {
  const df = new Map<string, number>()
  const words = new Map<string, Map<string, number>>()
  const tokensOf = new Map<string, string[]>()
  for (const lesson of lessons) {
    const stems = [...stemTokens(lesson.rule)].filter((stem) => !STOP.has(stem))
    tokensOf.set(lessonId(lesson), stems)
    for (const stem of stems) df.set(stem, (df.get(stem) ?? 0) + 1)
    for (const word of lesson.rule.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (word.length < 4) continue
      const stem = word.slice(0, 5)
      const forms = words.get(stem) ?? new Map<string, number>()
      forms.set(word, (forms.get(word) ?? 0) + 1)
      words.set(stem, forms)
    }
  }
  const max = Math.max(3, Math.floor(lessons.length * 0.35))
  const topicOf = new Map<string, string>()
  const groups = new Map<string, string[]>()
  for (const lesson of lessons) {
    const id = lessonId(lesson)
    let best: string | null = null
    let bestDf = 0
    for (const stem of tokensOf.get(id) ?? []) {
      const n = df.get(stem) ?? 0
      if (n < 3 || n > max) continue
      if (n > bestDf || (n === bestDf && best !== null && stem < best)) { best = stem; bestDf = n }
    }
    const key = best ?? ''
    topicOf.set(id, key)
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  const label = (stem: string) => {
    const forms = words.get(stem)
    if (!forms) return stem
    return [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]
  }
  const topics: Topic[] = [...groups.entries()]
    .filter(([key]) => key !== '')
    .map(([key, ids]) => ({ id: key, label: label(key), lessonIds: ids }))
    .sort((a, b) => b.lessonIds.length - a.lessonIds.length || a.label.localeCompare(b.label))
  const rest = groups.get('')
  if (rest?.length) topics.push({ id: '', label: '', lessonIds: rest })
  return { topics, topicOf }
}

export const NEAR_DUPLICATE_THRESHOLD = 0.4

/** Near-duplicates of one lesson in the same scope, most similar first. */
export function nearDuplicates(target: Lesson, lessons: readonly Lesson[], threshold = NEAR_DUPLICATE_THRESHOLD, limit = 5): Array<{ lesson: Lesson; score: number }> {
  const id = lessonId(target)
  return lessons
    .filter((l) => l.scope === target.scope && lessonId(l) !== id)
    .map((lesson) => ({ lesson, score: lessonSimilarity(target.rule, lesson.rule) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Ids of lessons that have at least one near-duplicate (same scope). */
export function duplicateIds(lessons: readonly Lesson[], threshold = NEAR_DUPLICATE_THRESHOLD): Set<string> {
  const out = new Set<string>()
  const stems = lessons.map((l) => stemTokens(l.rule))
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      if (lessons[i]!.scope !== lessons[j]!.scope) continue
      const a = stems[i]!
      const b = stems[j]!
      if (!a.size || !b.size) continue
      let shared = 0
      for (const token of a) if (b.has(token)) shared++
      if (shared / (a.size + b.size - shared) >= threshold) { out.add(lessonId(lessons[i]!)); out.add(lessonId(lessons[j]!)) }
    }
  }
  return out
}

export function matchesFilter(lesson: Lesson, filter: MemoryFilter, ctx: { inContext: Set<string>; topicOf: Map<string, string> }): boolean {
  const id = lessonId(lesson)
  if (filter.scope && lesson.scope !== filter.scope) return false
  if (filter.category && lesson.category !== filter.category) return false
  if (filter.tag && !(lesson.tags ?? []).includes(filter.tag)) return false
  if (filter.trigger && lesson.source.trigger !== filter.trigger) return false
  if (filter.usage && usageBucket(lesson) !== filter.usage) return false
  if (filter.topic != null && ctx.topicOf.get(id) !== filter.topic) return false
  switch (filter.status) {
    case 'pinned': if (!lesson.pinned) return false; break
    case 'disabled': if (!lesson.disabled) return false; break
    case 'inContext': if (!ctx.inContext.has(id)) return false; break
    case 'negative': if (!lesson.negative) return false; break
    case 'conflicts': if (!(lesson.conflicts?.length)) return false; break
    case 'merged': if (!(lesson.mergedFrom?.length || lesson.mergedInto)) return false; break
    default: break
  }
  const q = filter.query?.trim().toLowerCase()
  if (q) {
    for (const part of q.split(/\s+/)) {
      if (part.startsWith('#')) {
        if (!(lesson.tags ?? []).some((tag) => tag.startsWith(part.slice(1)))) return false
      } else if (!lesson.rule.toLowerCase().includes(part) && !(lesson.tags ?? []).some((tag) => tag.includes(part))) return false
    }
  }
  return true
}

export function sortLessons(lessons: readonly Lesson[], sort: MemorySort): Lesson[] {
  const time = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0)
  const pinnedFirst = (a: Lesson, b: Lesson) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
  const by: Record<MemorySort, (a: Lesson, b: Lesson) => number> = {
    usage: (a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || time(b.lastUsedAt) - time(a.lastUsedAt),
    recency: (a, b) => time(b.ts) - time(a.ts),
    tokens: (a, b) => lessonTokens(b) - lessonTokens(a),
    conflicts: (a, b) => (b.conflicts?.length ?? 0) - (a.conflicts?.length ?? 0) || (b.usageCount ?? 0) - (a.usageCount ?? 0),
  }
  return [...lessons].sort((a, b) => pinnedFirst(a, b) || by[sort](a, b))
}

export function countBy<T>(items: readonly T[], key: (item: T) => string | string[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    for (const one of Array.isArray(k) ? k : k ? [k] : []) out.set(one, (out.get(one) ?? 0) + 1)
  }
  return out
}

/** Merge metadata retains complete originals so the operation can be undone. */
export function mergePatch(keeper: Lesson, others: readonly Lesson[], rule: string): Partial<Lesson> {
  const all = [keeper, ...others]
  if (all.some((lesson) => lesson.scope !== keeper.scope)) throw new Error('Memory lessons from different scopes cannot be merged')
  const tags = [...new Set(all.flatMap((l) => l.tags ?? []))]
  const usedAt = all.flatMap((l) => l.usedAt ?? []).sort().slice(-20)
  const mergedFrom = [...new Set([...(keeper.mergedFrom ?? []), ...others.flatMap((l) => [l.rule, ...(l.mergedFrom ?? [])])])].filter((r) => r !== rule)
  const lastUsed = all.map((l) => l.lastUsedAt).filter((x): x is string => Boolean(x)).sort().pop()
  const originals = all.flatMap((lesson) => {
    if (lesson.mergeHistory?.version === 1) return lesson.mergeHistory.lessons
    const { mergeHistory: _history, ...original } = lesson
    return [original]
  })
  return {
    rule,
    mergedFrom,
    mergeHistory: { version: 1, lessons: originals },
    usageCount: all.reduce((sum, l) => sum + (l.usageCount ?? 0), 0),
    ...(lastUsed ? { lastUsedAt: lastUsed } : {}),
    ...(usedAt.length ? { usedAt } : {}),
    ...(tags.length ? { tags } : {}),
    ...(all.some((l) => l.pinned) ? { pinned: true } : {}),
    ...(all.some((l) => l.negative) ? { negative: true } : {}),
    ...(rule !== keeper.rule ? { editedAt: new Date().toISOString() } : {}),
  }
}
