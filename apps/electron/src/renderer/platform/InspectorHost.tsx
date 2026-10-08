/**
 * InspectorHost (W1 unified shell, spec S-03 §3.1/§3.3) — right-side
 * collapsible inspector: compact section rail (always visible) plus one
 * resizable inspector panel (design-compact density).
 *
 * Behavior contract (S-03 §3.3, implemented by `inspector-model.ts`):
 * clicking an inactive section icon opens the panel with that section;
 * clicking the icon of the section already shown hides the panel.
 * Visibility and active section persist via KEYS.inspectorVisible /
 * KEYS.inspectorSection (`atoms/unified-shell.ts`).
 *
 * W1 scope: the `info` section is live (focused-surface properties derived
 * from panel-stack + NavigationContext), while `browser` hosts the shared
 * embedded browser pane. `agent`/`outline`/`backlinks` render i18n empty states.
 * Mounted by `WorkspaceSurfaceHost` / `UnifiedShellLayout` when the
 * workbench rollout or harness inspector flag is enabled.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, ChevronsRight, Folder, GitBranch, Globe, Info, Link2, ListTree, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import {
  focusedPanelIdAtom,
  focusedPanelRouteAtom,
  getPanelTypeFromRoute,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  bottomTerminalOpenAtom,
  featureWorkbenchHarnessInspectorV1Atom,
  inspectorAutoCollapsedAtom,
  inspectorChromeCollapsedAtom,
  inspectorPanelWidthAtom,
  inspectorUserOpenedAtom,
  inspectorSectionAtom,
  inspectorVisibleAtom,
  type InspectorSectionId,
} from '@/atoms/unified-shell'
import { isConnectionsNavigation, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { getAppLocale } from '@rox/shared/i18n'
import { APP_NAV_DESTINATIONS } from '@/components/app-shell/nav-destinations'
import { CENTER_MIN_WIDTH, PANEL_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import { ConnectionInfoSection } from './ConnectionInfoSection'
import { SessionInspectorBody } from '@/components/session-inspector/SessionInspectorBody'
import { InspectorBrowserPane } from '@/components/session-inspector/InspectorBrowserPane'
import { InspectorActionRail } from './InspectorActionRail'
import { InspectorTerminal } from '@/components/session-inspector/InspectorTerminal'
import {
  INSPECTOR_LIVE_SECTIONS,
  inspectorSectionsForMode,
  isSessionInspectorSection,
  normalizeInspectorSection,
  resolveInspectorToggle,
} from './inspector-model'
import { InspectorResizeSash } from './InspectorResizeSash'
import { inspectorResizeLimit } from './inspector-resize'
import { CHROME_DENSITY } from './chrome-density'
import { countSessionFiles, resolveInspectorLayout } from './inspector-layout'

const INSPECTOR_RAIL_WIDTH = CHROME_DENSITY.railWidth
const INSPECTOR_MIN_WIDTH = 280
const INSPECTOR_MAX_WIDTH = 1400

const SECTION_ICONS: Record<InspectorSectionId, LucideIcon> = {
  info: Info,
  agent: Bot,
  outline: ListTree,
  backlinks: Link2,
  files: Folder,
  git: GitBranch,
  browser: Globe,
  context: ListTree,
}

// -----------------------------------------------------------------------------
// Info section (live in W1) — properties of the focused panel's surface.
// -----------------------------------------------------------------------------

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1">
      <span className="chrome-label-sm font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <span className={cn('chrome-label break-all text-foreground/90', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </div>
  )
}


function InfoSection() {
  const { t } = useTranslation()
  const route = useAtomValue(focusedPanelRouteAtom)
  const panelId = useAtomValue(focusedPanelIdAtom)
  const navState = useNavigationState()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  if (isConnectionsNavigation(navState)) {
    return <ConnectionInfoSection />
  }

  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined
  const locale = getAppLocale()
  const formatDate = (ts?: number) =>
    ts ? new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : null

  // Object properties, not routing internals: what is open and its key facts.
  const destination = APP_NAV_DESTINATIONS.find((dest) => dest.isActive(navState))
  const sectionLabel = sessionId
    ? t('inspector.kind.session')
    : navState.navigator === 'home'
      ? t('workbench.mode.home')
      : destination
        ? t(destination.labelKey)
        : null
  const title = sessionMeta ? getSessionTitle(sessionMeta) : (sectionLabel ?? t('surfaceTabs.untitled'))
  const created = formatDate(sessionMeta?.createdAt)
  const updated = formatDate(sessionMeta?.lastMessageAt)
  const status = sessionMeta?.sessionStatus
    ? t(`status.${sessionMeta.sessionStatus}`, { defaultValue: sessionMeta.sessionStatus })
    : null
  const showDebug = Boolean(import.meta.env?.DEV)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <InfoRow label={t('inspector.field.title')} value={title} />
      {sectionLabel && sessionMeta ? <InfoRow label={t('inspector.field.kind')} value={sectionLabel} /> : null}
      {status ? <InfoRow label={t('inspector.field.status')} value={status} /> : null}
      {created ? <InfoRow label={t('inspector.field.created')} value={created} /> : null}
      {updated ? <InfoRow label={t('inspector.field.updated')} value={updated} /> : null}
      {sessionMeta?.model ? <InfoRow label={t('inspector.field.model')} value={sessionMeta.model} /> : null}
      {sessionMeta?.messageCount ? (
        <InfoRow label={t('inspector.field.messages')} value={String(sessionMeta.messageCount)} />
      ) : null}
      {showDebug ? (
        <>
          <InfoRow label={t('inspector.field.navigator')} value={navState.navigator} mono />
          <InfoRow label={t('inspector.field.panel')} value={panelId ?? '—'} mono />
          <InfoRow label={t('inspector.field.route')} value={route ?? '—'} mono />
        </>
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Empty sections (agent/outline/backlinks) — content arrives with W2 (S-03 §3.3).
// -----------------------------------------------------------------------------

function EmptySection({ section }: { section: InspectorSectionId }) {
  const { t } = useTranslation()
  const Icon = SECTION_ICONS[section]
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <span className="text-[13px] font-medium text-foreground/80">
        {t(`inspector.empty.${section}.title`)}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground/60">
        {t(`inspector.empty.${section}.body`)}
      </span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Host: panel when visible; R-hide collapses to a 28px restore strip.
// -----------------------------------------------------------------------------

export function InspectorHost() {
  const { t } = useTranslation()
  const [visible, setVisible] = useAtom(inspectorVisibleAtom)
  const [chromeCollapsed, setChromeCollapsed] = useAtom(inspectorChromeCollapsedAtom)
  const [sectionRaw, setSection] = useAtom(inspectorSectionAtom)
  const [panelWidth, setPanelWidth] = useAtom(inspectorPanelWidthAtom)
  // The bottom dock owns the terminal (one entry point: the top-bar button).
  const setBottomTerminalOpen = useSetAtom(bottomTerminalOpenAtom)
  const [resizePreview, setResizePreview] = useState<number | null>(null)
  const controlsId = useId()
  const harnessInspector = useAtomValue(featureWorkbenchHarnessInspectorV1Atom)
  const route = useAtomValue(focusedPanelRouteAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { updateRightSidebar, navigationState } = useNavigation()
  const panelType = route ? getPanelTypeFromRoute(route) : null
  const sessionMode = harnessInspector && panelType === 'session'
  const sectionIds = inspectorSectionsForMode(sessionMode ? 'session' : 'knowledge')
  const section = normalizeInspectorSection(sectionRaw)
  const activeSection = sectionIds.includes(section) ? section : sectionIds[0]!
  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined
  const shell = useOptionalAppShellContext()
  const workspace = shell?.workspaces.find((item) => item.id === (sessionMeta?.workspaceId ?? shell.activeWorkspaceId))
  const sessionFolderPath =
    sessionId && workspace?.rootPath
      ? `${workspace.rootPath.replace(/[\\/]+$/, '')}/sessions/${sessionId}`
      : undefined
  const [terminalOpen, setTerminalOpen] = useState(false)
  const bottomTerminalOpen = useAtomValue(bottomTerminalOpenAtom)
  const [userOpened, setUserOpened] = useAtom(inspectorUserOpenedAtom)
  const setAutoCollapsed = useSetAtom(inspectorAutoCollapsedAtom)

  // One-surface shell: an empty session Files panel is collapsed by default.
  // Re-count files when the session changes or finishes a turn.
  const [fileCount, setFileCount] = useState<number | null>(null)
  const sessionActivityKey = `${sessionMeta?.lastMessageAt ?? ''}:${sessionMeta?.isProcessing ? 1 : 0}`
  useEffect(() => {
    if (!sessionMode || !sessionId) {
      setFileCount(null)
      return
    }
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    if (typeof api?.getSessionFiles !== 'function') return
    let cancelled = false
    const load = () => {
      api.getSessionFiles(sessionId)
        .then((files) => { if (!cancelled) setFileCount(countSessionFiles(files)) })
        .catch(() => { if (!cancelled) setFileCount(null) })
    }
    load()
    const unsubscribe = typeof api.onSessionFilesChanged === 'function'
      ? api.onSessionFilesChanged((changedId) => { if (changedId === sessionId) load() })
      : undefined
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [sessionMode, sessionId, sessionActivityKey])

  // An explicit open applies to the session it was made in.
  useEffect(() => {
    setUserOpened(false)
  }, [sessionId, setUserOpened])

  // Width available to the panel without squeezing the center column below
  // CENTER_MIN_WIDTH (split view: PANEL_MIN_WIDTH per panel). The content
  // panels' left edge does not depend on the inspector width, so this does not
  // feed back into itself.
  const [availableWidth, setAvailableWidth] = useState<number>(Number.POSITIVE_INFINITY)
  const measureAvailable = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const panels = document.querySelectorAll<HTMLElement>('[data-panel-role="content"]')
    const first = panels[0]
    if (!first) {
      setAvailableWidth(Number.POSITIVE_INFINITY)
      return
    }
    const required = panels.length > 1 ? panels.length * PANEL_MIN_WIDTH : CENTER_MIN_WIDTH
    const next = window.innerWidth - first.getBoundingClientRect().left - INSPECTOR_RAIL_WIDTH - required
    setAvailableWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next))
  }, [])
  useLayoutEffect(() => {
    measureAvailable()
    if (typeof window === 'undefined') return
    window.addEventListener('resize', measureAvailable)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureAvailable)
    const first = document.querySelector<HTMLElement>('[data-panel-role="content"]')
    if (observer && first) observer.observe(first)
    if (observer && first?.parentElement) observer.observe(first.parentElement)
    return () => {
      window.removeEventListener('resize', measureAvailable)
      observer?.disconnect()
    }
  }, [measureAvailable, route])

  const layout = resolveInspectorLayout({
    visible,
    userOpened,
    sessionMode,
    activeSection,
    fileCount,
    terminalOpen,
    availableWidth,
    storedWidth: resizePreview ?? panelWidth,
    minWidth: INSPECTOR_MIN_WIDTH,
    maxWidth: INSPECTOR_MAX_WIDTH,
    viewportCap: Math.floor(typeof window !== 'undefined' ? window.innerWidth * 0.72 : INSPECTOR_MAX_WIDTH),
  })
  const panelShown = layout.panelShown && !chromeCollapsed
  const autoCollapsed = !chromeCollapsed && layout.collapsedReason !== null
  useEffect(() => {
    setAutoCollapsed(autoCollapsed)
  }, [autoCollapsed, setAutoCollapsed])
  useEffect(() => () => setAutoCollapsed(false), [setAutoCollapsed])

  useEffect(() => {
    const sidebar = navigationState.rightSidebar
    if (!sessionMode || !sidebar) return
    if (sidebar.type === 'files' || sidebar.type === 'git' || sidebar.type === 'browser' || sidebar.type === 'context') {
      setChromeCollapsed(false)
      setSection(sidebar.type)
      setVisible(true)
    }
  }, [sessionMode, navigationState.rightSidebar, setChromeCollapsed, setSection, setVisible])

  const handleSectionClick = (clicked: InspectorSectionId) => {
    if (terminalOpen) setBottomTerminalOpen(true)
    setTerminalOpen(false)
    setChromeCollapsed(false)
    // Toggle against what is on screen: an auto-collapsed panel counts as
    // closed, so its rail icon opens it.
    const next = resolveInspectorToggle({ visible: panelShown, section: activeSection }, clicked)
    setVisible(next.visible)
    setSection(next.section)
    setUserOpened(next.visible)
    if (sessionMode && isSessionInspectorSection(clicked) && next.visible) {
      updateRightSidebar({ type: clicked })
    }
  }

  const titleKey = terminalOpen
    ? 'inspector.terminal'
    : activeSection === 'browser'
      ? 'inspector.tab.browser'
      : sessionMode && isSessionInspectorSection(activeSection)
        ? `inspector.tab.${activeSection}`
        : `inspector.${activeSection}`

  const collapseChrome = () => {
    setChromeCollapsed(true)
    setVisible(false)
    setTerminalOpen(false)
  }

  if (!sessionMode) {
    if (chromeCollapsed) {
      return (
        <button
          type="button"
          aria-label={t('inspector.expand')}
          onClick={() => {
            setChromeCollapsed(false)
            setVisible(true)
            setUserOpened(true)
          }}
          className="chrome-strip rox-shell-pane rox-shell-divider-l pointer-events-auto flex h-full w-[28px] shrink-0 items-center justify-center hover:bg-foreground/5"
          data-inspector="collapsed"
        >
          <ChevronsRight className="h-3.5 w-3.5 rotate-180" />
        </button>
      )
    }
    return (
      <InspectorActionRail
        browserPanelActive={false}
        terminalActive={bottomTerminalOpen}
        onCollapse={collapseChrome}
        onBrowserOpen={() => {
          setChromeCollapsed(false)
          setSection('browser')
          setVisible(true)
          setUserOpened(true)
        }}
      />
    )
  }

  // R-hide = 28px restore strip. Click expands chrome and shows the panel.
  if (chromeCollapsed) {
    return (
      <button
        type="button"
        aria-label={t('inspector.expand')}
        onClick={() => {
          setChromeCollapsed(false)
          setVisible(true)
          setUserOpened(true)
        }}
        className="chrome-strip rox-shell-pane rox-shell-divider-l pointer-events-auto flex h-full w-[28px] shrink-0 items-center justify-center hover:bg-foreground/5"
        data-session-inspector={sessionMode ? 'true' : 'false'}
        data-inspector="collapsed"
      >
        <ChevronsRight className="h-3.5 w-3.5 rotate-180" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        'rox-shell-divider-l relative flex shrink-0 items-stretch',
        layout.overlay && panelShown ? 'overflow-visible' : 'overflow-hidden',
      )}
      data-session-inspector={sessionMode ? 'true' : 'false'}
      data-inspector-collapsed-reason={layout.collapsedReason ?? undefined}
      data-inspector-overlay={layout.overlay && panelShown ? 'true' : undefined}
    >
      {panelShown && (
        <div
          className={cn(
            'rox-shell-pane flex h-full flex-col overflow-hidden',
            // Not enough room beside the center column: float over the content
            // instead of squeezing the chat below CENTER_MIN_WIDTH.
            layout.overlay
              ? 'absolute inset-y-0 z-40 shadow-strong'
              : 'relative',
          )}
          style={layout.overlay ? { width: layout.width, right: INSPECTOR_RAIL_WIDTH } : { width: layout.width }}
          id={controlsId}
          role="complementary"
          aria-label={t(titleKey)}
          data-inspector-panel={layout.overlay ? 'overlay' : 'docked'}
        >
          <InspectorResizeSash
            width={layout.width}
            viewportWidth={typeof window !== 'undefined' ? window.innerWidth : INSPECTOR_MAX_WIDTH}
            maxWidth={inspectorResizeLimit(typeof window !== 'undefined' ? window.innerWidth : INSPECTOR_MAX_WIDTH, availableWidth, layout.overlay)}
            controlsId={controlsId}
            active={panelShown}
            onPreview={setResizePreview}
            onCommit={width => { setPanelWidth(width); setResizePreview(null) }}
            onCancel={() => setResizePreview(null)}
          />
          <div className="rox-shell-divider-b flex h-8 shrink-0 items-center justify-between gap-2 pl-2.5 pr-1.5">
            <span className="chrome-label truncate font-medium tracking-tight">{t(titleKey)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('inspector.hide')}
                  onClick={collapseChrome}
                  className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t('inspector.hide')}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
          {terminalOpen ? (
            <InspectorTerminal cwd={sessionMeta?.workingDirectory} />
          ) : activeSection === 'browser' ? (
            <InspectorBrowserPane />
          ) : sessionMode ? (
            <SessionInspectorBody
              section={activeSection}
              sessionId={sessionId}
              sessionFolderPath={sessionFolderPath}
              cwd={sessionMeta?.workingDirectory}
            />
          ) : INSPECTOR_LIVE_SECTIONS.includes(activeSection) ? (
            <InfoSection />
          ) : (
            <EmptySection section={activeSection} />
          )}
          </div>
        </div>
      )}
      <div
        className={cn(
          'chrome-rail rox-shell-pane flex h-full shrink-0 flex-col items-center gap-0.5 py-1.5',
          panelShown && 'rox-shell-divider-l',
        )}
        style={{ width: INSPECTOR_RAIL_WIDTH }}
      >
        {sectionIds.map((sectionId) => {
          const Icon = SECTION_ICONS[sectionId]
          const active = panelShown && activeSection === sectionId
          const labelKey = sectionId === 'browser'
            ? 'inspector.tab.browser'
            : sessionMode
              ? `inspector.tab.${sectionId}`
              : `inspector.${sectionId}`
          return (
            <Tooltip key={sectionId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(labelKey)}
                  aria-pressed={active}
                  onClick={() => handleSectionClick(sectionId)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] transition-colors',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t(labelKey)}</TooltipContent>
            </Tooltip>
          )
        })}
        <div className="mt-auto flex flex-col items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('inspector.hide')}
                onClick={collapseChrome}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('inspector.hide')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
