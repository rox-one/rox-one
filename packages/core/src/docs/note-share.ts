/**
 * Docs step 6 — note sharing (narrow local slice).
 *
 * A note-scoped share record persisted next to the local vault
 * (`.rox/shares/<noteId>.json`). It models one share link with a permission
 * role (view vs edit). Local-only: the token is a random capability stored on
 * this device; there is no remote invite service and no realtime collab
 * (Yjs is step 7). Pure helpers — no IO.
 */

export const NOTE_SHARE_ROLES = ['view', 'edit'] as const

export type NoteShareRole = (typeof NOTE_SHARE_ROLES)[number]

export interface NoteShareLink {
  enabled: boolean
  role: NoteShareRole
  /** Random capability (base64url). Null until the link is first enabled. */
  token: string | null
  createdAt: number | null
}

export interface NoteShareState {
  schemaVersion: 1
  noteId: string
  link: NoteShareLink
  updatedAt: number
}

export interface NoteShareUpdate {
  enabled?: boolean
  role?: NoteShareRole
  /** Mint a fresh token (revokes the previous link). */
  regenerate?: boolean
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function isNoteShareRole(value: unknown): value is NoteShareRole {
  return typeof value === 'string' && (NOTE_SHARE_ROLES as readonly string[]).includes(value)
}

export function isNoteShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function defaultNoteShare(noteId: string, now = 0): NoteShareState {
  return {
    schemaVersion: 1,
    noteId,
    link: { enabled: false, role: 'view', token: null, createdAt: null },
    updatedAt: now,
  }
}

/** Parse an untrusted sidecar payload; anything malformed falls back to private. */
export function normalizeNoteShare(raw: unknown, noteId: string): NoteShareState {
  const fallback = defaultNoteShare(noteId)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const record = raw as Record<string, unknown>
  const link = record.link && typeof record.link === 'object' && !Array.isArray(record.link)
    ? record.link as Record<string, unknown>
    : {}
  const token = isNoteShareToken(link.token) ? link.token : null
  const createdAt = typeof link.createdAt === 'number' && Number.isFinite(link.createdAt) ? link.createdAt : null
  return {
    schemaVersion: 1,
    noteId,
    link: {
      // An enabled link without a valid token is not shareable: fail closed.
      enabled: link.enabled === true && token !== null,
      role: isNoteShareRole(link.role) ? link.role : 'view',
      token,
      createdAt: token ? createdAt : null,
    },
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  }
}

/**
 * Apply a share update. Enabling keeps an existing token (stable link) unless
 * `regenerate` is set; disabling keeps the token so re-enabling restores the
 * same link (mirrors `docs.set_public_sharing`).
 */
export function applyNoteShareUpdate(
  current: NoteShareState,
  update: NoteShareUpdate,
  mintToken: () => string,
  now: number,
): NoteShareState {
  if (update.role !== undefined && !isNoteShareRole(update.role)) throw new Error('Invalid share role')
  const enabled = update.enabled ?? current.link.enabled
  const role = update.role ?? current.link.role
  let token = current.link.token
  let createdAt = current.link.createdAt
  if ((enabled && !token) || update.regenerate) {
    const minted = mintToken()
    if (!isNoteShareToken(minted)) throw new Error('Invalid share token')
    token = minted
    createdAt = now
  }
  return { schemaVersion: 1, noteId: current.noteId, link: { enabled, role, token, createdAt }, updatedAt: now }
}

/** Local deep link for a shared note. Resolves only on devices with this vault. */
export function noteShareUrl(state: NoteShareState): string | null {
  if (!state.link.enabled || !state.link.token) return null
  const id = state.noteId.split('/').map(encodeURIComponent).join('/')
  return `rox://notes/note/${id}?share=${state.link.token}&role=${state.link.role}`
}
