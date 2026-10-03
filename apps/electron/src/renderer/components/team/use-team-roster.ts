/**
 * Organization roster from the server-filtered org listing. Viewer identity
 * comes from that same membership-scoped response, never renderer preferences.
 */
import * as React from 'react'
import type { OrganizationWithMembers } from '@rox/shared/orgs'
import { createTeamSyncAdapter, type TeamMemberRef, type TeamSyncStatus } from '@rox/shared/team'

export interface TeamRoster {
  loading: boolean
  selfUserId: string | null
  identityAuthority: 'native' | 'local' | 'none'
  identityIssuer: string | null
  org: OrganizationWithMembers | null
  /** All real members of the active org (incl. self) */
  members: TeamMemberRef[]
  /** Members other than self */
  teammates: TeamMemberRef[]
  pendingInvites: number
  sync: TeamSyncStatus
}

export function toTeamMembers(org: OrganizationWithMembers | null): TeamMemberRef[] {
  if (!org) return []
  return org.members.map((m) => ({
    userId: m.userId,
    displayName: m.displayLabel || m.username || m.email || m.userId,
    ...(m.username ? { username: m.username } : {}),
    ...(m.email ? { email: m.email } : {}),
    role: m.role,
  }))
}

/** Select only an organization whose scoped response identifies its viewer as a member. */
export function pickActiveOrg(orgs: readonly OrganizationWithMembers[]): OrganizationWithMembers | null {
  return orgs.find((org) =>
    org.viewerUserId && org.members.some((member) => member.userId === org.viewerUserId),
  ) ?? null
}

export function useTeamRoster(): TeamRoster {
  const [state, setState] = React.useState<{ loading: boolean; orgs: OrganizationWithMembers[] }>({
    loading: true,
    orgs: [],
  })

  React.useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    const load = async () => {
      const version = ++requestVersion
      try {
        const orgs = await window.electronAPI.listOrganizations()
        if (!cancelled && version === requestVersion) {
          setState({ loading: false, orgs: Array.isArray(orgs) ? orgs : [] })
        }
      } catch {
        if (!cancelled && version === requestVersion) setState({ loading: false, orgs: [] })
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  return React.useMemo(() => {
    const org = pickActiveOrg(state.orgs)
    const selfUserId = org?.viewerUserId ?? null
    const identityAuthority = org?.viewerAuthority ?? 'none'
    const identityIssuer = identityAuthority === 'native' ? org?.viewerIssuer ?? null : null
    const members = toTeamMembers(org)
    return {
      loading: state.loading,
      selfUserId,
      identityAuthority,
      identityIssuer,
      org,
      members,
      teammates: members.filter((member) => member.userId !== selfUserId),
      pendingInvites: org?.pendingInvites.length ?? 0,
      sync: createTeamSyncAdapter({ orgId: org?.id ?? null }).status(),
    }
  }, [state])
}
