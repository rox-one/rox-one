import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnnotationV1 } from '@craft-agent/core'
import { resolveTextAnnotations } from '../../markdown/annotation-resolver'
import {
  aggregateReactions,
  createReactionAnnotation,
  DEFAULT_REACTION_EMOJI,
  findOwnReaction,
  isReactionAnnotation,
  migrateAnnotationActors,
  quoteMessageMarkdown,
} from '../message-reactions'

const actor = { id: 'user-1', name: 'Ada', type: 'user' as const }

function highlight(id: string, selectors: AnnotationV1['target']['selectors']): AnnotationV1 {
  return {
    id,
    schemaVersion: 1,
    createdAt: 1,
    intent: 'highlight',
    body: [{ type: 'highlight' }],
    style: { color: 'yellow' },
    target: { source: { sessionId: 's1', messageId: 'm1' }, selectors },
  }
}

describe('message reactions and hover dock', () => {
  it('persists like/dislike/emoji events with actor metadata and aggregates counts', () => {
    const like = createReactionAnnotation({ messageId: 'm1', sessionId: 's1', emoji: DEFAULT_REACTION_EMOJI, actor, now: 1 })
    const dislike = createReactionAnnotation({
      messageId: 'm1',
      sessionId: 's1',
      emoji: '👎',
      actor: { id: 'user-2', type: 'user' },
      now: 2,
    })
    const likeAgain = createReactionAnnotation({ messageId: 'm1', sessionId: 's1', emoji: DEFAULT_REACTION_EMOJI, actor: { id: 'user-3', type: 'user' }, now: 3 })
    expect(isReactionAnnotation(like)).toBe(true)
    expect(like.meta).toMatchObject({ kind: 'reaction', vote: 'like', collaborationReady: true })
    expect(dislike.meta).toMatchObject({ vote: 'dislike' })
    const counts = aggregateReactions([like, dislike, likeAgain], actor.id)
    expect(counts).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '👎', count: 1, mine: false },
    ])
    expect(findOwnReaction([like, dislike], '❤️', actor.id)?.id).toBe(like.id)
  })

  it('keeps yellow highlights attached to the same message/range after reopen', () => {
    const annotation = highlight('h1', [
      { type: 'text-position', start: 6, end: 10 },
      { type: 'text-quote', exact: 'beta', prefix: 'alpha ', suffix: ' gamma' },
    ])
    const raw = JSON.stringify(annotation)
    const reopened = JSON.parse(raw) as AnnotationV1
    const resolved = resolveTextAnnotations('alpha beta gamma', [reopened])
    expect(reopened.style?.color).toBe('yellow')
    expect(resolved.resolved[0]?.range).toEqual({ start: 6, end: 10 })
    expect(reopened.target.source.messageId).toBe('m1')
  })

  it('marks stale highlight anchors when the quoted passage is gone', () => {
    const annotation = highlight('h2', [
      { type: 'text-position', start: 99, end: 120 },
      { type: 'text-quote', exact: 'missing-passage' },
    ])
    const result = resolveTextAnnotations('alpha beta gamma', [annotation])
    expect(result.unresolved[0]?.reason).toBe('quote-not-found')
  })

  it('migrates local-first annotations to collaboration-ready actor metadata', () => {
    const legacy = highlight('h3', [{ type: 'text-quote', exact: 'beta' }])
    const [migrated] = migrateAnnotationActors([legacy], actor)
    expect(migrated?.createdBy).toEqual(actor)
    expect(migrated?.meta).toMatchObject({ migratedActor: true, collaborationReady: true })
  })

  it('quotes a message as markdown for reply', () => {
    expect(quoteMessageMarkdown('hello\nworld')).toBe('> hello\n> world')
  })

  it('exposes a keyboard/touch dock rather than hover-only controls', () => {
    const source = readFileSync(join(__dirname, '..', 'MessageHoverDock.tsx'), 'utf8')
    const turn = readFileSync(join(__dirname, '..', 'TurnCard.tsx'), 'utf8')
    const user = readFileSync(join(__dirname, '..', 'UserMessageBubble.tsx'), 'utf8')
    expect(source).toContain('role="toolbar"')
    expect(source).toContain('aria-label')
    expect(source).not.toMatch(/opacity-0 group-hover:opacity-100/)
    expect(turn).toContain('MessageHoverDock')
    expect(turn).toContain('group-focus-within:opacity-100')
    expect(turn).toMatch(/MessageHoverDock[\s\S]{0,1200}opacity-100 group-focus-within:opacity-100/)
    expect(user).toContain('MessageHoverDock')
  })
})
