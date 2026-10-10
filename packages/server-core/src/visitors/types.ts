/**
 * Visitor-access domain types (port-matrix row a1.6, production half).
 *
 * A visitor is an external identity granted time-boxed access: an email address
 * or a GitHub account id. Grants live in the {@link VisitorGrantStore}, are
 * enforced by the `visitor-access` access-policy plugin, and are managed by the
 * `visitor_invite` / `visitor_revoke` / `visitor_list` agent tools.
 *
 * The store key is `email:<lowercased>` or `github:<accountId>` — the same
 * canonical form the plugin derives from an authenticated principal subject, so
 * a role that names the plugin admits exactly the subjects that hold a live
 * grant and refuses every other subject (fail-closed).
 */

/** A visitor identity: an email address or a GitHub account id. */
export type VisitorSubject =
  | { readonly kind: 'email'; readonly email: string }
  | { readonly kind: 'github'; readonly accountId: string }

/** A single time-boxed visitor grant. */
export interface VisitorGrant {
  /** Canonical store key: `email:<lowercased>` or `github:<accountId>`. */
  readonly key: string
  readonly subject: VisitorSubject
  readonly createdAt: number
  /** Epoch ms the grant stops admitting. */
  readonly expiresAt: number
  /** Principal subject of the operator that granted access; null = bootstrap. */
  readonly invitedBy: string | null
  readonly note: string | null
}

/**
 * Typed refusals. Every store/service/tool failure maps onto one of these so
 * callers never have to parse prose.
 */
export type VisitorRefusalCode =
  | 'VISITOR_SUBJECT_INVALID'
  | 'VISITOR_GRANT_NOT_FOUND'
  | 'VISITOR_GRANT_EXPIRED'
  | 'VISITOR_PROVIDER_NOT_CONFIGURED'
  | 'VISITOR_STORE_UNAVAILABLE'

export type VisitorInviteResult =
  | { readonly ok: true; readonly grant: VisitorGrant; readonly replaced: boolean }
  | { readonly ok: false; readonly code: VisitorRefusalCode; readonly message: string }

export type VisitorRevokeResult =
  | { readonly ok: true; readonly grant: VisitorGrant }
  | { readonly ok: false; readonly code: VisitorRefusalCode; readonly message: string }

/** One entry in the service's mutation audit trail (order = call order). */
export interface VisitorAuditEntry {
  readonly seq: number
  readonly op: 'invite' | 'revoke'
  readonly key: string
  readonly at: number
}

/** Typed error thrown by the store when a subject cannot be canonicalized. */
export class VisitorSubjectError extends Error {
  readonly code: VisitorRefusalCode = 'VISITOR_SUBJECT_INVALID'

  constructor(message = 'Invalid visitor subject') {
    super(message)
    this.name = 'VisitorSubjectError'
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Canonical store key for a visitor subject. Throws on an unusable subject. */
export function visitorKey(subject: VisitorSubject): string {
  if (!subject || (subject.kind !== 'email' && subject.kind !== 'github')) {
    throw new VisitorSubjectError('Visitor subject must be an email or a github account')
  }
  if (subject.kind === 'email') {
    const email = normalizeEmail(subject.email)
    if (!email || !email.includes('@') || email.length > 320) {
      throw new VisitorSubjectError('Visitor email must be a non-empty address')
    }
    return `email:${email}`
  }
  const accountId = subject.accountId.trim()
  if (!accountId || accountId.length > 128) {
    throw new VisitorSubjectError('Visitor GitHub account id must be non-empty')
  }
  return `github:${accountId}`
}

/** Normalize a subject into its stored form (email lowercased, ids trimmed). */
export function normalizeSubject(subject: VisitorSubject): VisitorSubject {
  visitorKey(subject)
  return subject.kind === 'email'
    ? { kind: 'email', email: normalizeEmail(subject.email) }
    : { kind: 'github', accountId: subject.accountId.trim() }
}

/**
 * Map an authenticated principal subject onto a visitor identity.
 *
 * Only the two forms a Cloudflare Access / GitHub identity actually produces are
 * accepted: an email address, or an explicit `github:<accountId>` subject. Every
 * other opaque subject returns null, which the plugin renders as a refusal.
 */
export function visitorSubjectFromPrincipal(subject: string | null | undefined): VisitorSubject | null {
  if (typeof subject !== 'string') return null
  const value = subject.trim()
  if (!value) return null
  if (value.includes('@')) return { kind: 'email', email: value }
  const github = /^github:(.+)$/i.exec(value)
  if (github && github[1].trim()) return { kind: 'github', accountId: github[1].trim() }
  return null
}

/** Human-readable label for a grant (tool output). */
export function visitorSubjectLabel(subject: VisitorSubject): string {
  return subject.kind === 'email' ? subject.email : `github:${subject.accountId}`
}