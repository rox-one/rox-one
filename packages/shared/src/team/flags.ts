/** Team feature flags. Default ON; overrides are a plain id→boolean map. */
export const TEAM_FLAG = {
  presence: 'team.presence.v1',
  mentions: 'team.mentions.v1',
  assign: 'team.assign.v1',
  comments: 'team.comments.v1',
  handoff: 'team.handoff.v1',
  sharing: 'team.sharing.v1',
  activity: 'team.activity.v1',
  approvals: 'team.approvals.v1',
} as const

export type TeamFlagId = (typeof TEAM_FLAG)[keyof typeof TEAM_FLAG]

export const TEAM_FLAG_DEFAULTS: Readonly<Record<TeamFlagId, boolean>> = Object.freeze(
  Object.fromEntries(Object.values(TEAM_FLAG).map((id) => [id, true])) as Record<TeamFlagId, boolean>,
)

export function isTeamFlagEnabled(
  id: TeamFlagId,
  overrides?: Partial<Record<string, unknown>> | null,
): boolean {
  const v = overrides?.[id]
  if (typeof v === 'boolean') return v
  return TEAM_FLAG_DEFAULTS[id] ?? false
}

export function parseTeamFlagOverrides(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k.startsWith('team.') && typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}
