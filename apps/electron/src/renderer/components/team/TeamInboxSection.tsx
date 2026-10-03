/**
 * Confirmed organization delivery only. Local outbox drafts never appear as
 * recipient inbox cards; offline delivery is reported elsewhere as pending.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { decideRecipientRequest, selectInboxForUser } from '@craft-agent/shared/team'
import { dispatchTeam, TEAM_FLAG, teamActionContext, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'
import { memberName } from './team-labels'
type OrgCallerIdentity = { userId: string; authority: 'native' | 'local' }
export function TeamInboxSection() {
  const { t } = useTranslation()
  const enabled = useTeamFlag(TEAM_FLAG.mentions)
  const state = useTeamState()
  const roster = useTeamRoster()
  const [callerIdentity, setCallerIdentity] = React.useState<OrgCallerIdentity | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void window.electronAPI.getOrgIdentity().then((identity) => {
      if (!cancelled) setCallerIdentity(identity as OrgCallerIdentity | null)
    }).catch(() => {
      if (!cancelled) setCallerIdentity(null)
    })
    return () => { cancelled = true }
  }, [])
  const selfUserId = callerIdentity?.authority === 'native' && roster.members.some((member) => member.userId === callerIdentity.userId)
    ? callerIdentity.userId
    : null
  if (!enabled) return null
  const items = roster.sync.state === 'connected' && selfUserId ? selectInboxForUser(state, selfUserId) : []
  return (
    <div className="flex flex-col gap-1" data-testid="team-inbox-section">
      {items.length === 0 ? (
        <div className="px-1 py-2 text-sm text-muted-foreground">
          {roster.sync.state === 'connected' && selfUserId ? t('teamCollab.inboxEmpty') : t('teamCollab.inboxNeedsServer')}
        </div>
      ) : (
        items.map((item) => {
          const request = item.requestId ? state.recipientRequests.find((candidate) => candidate.id === item.requestId) : undefined
          const canDecide = Boolean(request && selfUserId && request.recipientUserId === selfUserId)
          return (
            <div key={item.id} className="flex flex-col gap-1 px-1 py-1.5 text-sm" data-delivery={item.delivery}>
              <div className="flex items-center gap-2">
                <span className="bg-foreground/[0.06] px-1.5 py-0.5 text-xs">{t(`teamCollab.inboxKind.${item.kind}`)}</span>
                <span className="font-medium">{memberName(roster.members, item.fromUserId, selfUserId, t)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.target.title || item.target.id}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t('mindmap.comments.revision', { revision: item.target.revision })}
              </div>
              {item.pendingAction ? (
                <div className="text-xs text-muted-foreground">
                  {item.pendingActionSync === 'rejected' ? t('teamCollab.commentStatus.rejected') : t('teamCollab.decisionPending')}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canDecide}
                    className="rounded px-2 py-1 text-xs disabled:opacity-50"
                    title={!canDecide ? t('teamCollab.recipientIdentityUnavailable') : undefined}
                    onClick={() => {
                      if (!request || !selfUserId) return
                      dispatchTeam((current) => decideRecipientRequest(current, teamActionContext(selfUserId), request.id, 'accepted'))
                    }}
                  >
                    {t('teamCollab.recipientAccept')}
                  </button>
                  <button
                    type="button"
                    disabled={!canDecide}
                    className="rounded px-2 py-1 text-xs disabled:opacity-50"
                    title={!canDecide ? t('teamCollab.recipientIdentityUnavailable') : undefined}
                    onClick={() => {
                      if (!request || !selfUserId) return
                      dispatchTeam((current) => decideRecipientRequest(current, teamActionContext(selfUserId), request.id, 'rejected'))
                    }}
                  >
                    {t('teamCollab.recipientReject')}
                  </button>
                </div>
              )}
              {!canDecide ? <div className="text-xs text-destructive">{t('teamCollab.recipientIdentityUnavailable')}</div> : null}
            </div>
          )
        })
      )}
    </div>
  )
}
