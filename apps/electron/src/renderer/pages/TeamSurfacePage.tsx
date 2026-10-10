/**
 * Команда surface page (W3.3, Согласованность-20261009).
 *
 * The empty `contacts` unified mode used to render only an empty state; the
 * real people live in the team roster. This page is the «Команда» home for the
 * `messenger` unified surface and reuses `components/team/*` — the roster
 * (`useTeamRoster`) plus the team collaboration block (`TeamOrgSettingsSection`,
 * which itself gates activity/inbox on their flags).
 */
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/mode-screen/ModeScreen'
import { TeamOrgSettingsSection, useTeamRoster } from '@/components/team'
import type { SurfacePageProps } from '@/platform/SurfaceHost'

export function TeamSurfacePage(_props: SurfacePageProps) {
  const { t } = useTranslation()
  const roster = useTeamRoster()

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background"
      data-testid="team-surface-page"
      data-surface="messenger"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
        <Users className="icon-inline text-text-muted" aria-hidden />
        <h1 className="text-title font-semibold">{t('teamCollab.title')}</h1>
      </header>

      <section aria-label={t('teamCollab.members')} className="shrink-0 px-4 py-3">
        <h2 className="mb-1 text-caption font-medium uppercase caps-label text-text-muted">
          {t('teamCollab.members')}
        </h2>
        {roster.loading ? (
          <p className="text-small text-text-secondary" role="status">{t('teamCollab.loading')}</p>
        ) : roster.members.length === 0 ? (
          <EmptyState title={t('teamCollab.empty.noOrg')} />
        ) : (
          <ul className="flex flex-col" data-testid="team-roster">
            {roster.members.map((member) => (
              <li
                key={member.userId}
                className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover"
                data-member-id={member.userId}
                data-member-role={member.role}
              >
                <span className="text-body">{member.displayName}</span>
                {member.userId === roster.selfUserId ? (
                  <span className="text-caption text-text-muted">{t('teamCollab.you')}</span>
                ) : null}
                {member.email ? (
                  <span className="ms-auto truncate text-caption text-text-muted">{member.email}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 pb-6" aria-label={t('teamCollab.settings.title')}>
        <TeamOrgSettingsSection />
      </section>
    </div>
  )
}

export default TeamSurfacePage