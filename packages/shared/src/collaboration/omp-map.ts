/**
 * OMP share/join/export/vibe verbs map onto native Rox surfaces.
 * Collaboration stays invite-based; publication remains a separate action.
 */

export const OMP_COLLAB_SURFACE_MAP = {
  share: 'inviteBro',
  join: 'joinBroInvite',
  export: 'exportSession',
  vibe: 'sessionPresence',
} as const

export type OmpCollabVerb = keyof typeof OMP_COLLAB_SURFACE_MAP

export function mapOmpCollabVerb(verb: string): (typeof OMP_COLLAB_SURFACE_MAP)[OmpCollabVerb] | null {
  if (verb in OMP_COLLAB_SURFACE_MAP) {
    return OMP_COLLAB_SURFACE_MAP[verb as OmpCollabVerb]
  }
  return null
}
