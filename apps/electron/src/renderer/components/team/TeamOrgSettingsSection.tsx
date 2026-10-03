/** «Командная работа» block for Settings → Организации. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { TEAM_FLAG, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'
import { syncStatusText } from './team-labels'
import { TeamActivityFeed } from './TeamActivityFeed'
import { TeamInboxSection } from './TeamInboxSection'

export function TeamOrgSettingsSection() {
  const { t } = useTranslation()
  const roster = useTeamRoster()
  const state = useTeamState()
  const activityOn = useTeamFlag(TEAM_FLAG.activity)
  const mentionsOn = useTeamFlag(TEAM_FLAG.mentions)

  return (
    <SettingsSection title={t('teamCollab.settings.title')} description={t('teamCollab.settings.description')}>
      <SettingsCard>
        <div className="flex flex-col gap-4 p-3" data-testid="team-org-settings">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">{t('teamCollab.settings.sync')}</div>
            <div className="text-sm text-muted-foreground" role="status">{syncStatusText(roster.sync, state.outbox.length, t)}</div>
          </div>
          {roster.org ? (
            <div className="flex flex-col gap-0.5" data-authority={roster.identityAuthority}>
              <div className="text-sm font-medium">{t('teamCollab.settings.memberUsageTitle')}</div>
              <div className="text-sm text-muted-foreground" role="status">
                {t('teamCollab.settings.memberUsageUnavailable')}
              </div>
            </div>
          ) : null}
          {mentionsOn ? (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{t('teamCollab.settings.inbox')}</div>
              <TeamInboxSection />
            </div>
          ) : null}
          {activityOn ? (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{t('teamCollab.settings.activity')}</div>
              <TeamActivityFeed limit={20} />
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
