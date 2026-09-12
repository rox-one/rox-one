/**
 * Collaborator invites for “Позвать Бро”.
 *
 * Distinct from public publication (shareToViewer). Invite URLs follow
 * `https://bro.rox.one/@{username}/{sessionId}/{joinKey}` with one-time,
 * expiry, role and revocation semantics.
 */

export const BRO_INVITE_HOST = 'bro.rox.one'
export const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000

export type CollaboratorRole = 'owner' | 'editor' | 'viewer'

export interface RoxAccount {
  accountId: string
  username: string
  displayName: string
}

export interface BroInvite {
  sessionId: string
  ownerAccountId: string
  ownerUsername: string
  joinKey: string
  role: Exclude<CollaboratorRole, 'owner'>
  createdAt: number
  expiresAt: number
  usedAt?: number
  revokedAt?: number
}

export interface BroInviteCard {
  kind: 'collaboration'
  url: string
  sessionId: string
  role: Exclude<CollaboratorRole, 'owner'>
  expiresAt: number
  qrPayload: string
  contactShareText: string
}

export type JoinDenial = 'expired' | 'revoked' | 'reused' | 'membership_required' | 'invalid'

export type JoinResult =
  | { ok: true; sessionId: string; role: Exclude<CollaboratorRole, 'owner'>; accountId: string }
  | { ok: false; error: JoinDenial }

const JOIN_KEY_RE = /^[a-f0-9]{32}$/
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/

export function slugifyUsername(raw: string): string {
  const trimmed = raw.trim().split('@')[0] ?? ''
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'user'
}

export function buildInviteUrl(username: string, sessionId: string, joinKey: string): string {
  const user = slugifyUsername(username)
  return `https://${BRO_INVITE_HOST}/@${user}/${sessionId}/${joinKey}`
}

export function parseInviteUrl(url: string): {
  username: string
  sessionId: string
  joinKey: string
} | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    if (parsed.hostname !== BRO_INVITE_HOST) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length !== 3) return null
    const userPart = parts[0]
    const sessionId = parts[1]
    const joinKey = parts[2]
    if (!userPart?.startsWith('@') || sessionId == null || joinKey == null) return null
    const username = userPart.slice(1)
    if (!USERNAME_RE.test(username) || !SESSION_ID_RE.test(sessionId) || !JOIN_KEY_RE.test(joinKey)) {
      return null
    }
    return { username, sessionId, joinKey }
  } catch {
    return null
  }
}

export function mintJoinKey(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(16)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function buildInviteCard(invite: BroInvite): BroInviteCard {
  const url = buildInviteUrl(invite.ownerUsername, invite.sessionId, invite.joinKey)
  return {
    kind: 'collaboration',
    url,
    sessionId: invite.sessionId,
    role: invite.role,
    expiresAt: invite.expiresAt,
    qrPayload: url,
    contactShareText: `bro ${url}`,
  }
}

export function inviteStatus(
  invite: BroInvite,
  now: number,
): 'active' | 'expired' | 'revoked' | 'reused' {
  if (invite.revokedAt != null) return 'revoked'
  if (invite.usedAt != null) return 'reused'
  if (now >= invite.expiresAt) return 'expired'
  return 'active'
}
