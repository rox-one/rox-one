/**
 * ShellSidebarNav — the legacy left sidebar's navigation block (WP3).
 *
 * AppShell builds the memoised base link list; this memoised child owns the
 * atom subscriptions only the sidebar reads (Developers / Playbooks flags and
 * the enabled extra screens), inserts those flag-gated entries, splits the
 * list into the primary mode rail and «Разделы приложения», and renders the
 * three LeftSidebar instances. A change to an atom the sidebar does not read
 * therefore re-renders neither this block nor its rows, and a change to one of
 * these atoms no longer re-renders the whole AppShell.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { devSpaceEnabledAtom } from '@/atoms/dev-space'
import { playbooksEnabledAtom } from '@/atoms/playbooks'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '@/pages/extra-screens/registry'
import {
  isDevelopersNavigation,
  isPlaybooksNavigation,
  useNavigationState,
} from '@/contexts/NavigationContext'
import { LeftSidebar, type LinkItem, type SidebarItem } from './LeftSidebar'
import { APP_NAV_DESTINATIONS_BY_ID } from './nav-destinations'

/**
 * A1: the left rail's primary navigation is exactly the ModeBar mode set
 * (CORE_MODES: home, chat, meetings, tasks, notes, feed, inbox) in mode order.
 * Every other sidebar entry moves into the collapsed «Разделы приложения».
 */
export const PRIMARY_MODE_LINK_IDS: readonly string[] = [
  'nav:home',
  'nav:allSessions',
  'nav:meetings',
  'nav:tasks',
  'nav:notes',
  'nav:feed',
  'nav:inbox',
]

/** WP4: experimental screen icon tints from colour tokens (were literal hex). */
const EXPERIMENTAL_ICON_COLOR: Readonly<Record<string, string>> = {
  radar: 'var(--accent)',
  focus: 'var(--success)',
}

/** The flag-gated Developers / Playbooks entries follow the Pages entry. */
const FLAG_LINKS_AFTER_ID = 'nav:pages'

export interface ShellSidebarNavProps {
  /** Memoised sidebar links without the flag-gated Developers / Playbooks entries. */
  baseLinks: SidebarItem[]
  isCollapsed: boolean
  onExpand: (link: LinkItem) => void
  applicationSectionsOpen: boolean
  onApplicationSectionsOpenChange: (open: boolean) => void
}

export const ShellSidebarNav = React.memo(function ShellSidebarNav({
  baseLinks,
  isCollapsed,
  onExpand,
  applicationSectionsOpen,
  onApplicationSectionsOpenChange,
}: ShellSidebarNavProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const devSpaceEnabled = useAtomValue(devSpaceEnabledAtom)
  const playbooksEnabled = useAtomValue(playbooksEnabledAtom)
  const enabledExtraScreenIds = useAtomValue(enabledExtraScreenIdsAtom)
  const developersActive = isDevelopersNavigation(navState)
  const playbooksActive = isPlaybooksNavigation(navState)

  const sidebarLinks = React.useMemo<SidebarItem[]>(() => {
    // Developers / Playbooks (2026-10-09 pack) — additive, flag-gated entries.
    // Presence, icon and label come from the single nav-destination registry.
    const flagLinks: SidebarItem[] = [
      ...(devSpaceEnabled ? [{
        id: 'nav:developers',
        title: t(APP_NAV_DESTINATIONS_BY_ID.developers.labelKey),
        icon: APP_NAV_DESTINATIONS_BY_ID.developers.icon,
        variant: developersActive ? 'default' as const : 'ghost' as const,
        onClick: () => navigate(routes.view.developers()),
      }] : []),
      ...(playbooksEnabled ? [{
        id: 'nav:playbooks',
        title: t(APP_NAV_DESTINATIONS_BY_ID.playbooks.labelKey),
        icon: APP_NAV_DESTINATIONS_BY_ID.playbooks.icon,
        variant: playbooksActive ? 'default' as const : 'ghost' as const,
        onClick: () => navigate(routes.view.playbooks()),
      }] : []),
    ]
    if (flagLinks.length === 0) return baseLinks
    const anchor = baseLinks.findIndex(link => link.id === FLAG_LINKS_AFTER_ID)
    const at = anchor >= 0 ? anchor + 1 : baseLinks.length
    return [...baseLinks.slice(0, at), ...flagLinks, ...baseLinks.slice(at)]
  }, [baseLinks, devSpaceEnabled, playbooksEnabled, developersActive, playbooksActive, t])

  const primaryModeLinks = React.useMemo(() => PRIMARY_MODE_LINK_IDS
    .map(id => sidebarLinks.find(link => link.id === id))
    .filter((link): link is SidebarItem => Boolean(link)), [sidebarLinks])
  const applicationSectionLinks = React.useMemo(
    () => sidebarLinks.filter(link => !PRIMARY_MODE_LINK_IDS.includes(link.id)),
    [sidebarLinks],
  )

  const activeScreen = navState.navigator === 'screen' ? navState.screen : null
  const experimentalLinks = React.useMemo<SidebarItem[]>(() => visibleExtraScreens(enabledExtraScreenIds).map(screen => ({
    id: `nav:screen:${screen.id}`,
    title: t(screen.labelKey), icon: screen.icon,
    variant: activeScreen === screen.id ? 'default' : 'ghost',
    onClick: () => navigate(routes.view.screen(screen.id)),
    iconColor: EXPERIMENTAL_ICON_COLOR[screen.id] ?? 'var(--info)',
  })), [enabledExtraScreenIds, activeScreen, t])

  return (
    <>
      {/* A1: primary rail = exactly the 7 mode destinations, one gray
            icon each (icons only when the rail is collapsed). */}
      <LeftSidebar
        isCollapsed={isCollapsed}
        onExpand={onExpand}
        links={primaryModeLinks}
      />
      {/* A1/A7-reachability: every other navigation destination
          stays reachable here, collapsed by default on every surface. */}
      <details
        className="group/application-sections mx-1 mt-2 rounded-[var(--radius-card)] bg-[var(--state-hover)]"
        data-application-sections
        open={applicationSectionsOpen}
        onToggle={event => onApplicationSectionsOpenChange(event.currentTarget.open)}
      >
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center rounded-[var(--radius-control)] outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
            isCollapsed
              ? 'mx-auto h-7 w-7 justify-center'
              : 'gap-2 px-3 py-2.5 text-xs font-semibold text-muted-foreground',
          )}
        >
          <Layers className="icon-caption text-accent" aria-hidden />
          {!isCollapsed && <span className="min-w-0 flex-1 truncate">{t('sidebar.applicationSections')}</span>}
          {!isCollapsed && <ChevronRight className="icon-caption transition-transform group-open/application-sections:rotate-90 motion-reduce:transition-none" aria-hidden />}
        </summary>
        <LeftSidebar
          isCollapsed={isCollapsed}
          onExpand={onExpand}
          links={applicationSectionLinks}
        />
        {experimentalLinks.length > 0 && (
          <section className="mx-1 mt-5 py-2" aria-label={t('sidebar.experimentalFeatures')}>
            {!isCollapsed && <div className="px-3 pb-2 text-xs font-semibold uppercase caps-label text-text-muted">{t('sidebar.experimentalFeatures')}</div>}
            <LeftSidebar isCollapsed={isCollapsed} onExpand={onExpand} links={experimentalLinks} />
          </section>
        )}
      </details>
    </>
  )
})
