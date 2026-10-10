/**
 * Last role-composition preset for the Podcast studio (С-14, v1.x N-agent lever).
 *
 * Renderer-local, mirroring `podcast-history.ts`: the durable contract lives in
 * `@rox/shared/voice`, this module only remembers the last 2..6 role list the
 * user composed. A stale, hand-edited or malformed preset degrades to the v1
 * two-voice default rather than surfacing a broken editor.
 */
import { MAX_PODCAST_ROLES, MIN_PODCAST_ROLES, isPodcastRoleId } from '@rox/shared/voice'
import type { PodcastRoleId } from '@rox/shared/voice'

export interface StudioRole {
  readonly id: PodcastRoleId
  readonly label: string
}

const STORAGE_KEY = 'rox.playbooks.podcastRoles.v1'

/** Host first (fixed), expert second — the v1 shape the editor starts from. */
export const DEFAULT_STUDIO_ROLES: readonly StudioRole[] = [
  { id: 'host', label: '' },
  { id: 'expert', label: '' },
]

export function loadRolePreset(): StudioRole[] {
  if (typeof localStorage === 'undefined') return [...DEFAULT_STUDIO_ROLES]
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return [...DEFAULT_STUDIO_ROLES]
    const roles = parsed.flatMap((entry): StudioRole[] => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      if (!isPodcastRoleId(record.id) || typeof record.label !== 'string') return []
      return [{ id: record.id, label: record.label }]
    })
    const ok = roles.length >= MIN_PODCAST_ROLES && roles.length <= MAX_PODCAST_ROLES
      && roles[0]!.id === 'host' && new Set(roles.map(role => role.id)).size === roles.length
    return ok ? roles : [...DEFAULT_STUDIO_ROLES]
  } catch {
    return [...DEFAULT_STUDIO_ROLES]
  }
}

export function saveRolePreset(roles: readonly StudioRole[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roles))
  } catch {
    /* quota/unavailable */
  }
}

/** First free `guestN` id, or null when the roster already holds six roles. */
export function nextGuestRoleId(roles: readonly StudioRole[]): PodcastRoleId | null {
  if (roles.length >= MAX_PODCAST_ROLES) return null
  for (let index = 1; index <= MAX_PODCAST_ROLES; index += 1) {
    const id = `guest${index}` as PodcastRoleId
    if (!roles.some(role => role.id === id)) return id
  }
  return null
}