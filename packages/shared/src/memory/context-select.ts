/**
 * Which lessons are injected into an agent prompt — shared by the server
 * (LessonStore.forContext) and the Memory screen (token budget meter) so the
 * UI shows exactly what the agent receives.
 *
 * Rules: disabled lessons are never injected; pinned lessons always come
 * first (up to the limit); the rest are the most recent. Result is most
 * recent first within each group.
 */
import { LESSON_LIMITS, type Lesson } from './types'

export function selectContextLessons<T extends Lesson>(lessons: readonly T[], limit: number = LESSON_LIMITS.context): T[] {
  const active = lessons.filter(l => !l.disabled)
  const pinned = active.filter(l => l.pinned).reverse()
  if (pinned.length >= limit) return pinned.slice(0, limit)
  const rest = active.filter(l => !l.pinned).slice(-(limit - pinned.length)).reverse()
  return [...pinned, ...rest]
}

/** Rough token estimate (≈4 chars per token) — labelled as an estimate in UI. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Header line formatLessonsForPrompt puts above the rules. */
export const LESSONS_HEADER_TOKENS = estimateTokens('[Learned corrections — user-taught rules. ALWAYS follow these. They override default behavior.]\n')

/** Token estimate of one lesson line as rendered by formatLessonsForPrompt. */
export function lessonTokens(lesson: Pick<Lesson, 'rule' | 'negative'>): number {
  return estimateTokens(lesson.negative ? `- MUST NOT: ${lesson.rule}\n` : `- ${lesson.rule}\n`)
}
