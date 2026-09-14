/**
 * TopBar - Persistent top bar above all panels (Slack-style)
 *
 * Layout: [Sidebar] [Menu] [Back] [Forward] [Workspace selector] ... [Browser strip] [Session] [Browser] [Help]
 *
 * Fixed at top of window; height from --topbar-height (design-compact: 40px desktop).
 * macOS: offset left to avoid stoplight controls.
 */

import { useTranslation } from "react-i18next"
import * as Icons from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { TopBarButton } from "../ui/TopBarButton"
import { cn } from "@/lib/utils"
import { isMac, isWebUI } from "@/lib/platform"
import { zenTopBarSafeLeftPx } from "./zen-topbar-safe-area"
import { useActionLabel } from "@/actions"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import type { SettingsMenuItem } from "../../../shared/menu-schema"
import { useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { BrowserTabStrip } from "../browser/BrowserTabStrip"
import type { Workspace } from "../../../shared/types"
import { AccountMenu } from "./AccountMenu"
import { getDocUrl } from "@craft-agent/shared/docs/doc-links"
import { AppMenu } from "../AppMenu"
import type { ReactNode } from "react"
import {
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchHarnessChatChromeV1Atom,
  featureWorkbenchModeRegistryV1Atom,
  featureWorkbenchTopChromeV2Atom,
  bottomTerminalOpenAtom,
  inspectorChromeCollapsedAtom,
  inspectorVisibleAtom,
} from "@/atoms/unified-shell"
import { focusedSessionIdAtom } from "@/atoms/panel-stack"
import { sessionMetaMapAtom } from "@/atoms/sessions"
import { formatCostUsd } from "./input/turn-progress"
import { ModeBar } from "@/platform/ModeBar"
import { resolveWorkbenchChrome } from "@/platform/workbench-chrome"
import { resolveBottomTerminalToggle } from "@/platform/inspector-model"
import { WORKBENCH_FLAG } from "@craft-agent/core/platform"
import { PanelWorkspaceMenu } from './PanelWorkspaceMenu'
import { HeaderStatusLane } from './HeaderStatusLane'
import { DeviceStatusChip } from './DeviceStatusChip'
import { CompactWorkspaceMenu } from './CompactWorkspaceMenu'

const RIGHT_SLOT_FULL_BADGES_THRESHOLD = 420
const RIGHT_SLOT_TWO_BADGES_THRESHOLD = 300

interface TopBarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  activeSessionId?: string | null
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenStoredUserPreferences: () => void
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
  onToggleSidebar: () => void
  onToggleFocusMode: () => void
  onAddSessionPanel: () => void
  onAddBrowserPanel: () => void
  onOpenMap: () => void
  mapAvailable: boolean
  showInspectorToggle: boolean
  /** Active panel header rendered beside the workspace switcher on compact screens. */
  compactHeaderRenderer?: () => ReactNode
  /** Chat detail uses a minimal back/title/menu bar on compact screens. */
  isCompactChatMode?: boolean
  /** Web UI settings details use the same minimal back/title/actions bar. */
  isCompactSettingsMode?: boolean
  /** When true, hides controls that don't apply in compact/mobile layout */
  isCompact?: boolean
  /** When false, workspace selection is rendered elsewhere (for example, the left icon rail). */
  showWorkspaceSelector?: boolean
  /** Left offset for a full-height rail rendered outside the top bar. */
  leftInset?: number
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  activeSessionId,
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenStoredUserPreferences,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onToggleSidebar,
  onToggleFocusMode,
  onAddSessionPanel,
  onAddBrowserPanel,
  onOpenMap,
  mapAvailable,
  showInspectorToggle,
  compactHeaderRenderer,
  isCompactChatMode,
  isCompactSettingsMode,
  isCompact,
  showWorkspaceSelector = true,
  leftInset = 0,
}: TopBarProps) {
  const { t } = useTranslation()
  const [maxVisibleBrowserBadges, setMaxVisibleBrowserBadges] = useState(3)
  const rightSlotRef = useRef<HTMLDivElement | null>(null)
  const [inspectorVisible, setInspectorVisible] = useAtom(inspectorVisibleAtom)
  const [inspectorChromeCollapsed, setInspectorChromeCollapsed] = useAtom(inspectorChromeCollapsedAtom)
  const chrome = resolveWorkbenchChrome({
    unifiedShell: false,
    modeRegistry: useAtomValue(featureWorkbenchModeRegistryV1Atom),
    topChrome: useAtomValue(featureWorkbenchTopChromeV2Atom),
    tabGroups: false,
    browserSurface: useAtomValue(featureWorkbenchBrowserSurfaceV2Atom),
    statusBar: false,
  })

  const goBackHotkey = useActionLabel('nav.goBackAlt').hotkey
  const goForwardHotkey = useActionLabel('nav.goForwardAlt').hotkey
  const inspectorOpen = inspectorVisible && !inspectorChromeCollapsed
  const inspectorToggleLabel = t(inspectorOpen ? 'inspector.hide' : 'inspector.expand')

  const handleToggleInspector = () => {
    if (!inspectorOpen) {
      setInspectorChromeCollapsed(false)
      setInspectorVisible(true)
      return
    }
    setInspectorChromeCollapsed(true)
    setInspectorVisible(false)
  }

  const [bottomTerminalOpen, setBottomTerminalOpen] = useAtom(bottomTerminalOpenAtom)
  const handleTopBarTerminalToggle = () => {
    const next = resolveBottomTerminalToggle({
      bottomOpen: bottomTerminalOpen,
      sideOpen: false,
    })
    setBottomTerminalOpen(next.bottomOpen)
  }

  useEffect(() => {
    const slotEl = rightSlotRef.current
    if (!slotEl) return

    let frame = 0

    const updateBadgeDensity = () => {
      const slotWidth = slotEl.getBoundingClientRect().width
      const nextMaxVisibleBadges = slotWidth >= RIGHT_SLOT_FULL_BADGES_THRESHOLD
        ? 3
        : slotWidth >= RIGHT_SLOT_TWO_BADGES_THRESHOLD
          ? 2
          : 1

      setMaxVisibleBrowserBadges((prev) => (prev === nextMaxVisibleBadges ? prev : nextMaxVisibleBadges))
    }

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateBadgeDensity)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(slotEl)
    updateBadgeDensity()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [workspaces.length, activeWorkspaceId])

  // Stoplight padding clears macOS traffic-light controls, which only exist
  // in the Electron desktop window. The webui runs in a regular browser tab
  // and has no traffic lights regardless of host OS — collapse to a normal
  // 8px inset so the logo sits at the edge. Zoom 100/125/150 and fullscreen
  // are resolved separately so one magic padding cannot cover every case.
  const [zoomPercent, setZoomPercent] = useState(100)
  const [isFullScreen, setIsFullScreen] = useState(false)
  useEffect(() => {
    void window.electronAPI?.getDefaultZoomLevel?.().then((level) => {
      if (typeof level === 'number' && Number.isFinite(level)) setZoomPercent(level)
    })
  }, [])
  useEffect(() => {
    const sync = () => {
      const displayFull = window.matchMedia?.('(display-mode: fullscreen)').matches === true
      setIsFullScreen(displayFull || document.fullscreenElement != null)
    }
    sync()
    const media = window.matchMedia?.('(display-mode: fullscreen)')
    media?.addEventListener?.('change', sync)
    document.addEventListener('fullscreenchange', sync)
    window.addEventListener('resize', sync)
    return () => {
      media?.removeEventListener?.('change', sync)
      document.removeEventListener('fullscreenchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  const menuLeftPadding = zenTopBarSafeLeftPx({
    isMac,
    isWebUI,
    zoomPercent,
    isFullScreen,
  })

  return (
    <div
      className="chrome-topbar fixed top-0 right-0 z-panel titlebar-drag-region"
      data-shell-role="chrome"
      style={{ left: leftInset, height: 'var(--topbar-height)' }}
    >
      <div className="flex h-full w-full items-center justify-between gap-1.5">
      {/* === LEFT: Sidebar + Menu + Navigation + Workspace === */}
      {/* Keep this container draggable. Only individual interactive controls should use titlebar-no-drag. */}
      {/* In compact mode the right slot is hidden, so we add right padding here
          so the workspace pill doesn't run flush against the viewport edge. */}
      {isCompact && (isCompactChatMode || isCompactSettingsMode) ? (
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center px-3">
          {compactHeaderRenderer?.()}
        </div>
      ) : (
      <div
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5"
        style={{ paddingLeft: menuLeftPadding, paddingRight: isCompact ? 8 : 0 }}
      >
        <div className="flex items-center gap-0.5">
        {!isCompact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton onClick={onToggleSidebar} aria-label={t("menu.toggleSidebar")}>
              <PanelLeftRounded className="h-4 w-4 text-foreground/70" />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("menu.toggleSidebar")}</TooltipContent>
        </Tooltip>
        )}

        <AppMenu
          onNewChat={onNewChat}
          onNewWindow={onNewWindow}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={onOpenSettingsSubpage}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onToggleSidebar={onToggleSidebar}
          onToggleFocusMode={onToggleFocusMode}
        />
        </div>

        {/* Back / Forward / Workspace selector (moved from center).
            In compact mode the back/forward buttons are dropped — the iOS-style
            drill-in chevron in PanelHeader plus the browser's native back gesture
            cover that affordance, and the freed width lets the workspace pill
            actually fit on phone-width viewports. */}
        <div className={cn(
          "ml-1 flex min-w-0 items-center gap-1",
          isCompact ? "w-[clamp(108px,32vw,180px)] shrink-0" : "w-[clamp(220px,42vw,640px)]",
        )}>
          {!isCompact && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onBack} disabled={!canGoBack} aria-label={t("common.back")}>
                    <Icons.ChevronLeft className="h-4 w-4 text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.back")} {goBackHotkey}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <TopBarButton onClick={onForward} disabled={!canGoForward} aria-label={t("common.forward")}>
                    <Icons.ChevronRight className="h-4 w-4 text-foreground/70" strokeWidth={1.5} />
                  </TopBarButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("common.forward")} {goForwardHotkey}</TooltipContent>
              </Tooltip>
            </>
          )}

          {showWorkspaceSelector && (
            <div className="min-w-0 flex-1">
              <AccountMenu
                compact={!!isCompact}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onSelectWorkspace={onSelectWorkspace}
                onWorkspaceCreated={onWorkspaceCreated}
                onWorkspaceRemoved={onWorkspaceRemoved}
                workspaceUnreadMap={workspaceUnreadMap}
              />
            </div>
          )}
        </div>

        {chrome.showModeBar && !isCompact && (
          <div className="ml-2 min-w-0 flex-1">
            <ModeBar />
          </div>
        )}

        {isCompact && compactHeaderRenderer && (
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-1">
            {compactHeaderRenderer()}
          </div>
        )}
      </div>
      )}

      {isCompact && (
        <div className="titlebar-no-drag shrink-0 pr-2">
          <CompactWorkspaceMenu onOpenBrowser={onAddBrowserPanel} />
        </div>
      )}

      {!isCompact && (
        <div className="titlebar-no-drag min-w-0 max-w-[min(560px,42vw)] shrink">
          <HeaderStatusLane />
        </div>
      )}

      {/* === RIGHT: Browser strip + add + help === */}
      {!isCompact && (
      <div ref={rightSlotRef} className="flex min-w-0 shrink-0 items-center justify-end gap-0.5" style={{ paddingRight: 8 }}>
        <PanelWorkspaceMenu />
        <DeviceStatusChip />
        {chrome.utilityRail && (
          <TopBarUsageSlot />
        )}
        {!chrome.hideBrowserTabStrip && (
        <div className="min-w-0">
          <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={maxVisibleBrowserBadges} />
        </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton
              onClick={onOpenMap}
              disabled={!mapAvailable}
              aria-label={t("entityView.map")}
              className="h-6 w-6 rounded-md"
            >
              <Icons.Network className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("entityView.map")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton
              onClick={onAddSessionPanel}
              aria-label={t("session.newSessionInPanel")}
              className="ml-1 h-[26px] w-[26px] rounded-lg"
            >
              <SquarePenRounded className="h-4 w-4 text-foreground/50" />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("session.newSessionInPanel")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton
              onClick={onAddBrowserPanel}
              aria-label={t("browser.newWindow")}
              className="h-[26px] w-[26px] rounded-lg"
            >
              <Icons.Globe className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("browser.newWindow")}</TooltipContent>
        </Tooltip>



        {/* Help button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label={t("menu.helpAndDocs")} className="h-6 w-6 rounded-md">
              <Icons.HelpCircle className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-48">
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
              <Icons.DatabaseZap className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.sources")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
              <Icons.Zap className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.skills")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
              <Icons.CheckCircle2 className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.statuses")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
              <Icons.Settings className="h-3.5 w-3.5" />
              <span className="flex-1">{t("settings.permissions.title")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
              <Icons.Webhook className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar.automations")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('messaging'))}>
              <Icons.MessageSquare className="h-3.5 w-3.5" />
              <span className="flex-1">{t("settings.messaging.title")}</span>
              <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://thecraftagents.com/docs')}>
              <Icons.ExternalLink className="h-3.5 w-3.5" />
              <span className="flex-1">{t("menu.allDocumentation")}</span>
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
        {showInspectorToggle && <Tooltip>
          <TooltipTrigger asChild>
            <TopBarButton
              onClick={handleToggleInspector}
              aria-label={inspectorToggleLabel}
              aria-pressed={inspectorOpen}
              className="h-6 w-6 rounded-md"
            >
              <Icons.PanelRight className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
            </TopBarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{inspectorToggleLabel}</TooltipContent>
        </Tooltip>}
        {showInspectorToggle && inspectorChromeCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TopBarButton
                onClick={handleTopBarTerminalToggle}
                aria-label={t('inspector.terminal')}
                aria-pressed={bottomTerminalOpen}
                data-testid="bottom-terminal-toggle"
                data-terminal-flag={WORKBENCH_FLAG.terminalV1}
                className="h-[26px] w-[26px] rounded-lg"
              >
                <Icons.SquareTerminal className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('inspector.terminal')}</TooltipContent>
          </Tooltip>
        )}
      </div>
      )}
      </div>
    </div>
  )
}

function TopBarUsageSlot() {
  const { t } = useTranslation()
  const chatChromeEnabled = useAtomValue(featureWorkbenchHarnessChatChromeV1Atom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const costLabel = chatChromeEnabled
    ? formatCostUsd(focusedSessionId ? sessionMetaMap.get(focusedSessionId)?.tokenUsage?.costUsd : undefined)
    : null
  return (
    <div className="chrome-label-sm mr-1 hidden items-center gap-1.5 text-muted-foreground/50 sm:flex">
      <span>{t("workbench.presence.placeholder")}</span>
      <span data-testid="topbar-session-cost">
        {costLabel
          ? t("workbench.status.cost", { amount: costLabel })
          : t("workbench.status.usagePlaceholder")}
      </span>
    </div>
  )
}
