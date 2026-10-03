/**
 * «Команда» entry for the Входящие navigator (team.mentions.v1).
 * Counts real items addressed to me; with no org server the entry is muted
 * and opens Настройки → Организации, where the honest state is explained.
 */
import * as React from 'react'
import { selectInboxForUser } from '@rox/shared/team'
import { TEAM_FLAG, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'

export interface TeamInboxNavState {
  enabled: boolean
  count: number
  connected: boolean
}

export function useTeamInboxNav(): TeamInboxNavState {
  const enabled = useTeamFlag(TEAM_FLAG.mentions)
  const state = useTeamState()
  const roster = useTeamRoster()
  return React.useMemo(() => {
    const count = enabled && roster.selfUserId ? selectInboxForUser(state, roster.selfUserId).length : 0
    return { enabled, count, connected: roster.sync.state === 'connected' }
  }, [enabled, state, roster.selfUserId, roster.sync.state])
}
