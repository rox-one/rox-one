import { describe, expect, it } from 'bun:test'
import { annotationPayloadRejection, isMessageReactionPayload } from './annotation-payload'
import { createReactionAnnotation, DEFAULT_REACTION_EMOJI } from '../../../ui/src/components/chat/message-reactions'

const reaction = {
  id: 'rxn-1',
  meta: { kind: 'reaction', emoji: '❤️', vote: 'like' },
  target: { source: { sessionId: 's', messageId: 'm1' }, selectors: [] },
}

describe('annotation payload validation', () => {
  it('accepts message-level reactions without selectors', () => {
    expect(isMessageReactionPayload(reaction)).toBe(true)
    expect(annotationPayloadRejection(reaction, 'm1')).toBeNull()
  })

  it('still rejects selector-less highlights', () => {
    const highlight = { ...reaction, meta: { kind: 'highlight' } }
    expect(annotationPayloadRejection(highlight, 'm1')).toBe('invalid')
  })

  it('accepts anchored highlights and checks the target message', () => {
    const highlight = {
      id: 'a1',
      target: { source: { messageId: 'm1' }, selectors: [{ type: 'text-quote', exact: 'x' }] },
    }
    expect(annotationPayloadRejection(highlight, 'm1')).toBeNull()
    expect(annotationPayloadRejection(highlight, 'm2')).toBe('message-mismatch')
    expect(annotationPayloadRejection(reaction, 'm2')).toBe('message-mismatch')
  })

  it('rejects payloads without id', () => {
    expect(annotationPayloadRejection({ ...reaction, id: '' }, 'm1')).toBe('invalid')
    expect(annotationPayloadRejection(null, 'm1')).toBe('invalid')
  })

  it('accepts every reaction the message dock actually creates (like, dislike, emoji)', () => {
    for (const emoji of [DEFAULT_REACTION_EMOJI, '👎', '🔥']) {
      const annotation = createReactionAnnotation({
        messageId: 'm1',
        sessionId: 's1',
        emoji,
        actor: { id: 'local-user', type: 'user' },
      })
      expect(annotationPayloadRejection(annotation, 'm1')).toBeNull()
    }
  })
})
