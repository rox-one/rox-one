/**
 * Primary rail (shell-layout): a static 56 px icon column. Pinned screens on
 * top, «⋯» popover with every other screen (icon + label + pin toggle),
 * the sidebar toggle and the profile avatar at the bottom (Settings lives in the
 * avatar popover, no gear). Hover tooltips, active highlight,
 * unread dot. Arrow keys move between rail buttons (roving tabindex).
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pin, PinOff, PanelLeft } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import { useNavigationState } from '@/contexts/NavigationContext'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '@/pages/extra-screens/registry'
import { usePillNav } from '@/platform/usePillNav'
import { useOpenPillBrowser } from '@/platform/pill-activate'
import { useShellModes } from '@/platform/useModes'
import type { NavigationState } from '../../../shared/types'
import { buildRailModel, type RailScreen } from './rail-model'
import { toggleRailPin, toggleSecondarySidebar, useRailPins, useSecondarySidebarVisibility, useUnreadCounts } from './shell-prefs'
import { openScreenPanelAtom } from './panel-strip'
import { setKnownScreenIds } from './screen-sidebar'

export const SHELL_RAIL_WIDTH = 56

export function isRailScreenActive(screen: RailScreen, navState: NavigationState): boolean {
  if (screen.extra) return navState.navigator === 'screen' && navState.screen === screen.extra.id
  try {
    return screen.entry ? screen.entry.isActive(navState) : false
  } catch {
    return false
  }
}

export function useActivateScreen(): (screen: RailScreen) => void {
  const openBrowser = useOpenPillBrowser()
  const openScreen = useSetAtom(openScreenPanelAtom)
  return React.useCallback((screen: RailScreen) => {
    if (screen.disabled) return
    // Panel strip: a screen opens as its own panel on the left (or focuses the
    // panel already showing it); in-screen navigation stays on navigate().
    if (screen.extra) { openScreen({ route: routes.view.screen(screen.extra.id) }); return }
    const entry = screen.entry
    if (!entry) return
    if (entry.action === 'open-browser') { openBrowser(); return }
    if (entry.route) openScreen({ route: entry.route() })
  }, [openBrowser, openScreen])
}

/** Rail screens for the current flags/placements/pins (shared with the pills configurator). */
export function useRailModel() {
  const { t } = useTranslation()
  const { shellFlags } = useShellModes()
  const nav = usePillNav(shellFlags)
  const enabledExtra = useAtomValue(enabledExtraScreenIdsAtom)
  const pins = useRailPins()
  const extraScreens = React.useMemo(() => visibleExtraScreens(enabledExtra), [enabledExtra])
  // Register valid screen ids so useScreenSidebar can warn (dev) on a mismatched screenId.
  React.useEffect(() => {
    setKnownScreenIds([...nav.surfaces.map((entry) => entry.id), ...extraScreens.map((screen) => screen.id)])
  }, [nav.surfaces, extraScreens])
  return React.useMemo(() => buildRailModel({
    surfaces: nav.surfaces,
    extraScreens,
    pins,
    t,
  }), [nav.surfaces, extraScreens, pins, t])
}

interface RailButtonProps {
  screen: RailScreen
  active: boolean
  unread: number
  onActivate: (screen: RailScreen) => void
}

const RailButton = React.memo(function RailButton({ screen, active, unread, onActivate }: RailButtonProps) {
  const { t } = useTranslation()
  const Icon = screen.icon
  const label = unread > 0 ? t('shell.rail.labelUnread', { name: screen.title, count: unread }) : screen.title
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-rail-item={screen.id}
          data-rail-button=""
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          aria-disabled={screen.disabled || undefined}
          onClick={() => onActivate(screen)}
          className={cn(
            'relative flex size-10 items-center justify-center rounded-[var(--radius-control)] outline-none focus-visible:ring-1 focus-visible:ring-ring',
            active ? 'bg-[var(--state-selected)] text-foreground' : 'text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground',
            screen.disabled && 'opacity-50',
          )}
        >
          <Icon className="icon-rail" aria-hidden />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" data-rail-unread="" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{screen.title}</TooltipContent>
    </Tooltip>
  )
})

const railButtonKey = (button: HTMLElement): string =>
  button.dataset.railItem ?? (button.hasAttribute('data-rail-more') ? '__more' : button.hasAttribute('data-rail-toggle-sidebar') ? '__sidebar' : '')

/**
 * Roving tabindex: exactly one rail button is in the Tab order (the last
 * focused one, else the active screen, else the first); arrows move within.
 */
function applyRovingTabIndex(root: HTMLElement | null, rovingKey: string | null): void {
  if (!root) return
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-button]'))
  if (!buttons.length) return
  const current = (rovingKey !== null ? buttons.find((button) => railButtonKey(button) === rovingKey) : undefined)
    ?? buttons.find((button) => button.getAttribute('aria-current') === 'page')
    ?? buttons[0]
  for (const button of buttons) button.tabIndex = button === current ? 0 : -1
}

function onRovingKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-rail-button]'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

export interface PrimaryRailProps {
  /** Avatar / account control rendered at the very bottom. */
  avatar?: React.ReactNode
  /** Hide the second-sidebar toggle (Главная has no second sidebar). */
  secondaryAvailable: boolean
}

export const PrimaryRail = React.memo(function PrimaryRail({ avatar, secondaryAvailable }: PrimaryRailProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const model = useRailModel()
  const unread = useUnreadCounts()
  const activate = useActivateScreen()
  const secondary = useSecondarySidebarVisibility()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const overflowActive = model.overflow.some((screen) => isRailScreenActive(screen, navState))
  const overflowUnread = model.overflow.some((screen) => (unread[screen.id] ?? 0) > 0)
  const navRef = React.useRef<HTMLElement>(null)
  const rovingKeyRef = React.useRef<string | null>(null)
  // Re-apply after every render: buttons come and go with pins/flags.
  React.useLayoutEffect(() => { applyRovingTabIndex(navRef.current, rovingKeyRef.current) })
  const onRailFocus = React.useCallback((event: React.FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (!target.hasAttribute('data-rail-button')) return
    rovingKeyRef.current = railButtonKey(target)
    applyRovingTabIndex(navRef.current, rovingKeyRef.current)
  }, [])

  return (
    <nav
      aria-label={t('shell.rail.label')}
      data-primary-rail=""
      data-tour="guide.primary-rail"
      ref={navRef}
      onKeyDown={onRovingKeyDown}
      onFocus={onRailFocus}
      style={{ width: SHELL_RAIL_WIDTH }}
      className="flex h-full shrink-0 flex-col items-center gap-1 py-2"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto" data-rail-pinned="">
        {model.pinned.map((screen) => (
          <RailButton key={screen.id} screen={screen} active={isRailScreenActive(screen, navState)} unread={unread[screen.id] ?? 0} onActivate={activate} />
        ))}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-rail-button=""
                  data-rail-more=""
                  aria-label={t('shell.rail.more')}
                  aria-haspopup="dialog"
                  className={cn(
                    'relative flex size-10 items-center justify-center rounded-[var(--radius-control)] outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    overflowActive ? 'bg-[var(--state-selected)] text-foreground' : 'text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground',
                  )}
                >
                  <MoreHorizontal className="icon-rail" aria-hidden />
                  {overflowUnread && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" aria-hidden />}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{t('shell.rail.more')}</TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-64 p-1" data-rail-more-menu="">
            <RailMoreList
              screens={[...model.pinned, ...model.overflow]}
              pinnedIds={new Set(model.pinned.map((screen) => screen.id))}
              navState={navState}
              unread={unread}
              onActivate={(screen) => { setMoreOpen(false); activate(screen) }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-col items-center gap-1" data-rail-bottom="">
        {secondaryAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-rail-button=""
                data-rail-toggle-sidebar=""
                aria-label={secondary === 'hidden' ? t('shell.rail.showSidebar') : t('shell.rail.hideSidebar')}
                aria-pressed={secondary !== 'hidden'}
                onClick={toggleSecondarySidebar}
                className="flex size-10 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground outline-none hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                <PanelLeft className="icon-rail" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{secondary === 'hidden' ? t('shell.rail.showSidebar') : t('shell.rail.hideSidebar')}</TooltipContent>
          </Tooltip>
        )}
        {/* No gear: Settings opens only from the avatar's profile popover (Mark's decision). */}
        {avatar}
      </div>
    </nav>
  )
})

/** «⋯» list: every screen (pinned first), icon + label, pin toggle per row. */
export function RailMoreList({ screens, pinnedIds, navState, unread, onActivate }: {
  screens: readonly RailScreen[]
  pinnedIds: ReadonlySet<string>
  navState: NavigationState
  unread: Readonly<Record<string, number>>
  onActivate: (screen: RailScreen) => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex max-h-[70vh] flex-col overflow-y-auto" aria-label={t('shell.rail.allScreens')}>
      {screens.map((screen) => {
        const Icon = screen.icon
        const pinned = pinnedIds.has(screen.id)
        const active = isRailScreenActive(screen, navState)
        return (
          <li key={screen.id} className="flex items-center gap-1" data-rail-more-item={screen.id}>
            <button
              type="button"
              disabled={screen.disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => onActivate(screen)}
              className={cn(
                'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
                active ? 'bg-[var(--state-selected)] font-medium' : 'hover:bg-[var(--state-hover)]',
              )}
            >
              <Icon className="icon-caption shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{screen.title}</span>
              {(unread[screen.id] ?? 0) > 0 && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
            </button>
            <button
              type="button"
              aria-pressed={pinned}
              aria-label={pinned ? t('shell.rail.unpin', { name: screen.title }) : t('shell.rail.pin', { name: screen.title })}
              onClick={() => toggleRailPin(screen.id)}
              data-rail-pin-toggle={screen.id}
              className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground outline-none hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              {pinned ? <PinOff className="icon-caption" aria-hidden /> : <Pin className="icon-caption" aria-hidden />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
