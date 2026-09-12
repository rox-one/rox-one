import type { AnnotationAuthor, AnnotationV1 } from '@craft-agent/core'

export const DEFAULT_REACTION_EMOJI = '❤️'
export const DISLIKE_REACTION_EMOJI = '👎'
export const QUICK_REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '🔥', '🎉'] as const

export type LocalActor = AnnotationAuthor

export const LOCAL_REACTION_ACTOR: LocalActor = { id: 'local-user', name: 'local', type: 'user' }

export function isReactionAnnotation(annotation: AnnotationV1): boolean {
  if (annotation.deletedAt) return false
  if ((annotation.meta as Record<string, unknown> | undefined)?.kind === 'reaction') return true
  return annotation.body.some((body) => body.type === 'tag' && 'value' in body && QUICK_REACTION_EMOJIS.includes(body.value as (typeof QUICK_REACTION_EMOJIS)[number]))
}

export function reactionEmoji(annotation: AnnotationV1): string | null {
  const meta = annotation.meta as Record<string, unknown> | undefined
  if (typeof meta?.emoji === 'string' && meta.emoji) return meta.emoji
  const tag = annotation.body.find((body) => body.type === 'tag')
  return tag && 'value' in tag ? tag.value : null
}

export function createReactionAnnotation({
  messageId,
  sessionId,
  emoji,
  actor,
  now = Date.now(),
}: {
  messageId: string
  sessionId: string
  emoji: string
  actor: LocalActor
  now?: number
}): AnnotationV1 {
  const vote = emoji === DEFAULT_REACTION_EMOJI ? 'like' : emoji === DISLIKE_REACTION_EMOJI ? 'dislike' : 'emoji'
  return {
    id: `rxn-${now}-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: 1,
    createdAt: now,
    createdBy: actor,
    intent: 'comment',
    body: [{ type: 'tag', value: emoji }],
    target: {
      source: { sessionId, messageId },
      selectors: [],
    },
    meta: {
      kind: 'reaction',
      emoji,
      vote,
      collaborationReady: true,
    },
  }
}

export type ReactionCount = {
  emoji: string
  count: number
  mine: boolean
}

export function aggregateReactions(annotations: AnnotationV1[] | undefined, actorId?: string): ReactionCount[] {
  const counts = new Map<string, ReactionCount>()
  for (const annotation of annotations ?? []) {
    if (!isReactionAnnotation(annotation)) continue
    const emoji = reactionEmoji(annotation)
    if (!emoji) continue
    const current = counts.get(emoji) ?? { emoji, count: 0, mine: false }
    current.count += 1
    if (actorId && annotation.createdBy?.id === actorId) current.mine = true
    counts.set(emoji, current)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
}

export function findOwnReaction(
  annotations: AnnotationV1[] | undefined,
  emoji: string,
  actorId: string,
): AnnotationV1 | undefined {
  return (annotations ?? []).find(
    (annotation) =>
      isReactionAnnotation(annotation) &&
      reactionEmoji(annotation) === emoji &&
      annotation.createdBy?.id === actorId,
  )
}

export function migrateAnnotationActors(
  annotations: AnnotationV1[] | undefined,
  actor: LocalActor,
): AnnotationV1[] {
  return (annotations ?? []).map((annotation) => {
    if (annotation.createdBy?.id) return annotation
    return {
      ...annotation,
      createdBy: actor,
      meta: {
        ...(annotation.meta ?? {}),
        migratedActor: true,
        collaborationReady: true,
      },
    }
  })
}

export function quoteMessageMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
