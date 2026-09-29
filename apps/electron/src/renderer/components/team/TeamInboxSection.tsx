/**
 * Mentions / handoffs / assignments / approval requests addressed to me
 * (team.mentions.v1). Mountable in «Входящие». Teammates' items arrive only
 * through an org server, so without one this renders an honest empty state.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { selectInboxForUser } from '@craft-agent/shared/team'
import { TEAM_FLAG, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'
import { memberName } from './team-labels'

export function TeamInboxSection() {
  const { t } = useTranslation()
  const enabled = useTeamFlag(TEAM_FLAG.mentions)
  const state = useTeamState()
  const roster = useTeamRoster()
  if (!enabled) return null
  const items = roster.selfUserId ? selectInboxForUser(state, roster.selfUserId) : []

  return (
    <div className="flex flex-col gap-1" data-testid="team-inbox-section">
      {items.length === 0 ? (
        <div className="px-1 py-2 text-sm text-muted-foreground">
          {roster.sync.state === 'connected' ? t('teamCollab.inboxEmpty') : t('teamCollab.inboxNeedsServer')}
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 px-1 py-1.5 text-sm">
            <span className="bg-foreground/[0.06] px-1.5 py-0.5 text-xs">{t(`teamCollab.inboxKind.${item.kind}`)}</span>
            <span className="font-medium">{memberName(roster.members, item.fromUserId, roster.selfUserId, t)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.text || item.target.title || ''}</span>
          </div>
        ))
      )}
    </div>
  )
}
