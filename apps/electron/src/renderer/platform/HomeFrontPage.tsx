/**
 * Workbench Home Front Page — mode `home`.
 *
 * Composes existing objects (recent sessions, knowledge, new session, omnibox)
 * through URL / NavigationContext. Not a WorkGraph surface.
 */
import { useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, MessageSquare, Search, SquarePen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { MiniDashboardCards } from '@/components/app-shell/MiniDashboardCards'
import { QuestProgressCard } from '@/components/app-shell/QuestProgressCard'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useWorkspaceTaskCount } from '@/hooks/useWorkspaceTaskCount'
import { routes } from '@/lib/navigate'
import { getSessionTitle } from '@/utils/session'
import { isHomeSessionInWorkspace, pickRecentHomeSessions } from './home-model'
import { buildMiniDashboard } from './mini-dashboard'

export function HomeFrontPage() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspace = useActiveWorkspace()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const connectionState = useTransportConnectionState()
  const taskCount = useWorkspaceTaskCount(workspace?.id)

  const workspaceSessions = useMemo(() => {
    const workspaceId = workspace?.id
    const remoteWorkspaceId = workspace?.remoteServer?.remoteWorkspaceId
    return [...sessionMetaMap.values()].filter((session) =>
      isHomeSessionInWorkspace(session, workspaceId, remoteWorkspaceId),
    )
  }, [sessionMetaMap, workspace])

  const dashboard = useMemo(
    () =>
      buildMiniDashboard({
        sessions: workspaceSessions,
        tasks: taskCount,
        connection: connectionState,
      }),
    [workspaceSessions, taskCount, connectionState],
  )

  const recent = useMemo(() => pickRecentHomeSessions(workspaceSessions), [workspaceSessions])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
        <MiniDashboardCards snapshot={dashboard} className="grid-cols-2 sm:grid-cols-3" />
        <QuestProgressCard cloudFeaturesEnabled={true} className="px-0" />

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium text-foreground">{t('workbench.home.title')}</h1>
          {workspace?.name ? (
            <p className="text-sm text-muted-foreground">{workspace.name}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void navigate(routes.action.newSession())}
          >
            <SquarePen className="h-3.5 w-3.5" />
            {t('workbench.rail.create')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setOmniboxOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            {t('workbench.rail.search')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void navigate(routes.view.knowledge())}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('workbench.mode.knowledge')}
          </Button>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('workbench.home.recent')}
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('workbench.home.emptySessions')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {recent.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
                    onClick={() => void navigate(routes.view.allSessions(session.id))}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{getSessionTitle(session)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
