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
import { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
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
  inspectorChromeCollapsedAtom,
  inspectorPanelWidthAtom,
  inspectorSectionAtom,
  inspectorVisibleAtom,
  type InspectorSectionId,
} from '@/atoms/unified-shell'
import { selectedConnectionAtom } from '@/atoms/connections'
import { isConnectionsNavigation, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { RADIUS_INNER } from '@/components/app-shell/panel-constants'
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
import { panelTypeToSurfaceKind } from './surface-tab-model'

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
  const panelType = route ? getPanelTypeFromRoute(route) : null
  const surfaceKind = panelType ? panelTypeToSurfaceKind(panelType) : null
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow
        label={t('inspector.field.title')}
        value={sessionMeta ? getSessionTitle(sessionMeta) : t('surfaceTabs.untitled')}
      />
      <InfoRow
        label={t('inspector.field.kind')}
        value={surfaceKind ?? panelType ?? '—'}
        mono
      />
      <InfoRow label={t('inspector.field.navigator')} value={navState.navigator} mono />
      <InfoRow label={t('inspector.field.session')} value={sessionId ?? '—'} mono />
      <InfoRow label={t('inspector.field.panel')} value={panelId ?? '—'} mono />
      <InfoRow label={t('inspector.field.route')} value={route ?? '—'} mono />
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
    if (visible && !chromeCollapsed && !terminalOpen && activeSection === 'browser') return
    void (async () => {
      const list = await window.electronAPI.browserPane.list().catch(() => [])
      await Promise.all(
        list
          .filter((item) => item.embedded)
          .map((item) => window.electronAPI.browserPane.syncBounds(item.id, null).catch(() => undefined)),
      )
    })()
  }, [visible, chromeCollapsed, terminalOpen, activeSection])

  const handleSectionClick = (clicked: InspectorSectionId) => {
    if (terminalOpen) setBottomTerminalOpen(true)
    setTerminalOpen(false)
    setChromeCollapsed(false)
    const next = resolveInspectorToggle({ visible, section: activeSection }, clicked)
    setVisible(next.visible)
    setSection(next.section)
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
  }

  const terminalControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('inspector.terminal')}
          aria-pressed={(terminalOpen && visible) || bottomTerminalOpen}
          title={t('inspector.terminal')}
          data-testid="bottom-terminal-toggle"
          data-terminal-flag={WORKBENCH_FLAG.terminalV1}
          onClick={handleBottomTerminalToggle}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[7px] border border-border/60 transition-colors',
            (terminalOpen && visible) || bottomTerminalOpen
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
        }}
        className="chrome-strip pointer-events-auto mt-1 mb-1 mr-1 flex w-[28px] shrink-0 items-center justify-center rounded-md border-l border-foreground/5 bg-background"
        data-session-inspector={sessionMode ? 'true' : 'false'}
        data-inspector="collapsed"
      >
        <ChevronsRight className="h-3.5 w-3.5 rotate-180" />
      </button>
    )
  }

  return (
    <div className="mt-1 mb-1 mr-1 flex shrink-0 items-stretch overflow-hidden rounded-lg" data-session-inspector={sessionMode ? 'true' : 'false'}>
      {visible && (
        <div
          className="relative flex h-full flex-col overflow-hidden bg-background shadow-middle"
          style={{
            width: Math.min(
              INSPECTOR_MAX_WIDTH,
              Math.max(INSPECTOR_MIN_WIDTH, panelWidth),
              Math.max(INSPECTOR_MIN_WIDTH, Math.floor(typeof window !== 'undefined' ? window.innerWidth * 0.72 : INSPECTOR_MAX_WIDTH)),
            ),
            borderRadius: RADIUS_INNER,
          }}
        >
          <div
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-foreground/15"
            onPointerDown={(event) => {
              event.preventDefault()
              widthDrag.current = { startX: event.clientX, startW: panelWidth }
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
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-foreground/5 pl-2.5 pr-1.5">
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
        className="chrome-rail flex h-full shrink-0 flex-col items-center gap-0.5 py-1.5"
        style={{ width: INSPECTOR_RAIL_WIDTH }}
      >
        {sectionIds.map((sectionId) => {
          const Icon = SECTION_ICONS[sectionId]
          const active = visible && activeSection === sectionId
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
