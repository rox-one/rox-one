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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, ChevronsRight, Folder, GitBranch, Globe, Info, Link2, ListTree, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
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
import { selectedConnectionAtom } from '@/atoms/connections'
import { isConnectionsNavigation, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { getAppLocale } from '@craft-agent/shared/i18n'
import { APP_NAV_DESTINATIONS } from '@/components/app-shell/nav-destinations'
import { CENTER_MIN_WIDTH, PANEL_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import { projectConnectionInspector } from './connection-inspector-model'
import { SessionInspectorBody } from '@/components/session-inspector/SessionInspectorBody'
import { InspectorBrowserPane } from '@/components/session-inspector/InspectorBrowserPane'
import { InspectorTerminal } from '@/components/session-inspector/InspectorTerminal'
import { WORKBENCH_FLAG } from '@craft-agent/core/platform'
import {
  INSPECTOR_LIVE_SECTIONS,
  inspectorSectionsForMode,
  isSessionInspectorSection,
  normalizeInspectorSection,
  resolveBottomTerminalToggle,
  resolveInspectorToggle,
} from './inspector-model'
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

function ConnectionInfoSection() {
  const { t } = useTranslation()
  const selected = useAtomValue(selectedConnectionAtom)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [consumers, setConsumers] = useState<Array<{ consumerId: string; status: string }>>([])
  const [testLogin, setTestLogin] = useState('')
  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Info className="h-6 w-6 text-muted-foreground/40" />
        <span className="text-[13px] font-medium text-foreground/80">
          {t('inspector.empty.connections.title')}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground/60">
          {t('inspector.empty.connections.body')}
        </span>
      </div>
    )
  }
  const fields = projectConnectionInspector(selected)
  const workspaceId = selected.workspaceId
  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow label={t('inspector.field.provider')} value={fields.provider} />
      <InfoRow label={t('inspector.field.storageMode')} value={fields.storageMode} mono />
      <InfoRow label={t('inspector.field.credentialRef')} value={fields.credentialRef} mono />
      <InfoRow label={t('inspector.field.scopes')} value={fields.scopes} mono />
      {testLogin ? <InfoRow label={t('inspector.field.testLogin')} value={testLogin} mono /> : null}
      {consumers.length > 0 ? (
        <InfoRow
          label={t('inspector.field.consumers')}
          value={consumers.map((row) => `${row.consumerId}: ${row.status}`).join(', ')}
        />
      ) : null}
      <div className="flex flex-wrap gap-1 px-2.5 py-1.5">
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const testConnection = window.electronAPI?.workgraph?.testConnection
            if (!workspaceId || typeof testConnection !== 'function') return
            const result = await testConnection({ workspaceId, connectionId: selected.id })
            setTestLogin(result.login)
          }}
        >
          {t('connections.test')}
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const repairConnection = window.electronAPI?.workgraph?.repairConnection
            if (!workspaceId || typeof repairConnection !== 'function') return
            const result = await repairConnection({ workspaceId, connectionId: selected.id })
            setConsumers(result.consumers)
          }}
        >
          {t('connections.repair')}
        </button>
        {confirmRotate ? (
          <>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={async () => {
                const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
                if (!workspaceId || typeof rotateConnection !== 'function') return
                const result = await rotateConnection({ workspaceId, connectionId: selected.id })
                setConsumers(result.consumers)
                setConfirmRotate(false)
              }}
            >
              {t('connections.rotateConfirm')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={() => setConfirmRotate(false)}
            >
              {t('connections.rotateCancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded border px-2 py-1 text-[12px]"
            onClick={() => setConfirmRotate(true)}
          >
            {t('connections.rotate')}
          </button>
        )}
      </div>
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
  const [bottomTerminalOpen, setBottomTerminalOpen] = useAtom(bottomTerminalOpenAtom)
  const widthDrag = useRef<{ startX: number; startW: number } | null>(null)
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
    storedWidth: panelWidth,
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

  useEffect(() => {
    if (panelShown && !terminalOpen && activeSection === 'browser') return
    void (async () => {
      const list = await window.electronAPI.browserPane.list().catch(() => [])
      await Promise.all(
        list
          .filter((item) => item.embedded)
          .map((item) => window.electronAPI.browserPane.syncBounds(item.id, null).catch(() => undefined)),
      )
    })()
  }, [panelShown, terminalOpen, activeSection])

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

  const handleBottomTerminalToggle = () => {
    const next = resolveBottomTerminalToggle({
      bottomOpen: bottomTerminalOpen,
      sideOpen: terminalOpen,
    })
    setTerminalOpen(next.sideOpen)
    setBottomTerminalOpen(next.bottomOpen)
    if (next.sideOpen) setUserOpened(true)
  }

  const terminalControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('inspector.terminal')}
          aria-pressed={(terminalOpen && panelShown) || bottomTerminalOpen}
          title={t('inspector.terminal')}
          data-testid="bottom-terminal-toggle"
          data-terminal-flag={WORKBENCH_FLAG.terminalV1}
          onClick={handleBottomTerminalToggle}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors',
            (terminalOpen && panelShown) || bottomTerminalOpen
              ? 'bg-accent/10 text-accent'
              : 'bg-foreground/[0.025] text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
        >
          <SquareTerminal className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{t('inspector.terminal')}</TooltipContent>
    </Tooltip>
  )

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
      className="rox-shell-divider-l flex shrink-0 items-stretch overflow-hidden"
      data-session-inspector={sessionMode ? 'true' : 'false'}
      data-inspector-collapsed-reason={layout.collapsedReason ?? undefined}
    >
      {panelShown && (
        <div
          className="rox-shell-pane relative flex h-full flex-col overflow-hidden"
          style={{ width: layout.width }}
        >
          <div
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-foreground/15"
            onPointerDown={(event) => {
              event.preventDefault()
              widthDrag.current = { startX: event.clientX, startW: layout.width }
              const move = (e: PointerEvent) => {
                const drag = widthDrag.current
                if (!drag) return
                const viewportCap = Math.max(
                  INSPECTOR_MIN_WIDTH,
                  Math.floor(window.innerWidth * 0.72),
                )
                const next = Math.min(
                  INSPECTOR_MAX_WIDTH,
                  viewportCap,
                  Math.max(INSPECTOR_MIN_WIDTH, drag.startW + (drag.startX - e.clientX)),
                )
                setPanelWidth(next)
              }
              const up = () => {
                widthDrag.current = null
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
              window.addEventListener('pointercancel', up)
            }}
          />
          <div className="rox-shell-divider-b flex h-8 shrink-0 items-center justify-between gap-2 pl-2.5 pr-1.5">
            <span className="chrome-label truncate font-medium tracking-tight">{t(titleKey)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('inspector.hide')}
                  onClick={collapseChrome}
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
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
                    'flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors',
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
          {terminalControl}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('inspector.hide')}
                onClick={collapseChrome}
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-muted-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
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
