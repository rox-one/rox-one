/**
 * MissionBoard (G3 «Миссии» pilot) — the overview surface behind
 * `featureMissionsBoardV1Atom`.
 *
 * Read-only rollup: one row per derived mission (`deriveMissionsAtom`), each
 * showing the mission name, a status dot, the member sessions as lane chips
 * with their live state, and the counters. A lane chip opens that session on
 * the existing `allSessions/session/{id}` route. No writes, no persistence.
 *
 * Rendered by `MainContentPanel` for the `missions` navigator; also the
 * `missions-board` playground story. Keyboard reachable (every actionable row
 * is a native button); no animation (reduced-motion safe).
 */
import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { featureMissionsBoardV1Atom } from '@/atoms/unified-shell'
import { deriveMissionsAtom, NO_MISSION_ID, type MissionLane, type MissionView } from '@/atoms/missions'
import { projectsAtom } from '@/atoms/projects'
import { routes, type Route } from '../../shared/routes'

const LANE_DOT_CLASS: Record<MissionLane['state'], string> = {
  running: 'bg-[var(--status-running)]',
  waiting: 'bg-[var(--status-warning)]',
  error: 'bg-[var(--status-danger)]',
  idle: 'bg-[var(--status-neutral)]',
}

const MISSION_DOT_CLASS: Record<MissionView['status'], string> = {
  active: 'bg-[var(--status-running)]',
  waiting: 'bg-[var(--status-warning)]',
  idle: 'bg-[var(--status-neutral)]',
}

function statusLabelKey(status: MissionView['status']): string {
  return status === 'active' ? 'missions.status.active'
    : status === 'waiting' ? 'missions.status.waiting'
      : 'missions.status.idle'
}

export function MissionBoard() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const enabled = useAtomValue(featureMissionsBoardV1Atom)
  const missions = useAtomValue(deriveMissionsAtom)
  const projects = useAtomValue(projectsAtom)
  const selectedMissionId = navState.navigator === 'missions' ? navState.details?.missionId ?? null : null

  const missionNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const project of projects) names.set(project.config.slug, project.config.name)
    return names
  }, [projects])

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-body text-muted-foreground" data-missions-board="off">
        {t('missions.off')}
      </div>
    )
  }

  const title = t('missions.board.title')
  const subtitle = t('missions.board.subtitle', {
    missions: missions.filter((mission) => mission.projectId !== null).length,
    waiting: missions.reduce((sum, mission) => sum + mission.waiting, 0),
  })

  const openMission = (mission: MissionView) => {
    if (mission.projectId === null) return
    void navigate(routes.view.mission(mission.id) as Route)
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-missions-board="on">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-6 pb-8 pt-5">
        <header className="flex flex-col gap-0.5">
          <h1 className="text-title font-bold text-foreground">{title}</h1>
          <p className="text-small text-muted-foreground" data-missions-subtitle="">{subtitle}</p>
        </header>

        {missions.length === 0 ? (
          <div className="flex flex-col items-start gap-1 rounded-[var(--radius-card)] border border-border bg-card px-4 py-6" data-missions-empty="">
            <p className="text-body font-bold text-foreground">{t('missions.board.empty')}</p>
            <p className="text-small text-muted-foreground">{t('missions.board.emptyHint')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-missions-list="">
            {missions.map((mission) => (
              <li
                key={mission.id}
                data-mission-row={mission.id}
                data-active={mission.id === selectedMissionId || undefined}
                className={cn(
                  'flex min-h-[64px] flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-card px-3 py-2.5',
                  mission.id === selectedMissionId && 'ring-1 ring-accent',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', MISSION_DOT_CLASS[mission.status])} />
                  <button
                    type="button"
                    onClick={() => openMission(mission)}
                    disabled={mission.projectId === null}
                    aria-current={mission.id === selectedMissionId ? 'page' : undefined}
                    data-mission-name={mission.id}
                    className={cn(
                      'min-w-0 flex-1 truncate rounded-[var(--radius-control)] text-left text-body font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      mission.projectId === null
                        ? 'text-muted-foreground'
                        : 'text-foreground hover:underline',
                    )}
                  >
                    {mission.projectId === null
                      ? t('missions.board.noMission')
                      : missionNames.get(mission.projectId) ?? mission.name}
                  </button>
                  <span className="shrink-0 text-small text-muted-foreground">{t(statusLabelKey(mission.status))}</span>
                  <span className="shrink-0 text-small text-muted-foreground" data-mission-counts="">
                    {t('missions.count.sessions', { count: mission.laneCount })}
                    {mission.running > 0 ? ` · ${t('missions.count.running', { count: mission.running })}` : ''}
                    {mission.waiting > 0 ? ` · ${t('missions.count.waiting', { count: mission.waiting })}` : ''}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1" data-mission-lanes="">
                  {mission.lanes.map((lane) => (
                    <button
                      key={lane.sessionId}
                      type="button"
                      data-lane-chip={lane.sessionId}
                      title={lane.name}
                      onClick={() => void navigate(routes.view.allSessions(lane.sessionId) as Route)}
                      className="flex min-h-[var(--control-hit-min)] max-w-[184px] items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2 text-small text-foreground transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', LANE_DOT_CLASS[lane.state])} />
                      <span className="min-w-0 truncate">{lane.name}</span>
                    </button>
                  ))}
                  {mission.lanes.length === 0 ? (
                    <span className="text-small text-muted-foreground">{t('missions.board.noLanes')}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 text-small text-muted-foreground" data-missions-foot="">
          <Target aria-hidden className="icon-caption" />
          <span>{t('missions.board.hint')}</span>
        </div>
      </div>
    </div>
  )
}

/** Exported for tests: the id used by the unassigned bucket row. */
export { NO_MISSION_ID }