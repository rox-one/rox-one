import { useAtomValue, useSetAtom } from 'jotai'
import { Check, PanelsTopLeft, PanelTop } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom, panelStackAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { getSessionTitle } from '@/utils/session'
import { buildSurfaceTabViews } from '@/platform/surface-tab-model'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { TopBarButton } from '@/components/ui/TopBarButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { APP_NAV_DESTINATIONS, APP_NAV_DESTINATIONS_BY_ID } from './nav-destinations'
import {
  getActiveService,
  resolveCompactWorkspaceSelection,
  type CompactWorkspaceSelection,
} from './compact-workspace-navigation'

/** Always available in compact chrome, including a chat's custom header. */
export function CompactWorkspaceMenu({ onOpenBrowser }: { onOpenBrowser: () => void }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navigation = useNavigationState()
  const entries = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const activeService = getActiveService(navigation)
  const tabs = buildSurfaceTabViews({
    entries,
    focusedPanelId,
    resolveSessionTitle: (id) => {
      const session = sessionMetaMap.get(id)
      return session ? getSessionTitle(session) : null
    },
    labels: {
      untitled: t('surfaceTabs.untitled'),
      browser: t('surfaceTabs.browser'),
      panel: t('surfaceTabs.panel'),
      source: t('surfaceTabs.source'),
      settings: t('surfaceTabs.settings'),
      skills: t('surfaceTabs.skills'),
      knowledge: t('knowledge.nav.title'),
      knowledgeDiff: t('knowledge.diff.review'),
      home: t('surfaceTabs.home'),
    },
  })

  const activate = (selection: CompactWorkspaceSelection) => {
    const action = resolveCompactWorkspaceSelection(entries, focusedPanelId, selection)
    if (action?.kind === 'focus') setFocusedPanelId(action.panelId)
    else if (action?.kind === 'open-browser') onOpenBrowser()
    else if (action?.kind === 'navigate') void navigate(action.route)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TopBarButton
          aria-label={`${t('rail.title')} · ${t('surfaceTabs.panel')}`}
          data-compact-workspace-menu="true"
          className="h-9 w-9 shrink-0 focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <PanelsTopLeft className="size-4" aria-hidden />
        </TopBarButton>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent
        align="end"
        minWidth="min-w-60"
        className="max-h-[min(75dvh,600px)] max-w-[calc(100vw-24px)] overflow-y-auto"
      >
        {tabs.length > 0 && (
          <>
            <div role="group" aria-label={t('surfaceTabs.panel')}>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground" aria-hidden>
                {t('surfaceTabs.panel')}
              </div>
              {tabs.map((tab, index) => {
                const state = parseRouteToNavigationState(entries[index].route)
                const serviceId = state ? getActiveService(state) : null
                const service = serviceId ? APP_NAV_DESTINATIONS_BY_ID[serviceId] : null
                const Icon = service?.icon ?? PanelTop
                const title = tab.kind === null && service ? t(service.labelKey) : tab.title
                return (
                  <StyledDropdownMenuItem
                    key={tab.panelId}
                    data-compact-panel-id={tab.panelId}
                    aria-current={tab.focused ? 'page' : undefined}
                    onSelect={() => activate({ kind: 'panel', panelId: tab.panelId })}
                    className="min-h-9 [@media(pointer:coarse)]:min-h-11"
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    {tab.focused && <Check className="size-3.5 shrink-0" aria-hidden />}
                  </StyledDropdownMenuItem>
                )
              })}
            </div>
            <StyledDropdownMenuSeparator />
          </>
        )}
        <div role="group" aria-label={t('rail.title')}>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground" aria-hidden>
            {t('rail.title')}
          </div>
          {APP_NAV_DESTINATIONS.map((destination) => {
            const Icon = destination.icon
            return (
              <StyledDropdownMenuItem
                key={destination.id}
                data-service-id={destination.id}
                aria-current={destination.id === activeService ? 'page' : undefined}
                disabled={destination.route === null}
                onSelect={() => activate({ kind: 'service', serviceId: destination.id })}
                className="min-h-9 [@media(pointer:coarse)]:min-h-11"
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{t(destination.labelKey)}</span>
                {destination.id === activeService && <Check className="size-3.5 shrink-0" aria-hidden />}
              </StyledDropdownMenuItem>
            )
          })}
        </div>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
