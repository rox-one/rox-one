/**
 * MissionsRailGroup (G3 «Миссии» pilot) — the «Миссии» rail section mounted
 * above `CORE_MODES` in the ActivityRail.
 *
 * Flag-gated by `featureMissionsBoardV1Atom` (default OFF): it renders null
 * when the flag is off, so the rail is byte-identical to main. When on it adds
 * a «Миссии» row that opens the board, then up to 9 derived mission monograms
 * (the board is the full list) carrying the mission's status dot. All rows use
 * the shared `RailRow` primitive, so hover/focus/active/collapsed behaviour
 * matches every other rail row.
 *
 * Mounting the group also mirrors the flag into the shared route gate so the
 * `missions` navigator resolves (the rail is the only entry point).
 */
import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { featureMissionsBoardV1Atom } from '@/atoms/unified-shell'
import { deriveMissionsAtom, type MissionView } from '@/atoms/missions'
import { projectsAtom } from '@/atoms/projects'
import { setMissionsRoutesEnabled } from '../../shared/route-parser'
import { routes, type Route } from '../../shared/routes'
import { RailRow } from './RailRow'

const MISSION_DOT_CLASS: Record<MissionView['status'], string> = {
  active: 'bg-[var(--status-running)]',
  waiting: 'bg-[var(--status-warning)]',
  idle: 'bg-[var(--status-neutral)]',
}

/** Rail cap: the board shows every mission; the rail shows the first nine. */
const RAIL_MISSION_CAP = 9

/**
 * Builds the 16px monogram glyph for one mission: its initial plus a status
 * dot. `RailRow` renders the icon as `<Icon className=…/>`, so the component
 * carries its own sizing and ignores the passed class.
 */
function missionMonogram(initial: string, status: MissionView['status']) {
  function Monogram() {
    return (
      <span className="relative flex h-4 w-4 items-center justify-center text-caption font-bold uppercase">
        {initial}
        <span aria-hidden className={cn('absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full', MISSION_DOT_CLASS[status])} />
      </span>
    )
  }
  return Monogram
}

export function MissionsRailGroup({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const enabled = useAtomValue(featureMissionsBoardV1Atom)
  const missions = useAtomValue(deriveMissionsAtom)
  const projects = useAtomValue(projectsAtom)

  useEffect(() => {
    setMissionsRoutesEnabled(enabled)
  }, [enabled])

  if (!enabled) return null

  const nameById = new Map(projects.map((project) => [project.config.slug, project.config.name]))
  const activeMissionId = navState.navigator === 'missions' ? navState.details?.missionId ?? null : null
  const railMissions = missions.filter((mission) => mission.projectId !== null).slice(0, RAIL_MISSION_CAP)

  return (
    <div
      className={cn('mt-[12px] flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}
      role="group"
      aria-label={t('missions.rail.title')}
      data-testid="rail-missions"
    >
      <RailRow
        icon={Target}
        label={t('missions.rail.title')}
        collapsed={collapsed}
        active={navState.navigator === 'missions' && activeMissionId === null}
        onClick={() => void navigate(routes.view.missions() as Route)}
        testId="rail-missions-board"
      />
      {railMissions.map((mission) => {
        const name = nameById.get(mission.projectId as string) ?? mission.id
        return (
          <RailRow
            key={mission.id}
            icon={missionMonogram(name.slice(0, 1), mission.status)}
            label={name}
            tooltip={`${name} · ${t('missions.rail.open')}`}
            collapsed={collapsed}
            active={mission.id === activeMissionId}
            onClick={() => void navigate(routes.view.mission(mission.id) as Route)}
            testId={`rail-mission-${mission.id}`}
          />
        )
      })}
    </div>
  )
}