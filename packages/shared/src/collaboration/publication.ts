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

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
]

export function redactForPublication(source: string): RedactionPreview {
  let preview = source
  let redactedCount = 0
  for (const pattern of SECRET_PATTERNS) {
    preview = preview.replace(pattern, () => {
      redactedCount += 1
      return '[redacted]'
    })
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
