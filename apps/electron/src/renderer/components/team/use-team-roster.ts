/**
 * Real organization roster for team features. Never invents people: members
 * come from orgs.listOrganizations(); no org → empty roster + honest state.
 */
import * as React from 'react'
import type { OrganizationWithMembers } from '@craft-agent/shared/orgs'
import { createTeamSyncAdapter, type TeamMemberRef, type TeamSyncStatus } from '@craft-agent/shared/team'

export interface TeamRoster {
  loading: boolean
  selfUserId: string | null
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

/** Prefer an org the local user belongs to; stable by creation order. */
export function pickActiveOrg(orgs: readonly OrganizationWithMembers[], selfUserId: string | null): OrganizationWithMembers | null {
  if (!selfUserId) return orgs[0] ?? null
  return orgs.find((o) => o.members.some((m) => m.userId === selfUserId)) ?? orgs[0] ?? null
}

export function useTeamRoster(): TeamRoster {
  const [state, setState] = React.useState<{ loading: boolean; orgs: OrganizationWithMembers[]; selfUserId: string | null }>({
    loading: true,
    orgs: [],
    selfUserId: null,
  })

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const api = window.electronAPI
        const [orgs, identity] = await Promise.all([
          api.listOrganizations().catch(() => [] as OrganizationWithMembers[]),
          api.getOrgIdentity().catch(() => null),
        ])
        if (!cancelled) setState({ loading: false, orgs: Array.isArray(orgs) ? orgs : [], selfUserId: identity?.userId ?? null })
      } catch {
        if (!cancelled) setState({ loading: false, orgs: [], selfUserId: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return React.useMemo(() => {
    const org = pickActiveOrg(state.orgs, state.selfUserId)
    const members = toTeamMembers(org)
    return {
      loading: state.loading,
      selfUserId: state.selfUserId,
      org,
      members,
      teammates: members.filter((m) => m.userId !== state.selfUserId),
      pendingInvites: org?.pendingInvites.length ?? 0,
      sync: createTeamSyncAdapter({ orgId: org?.id ?? null }).status(),
    }
  }, [state])
}
