/**
 * Validation for message annotations accepted by SessionManager.
 *
 * Text highlights must carry at least one selector so they can be anchored.
 * Message-level reactions (❤️/👍/👎… from the message action dock) target the
 * whole message and legitimately have `selectors: []` — they were previously
 * rejected silently, which made every reaction a no-op.
 */

type AnnotationLike = {
  id?: unknown
  meta?: unknown
  target?: {
    selectors?: unknown[]
    source?: { messageId?: unknown }
  }
}

export function isMessageReactionPayload(annotation: AnnotationLike | null | undefined): boolean {
  const meta = annotation?.meta as Record<string, unknown> | undefined
  return meta?.kind === 'reaction' && typeof meta.emoji === 'string' && meta.emoji.length > 0
}

/** Returns a rejection reason, or null when the payload is acceptable. */
export function annotationPayloadRejection(
  annotation: AnnotationLike | null | undefined,
  messageId: string,
): 'invalid' | 'message-mismatch' | null {
  if (!annotation?.id || !annotation.target || !Array.isArray(annotation.target.selectors)) return 'invalid'
  if (annotation.target.selectors.length === 0 && !isMessageReactionPayload(annotation)) return 'invalid'
  if (annotation.target.source?.messageId !== messageId) return 'message-mismatch'
  return null
}
