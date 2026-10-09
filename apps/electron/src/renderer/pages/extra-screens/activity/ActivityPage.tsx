/**
 * «Активность» — session analytics for the active workspace: a summary strip,
 * a year heatmap, daily/weekly trends and the top projects/sources by activity.
 *
 * Data comes from existing renderer sources only — the session metadata atom
 * (`useWorkspaceSessions`), the project catalog atom and the shared pure
 * session helpers. Nothing here calls a bespoke RPC. When the workspace has no
 * sessions yet the screen shows one concrete next action instead of empty math.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { localDayKey } from '@rox/shared/sessions/collection'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { projectsAtom } from '@/atoms/projects'
import { useWorkspaceSessions } from '@/lib/extra-screens/use-rox-sources'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { Card, EmptyState, ScreenButton, ScreenColumn, ScreenDetail, ScreenHeader, ScreenRoot, SectionLabel } from '../ui'
import { ActivityHeatmap } from './ActivityHeatmap'
import {
  activityTotals,
  dailyTrend,
  formatCompactCount,
  sessionsInWindow,
  topProjects,
  topSources,
  weeklyTrend,
  type ActivityTrendPoint,
} from './activity-model'

const DAYS = 30
const WEEKS = 12

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-foreground/[0.04] px-2.5 py-2" title={hint}>
      <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tabular-nums leading-none">{value}</div>
    </div>
  )
}

/** One trend series as focusable columns; keyboard users get the same readout. */
function TrendBars({
  points,
  locale,
  label,
  onSelectDay,
  selectedKey,
}: {
  points: readonly ActivityTrendPoint[]
  locale: string
  label: string
  onSelectDay?: (key: string) => void
  selectedKey?: string
}) {
  const { t } = useTranslation()
  const max = points.reduce((peak, point) => Math.max(peak, point.sessions), 0)
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div
        className="flex h-[96px] items-end gap-[2px] overflow-x-auto pb-1"
        role="group"
        aria-label={label}
      >
        {points.map((point) => {
          const date = new Date(point.startAt)
          const shortLabel = t('extraScreens.activity.barLabel', {
            date: date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
            sessions: point.sessions,
            messages: point.messages,
          })
          const height = max > 0 ? Math.max(2, Math.round((point.sessions / max) * 88)) : 2
          const selected = selectedKey === point.key
          return (
            <button
              key={point.key}
              type="button"
              title={shortLabel}
              aria-label={shortLabel}
              aria-pressed={onSelectDay ? selected : undefined}
              onClick={() => onSelectDay?.(point.key)}
              className={cn(
                'flex h-full w-2.5 shrink-0 items-end rounded-[var(--radius-control)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground',
                point.sessions > 0 ? 'bg-accent/70' : 'bg-foreground/10',
                selected && 'ring-1 ring-foreground',
              )}
            >
              <span className="w-full rounded-[var(--radius-control)] bg-accent" style={{ height }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ActivityPage(_props: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const now = Date.now()

  const sessions = useWorkspaceSessions(workspaceId)
  const projects = useAtomValue(projectsAtom)
  const projectNames = React.useMemo(
    () => projects.map((project) => ({ id: project.config.id, name: project.config.name })),
    [projects],
  )

  const [focusKey, setFocusKey] = React.useState(() => localDayKey(Date.now()))

  const totals = React.useMemo(() => activityTotals(sessions), [sessions])
  const recent = React.useMemo(
    () => activityTotals(sessionsInWindow(sessions, now - DAYS * 86_400_000, now)),
    [sessions, now],
  )
  const days = React.useMemo(() => dailyTrend(sessions, now, DAYS), [sessions, now])
  const weeks = React.useMemo(() => weeklyTrend(sessions, now, WEEKS), [sessions, now])
  const activeDays = days.filter((point) => point.sessions > 0).length
  const projectsTop = React.useMemo(() => topProjects(sessions, projectNames, 5), [sessions, projectNames])
  const sourcesTop = React.useMemo(() => topSources(sessions, 5), [sessions])

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(240px, 30%, 320px)">
        <ScreenHeader
          title={t('extraScreens.activity.title')}
          subtitle={t('extraScreens.activity.subtitle', { days: DAYS })}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {totals.sessions === 0 ? null : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label={t('extraScreens.activity.totalSessions')} value={formatCompactCount(totals.sessions)} />
                <StatTile label={t('extraScreens.activity.totalMessages')} value={formatCompactCount(totals.messages)} />
                <StatTile label={t('extraScreens.activity.totalTokens')} value={formatCompactCount(totals.tokens)} />
                <StatTile
                  label={t('extraScreens.activity.activeDays', { days: DAYS })}
                  value={String(activeDays)}
                />
                <StatTile label={t('extraScreens.activity.totalToolCalls')} value={formatCompactCount(totals.toolCalls)} />
                <StatTile label={t('extraScreens.activity.totalCommits')} value={formatCompactCount(totals.commits)} />
              </div>

              <Card>
                <div className="text-[12px] text-muted-foreground">
                  {t('extraScreens.activity.recentSummary', {
                    days: DAYS,
                    sessions: recent.sessions,
                    messages: recent.messages,
                  })}
                </div>
              </Card>

              <div className="mt-5">
                <SectionLabel>{t('extraScreens.activity.topProjects')}</SectionLabel>
                {projectsTop.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground">{t('extraScreens.activity.noProjects')}</div>
                ) : (
                  projectsTop.map((project) => (
                    <div key={project.id} className="flex items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate" title={project.name}>{project.name}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {t('extraScreens.activity.projectCount', { sessions: project.sessions })}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-5">
                <SectionLabel>{t('extraScreens.activity.topSources')}</SectionLabel>
                {sourcesTop.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground">{t('extraScreens.activity.noSources')}</div>
                ) : (
                  sourcesTop.map((source) => (
                    <div key={source.family} className="flex items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate">{t(`collection.filter.agentFamily.${source.family}`)}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {t('extraScreens.activity.projectCount', { sessions: source.sessions })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </ScreenColumn>

      <ScreenDetail>
        {totals.sessions === 0 ? (
          <EmptyState
            title={t('extraScreens.activity.emptyTitle')}
            body={t('extraScreens.activity.emptyBody')}
            action={
              <ScreenButton variant="primary" onClick={() => navigate(routes.view.allSessions())}>
                {t('extraScreens.activity.openSessions')}
              </ScreenButton>
            }
          />
        ) : (
          <div className="min-w-0 max-w-[900px]">
            <ActivityHeatmap
              sessions={sessions}
              now={now}
              locale={i18n.language}
              focusKey={focusKey}
              onFocusKeyChange={setFocusKey}
            />
            <Card>
              <TrendBars
                points={days}
                locale={i18n.language}
                label={t('extraScreens.activity.dailyTrend', { days: DAYS })}
                selectedKey={focusKey}
                onSelectDay={setFocusKey}
              />
            </Card>
            <Card>
              <TrendBars points={weeks} locale={i18n.language} label={t('extraScreens.activity.weeklyTrend', { weeks: WEEKS })} />
            </Card>
          </div>
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}