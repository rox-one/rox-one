/**
 * Public publication is a separate trust boundary from collaboration.
 * DG-03 (retention / abuse / deletion SLA) is still OPEN — live public
 * publication stays fail-closed. Local redaction preview is allowed.
 */

export const PUBLIC_PUBLICATION_ENABLED = false
export const PUBLICATION_GATE = 'DG03_GATED' as const

export type PublicationKind = 'publication'
export type CollaborationKind = 'collaboration'

export interface RedactionPreview {
  preview: string
  redactedCount: number
}

interface SecretPattern {
  readonly match: RegExp
  /** `$1` keeps the key label of a `key: value` pair; the value is always dropped. */
  readonly replacement: string
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { match: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: '[redacted]' },
  { match: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: '[redacted]' },
  { match: /\b((?:api[_-]?key|secret|token|password)\s*[:=]\s*)\S+/gi, replacement: '$1[redacted]' },
  { match: /Bearer\s+[A-Za-z0-9._-]+/g, replacement: '[redacted]' },
]

export function redactForPublication(source: string): RedactionPreview {
  let preview = source
  let redactedCount = 0
  for (const { match, replacement } of SECRET_PATTERNS) {
    redactedCount += preview.match(match)?.length ?? 0
    preview = preview.replace(match, replacement)
  }
  return { preview, redactedCount }
}

export function createPublicPublication(_input: {
  sessionId: string
  preview: RedactionPreview
  expiresAt?: number
}): { ok: false; error: typeof PUBLICATION_GATE } {
  return { ok: false, error: PUBLICATION_GATE }
}

export function isCollaborationCard(kind: string): kind is CollaborationKind {
  return kind === 'collaboration'
}

export function isPublicationCard(kind: string): kind is PublicationKind {
  return kind === 'publication'
}
