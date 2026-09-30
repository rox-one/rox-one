/**
 * Team activity stream (team.activity.v1). Mountable in Лента → «Команда».
 * Shows events recorded on this device; teammates' events need an org server.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { TEAM_FLAG, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'
import { activityText, memberInitials, memberName, syncStatusText } from './team-labels'

export function TeamActivityFeed({ limit = 50 }: { limit?: number }) {
  const { t } = useTranslation()
  const enabled = useTeamFlag(TEAM_FLAG.activity)
  const state = useTeamState()
  const roster = useTeamRoster()
  if (!enabled) return null
  const events = state.activity.slice(0, limit)

  return (
    <div className="flex flex-col gap-1" data-testid="team-activity-feed">
      {events.length > 0 ? (
        <div role="status" className="px-1 text-xs text-muted-foreground">
          {t('teamCollab.sync.savedLocally')} · {syncStatusText(roster.sync, state.outbox.length, t)}
        </div>
      ) : null}
      {events.length === 0 ? (
        <div className="px-1 py-2 text-sm text-muted-foreground">{t('teamCollab.activityEmpty')}</div>
      ) : (
        events.map((e) => {
          const actor = memberName(roster.members, e.actorUserId, roster.selfUserId, t)
          return (
            <div key={e.id} className="flex items-center gap-2.5 px-1 py-1.5 text-sm">
              <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.1] text-[10px] font-semibold">
                {memberInitials(actor)}
              </span>
              <span className="min-w-0 flex-1 truncate">{activityText(e, roster.members, roster.selfUserId, t)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
            </div>
          )
        })
      )}
    </div>
  )
}
