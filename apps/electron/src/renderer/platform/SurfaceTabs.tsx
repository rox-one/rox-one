/**
 * SurfaceTabs (W1 unified shell, spec S-02 §3.3/§3.5) — tab strip over the
 * panel-stack area. Derives tabs from the existing panel-stack atoms
 * (read-only consumption: the URL/NavigationContext remains the single source
 * of truth; no forked persistence). Focus/close delegate to the existing
 * stack ops (`focusedPanelIdAtom` / `closePanelAtom`), which NavigationContext
 * syncs back to the URL.
 *
 * Kind mapping lives in `surface-tab-model.ts`: session/browser map onto real
 * SurfaceTab kinds; legacy navigator panels (source/settings/skills/other)
 * degrade to labelled tabs until wave M3.
 *
 * Workbench v2: TabGroups are a derived snapshot of the stack (one group per
 * column). OS-window browsers join as extra tabs when browser-surface v2 is on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, DatabaseZap, Globe, MessageSquare, PanelTop, Settings, X, Zap, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  closePanelAtom,
  focusedPanelIdAtom,
  focusedSessionIdAtom,
  panelStackAtom,
  type PanelType,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchTabGroupsV2Atom,
} from '@/atoms/unified-shell'
import { useWorkspaceBrowserWindows } from '@/components/browser/use-workspace-browser-windows'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { useActiveWorkspace } from '@/context/AppShellContext'
import * as storage from '@/lib/local-storage'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import type { BrowserInstanceInfo } from '../../shared/types'
import { surfaceTabFromRoute, type SurfaceKnowledgeRef } from './layout-snapshot'
import { osBrowserSurfaceTabs, type OsBrowserSurfaceTab } from './os-browser-tabs'
import {
  buildSurfaceTabViews,
  knowledgeRefKey,
  type SurfaceTabView,
} from './surface-tab-model'
import { groupTabsByLayout, panelStackToWorkbenchLayout, persistableWorkbenchLayout } from './tab-groups'

const TAB_STRIP_HEIGHT = 36

function tabIcon(tab: SurfaceTabView): LucideIcon {
  if (tab.kind === 'browser') return Globe
  switch (tab.panelType) {
    case 'session':
      return MessageSquare
    case 'source':
      return DatabaseZap
    case 'settings':
      return Settings
    case 'skills':
      return Zap
    case 'knowledge':
      return BookOpen
    default:
      return PanelTop
  }
}

function SurfaceTabItem({ tab }: { tab: SurfaceTabView }) {
  const { t } = useTranslation()
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const closePanel = useSetAtom(closePanelAtom)
  const Icon = tabIcon(tab)

  return (
    <div
      role="tab"
      aria-selected={tab.focused}
      tabIndex={0}
      title={tab.title}
      onClick={() => setFocusedPanelId(tab.panelId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setFocusedPanelId(tab.panelId)
        }
      }}
      onAuxClick={(e) => {
        // Middle-click closes, matching browser tab conventions.
        if (e.button === 1) {
          e.preventDefault()
          closePanel(tab.panelId)
        }
      }}
      className={cn(
        'group flex h-7 max-w-[220px] min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] transition-colors',
        tab.focused
          ? 'bg-background text-foreground shadow-minimal'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <button
        type="button"
        aria-label={t('surfaceTabs.closeTab')}
        onClick={(e) => {
          e.stopPropagation()
          closePanel(tab.panelId)
        }}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-all hover:bg-foreground/10',
          tab.focused ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60',
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function OsBrowserTabItem({
  tab,
  instance,
  liveWindowActions,
  onFocus,
  onOpenSession,
  onTerminate,
}: {
  tab: OsBrowserSurfaceTab
  instance: BrowserInstanceInfo
  liveWindowActions: boolean
  onFocus: (instance: BrowserInstanceInfo) => void
  onOpenSession: (instance: BrowserInstanceInfo) => void
  onTerminate: (instance: BrowserInstanceInfo) => void
}) {
  const { t } = useTranslation()
  const canOpenSession = !!tab.boundSessionId
  const openSessionLabel = tab.agentControlActive
    ? t('workbench.browser.openSessionUsing')
    : t('workbench.browser.openSession')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={tab.focused}
          tabIndex={0}
          title={tab.title}
          onClick={() => onFocus(instance)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onFocus(instance)
            }
          }}
          onAuxClick={(e) => {
            if (e.button === 1 && liveWindowActions) {
              e.preventDefault()
              onTerminate(instance)
            }
          }}
          className={cn(
            'group flex h-7 max-w-[220px] min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] transition-colors',
            tab.focused
              ? 'bg-background text-foreground shadow-minimal'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
        >
          <Globe className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
          <button
            type="button"
            aria-label={t('workbench.browser.terminate')}
            disabled={!liveWindowActions}
            onClick={(e) => {
              e.stopPropagation()
              onTerminate(instance)
            }}
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-all hover:bg-foreground/10',
              tab.focused ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60',
            )}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <StyledContextMenuContent minWidth="min-w-56">
        <StyledContextMenuItem disabled={!liveWindowActions} onSelect={() => onFocus(instance)}>
          {t('workbench.browser.showWindow')}
        </StyledContextMenuItem>
        <StyledContextMenuItem disabled={!canOpenSession} onSelect={() => onOpenSession(instance)}>
          {openSessionLabel}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem disabled={!liveWindowActions} onSelect={() => onTerminate(instance)}>
          {t('workbench.browser.terminate')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

export function SurfaceTabs() {
  const { t } = useTranslation()
  const entries = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const tabGroupsEnabled = useAtomValue(featureWorkbenchTabGroupsV2Atom)
  const browserSurfaceEnabled = useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const browserWindows = useWorkspaceBrowserWindows({
    enabled: browserSurfaceEnabled,
    activeSessionId: focusedSessionId,
  })

  const resolveSessionTitle = useCallback(
    (sessionId: string) => {
      const meta = sessionMetaMap.get(sessionId)
      return meta ? getSessionTitle(meta) : null
    },
    [sessionMetaMap],
  )

  // Knowledge tab titles (P3-16): each knowledge/database route carries its
  // durable ref — resolve node titles once per (workspace, ref) and cache by
  // ref key; tabs render the kind-qualified fallback until the title lands.
  const knowledgeRefs = useMemo(() => {
    const refs: SurfaceKnowledgeRef[] = []
    for (const entry of entries) {
      const surface = surfaceTabFromRoute(entry.route)
      if (surface?.kind === 'knowledge' || surface?.kind === 'database') {
        refs.push(surface.ref)
      }
    }
    return refs
  }, [entries])

  const [knowledgeTitles, setKnowledgeTitles] = useState<ReadonlyMap<string, string>>(new Map())
  const requestedRefKeys = useRef(new Set<string>())
  useEffect(() => {
    if (knowledgeRefs.length === 0 || !workspaceId) return
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.knowledge
    if (!api?.get || !api?.listConnections) return
    let cancelled = false
    void (async () => {
      let connectionId: string | null = null
      const resolved: Array<readonly [string, string]> = []
      for (const ref of knowledgeRefs) {
        const key = `${workspaceId}:${knowledgeRefKey(ref)}`
        if (requestedRefKeys.current.has(key)) continue
        requestedRefKeys.current.add(key)
        if (connectionId === null) {
          connectionId = (await api.listConnections().catch(() => []))[0]?.id ?? ''
          if (!connectionId) return
        }
        try {
          const node = await api.get({ workspaceId, connectionId, ref })
          const title = node?.title?.trim()
          if (title) resolved.push([key, title] as const)
        } catch {
          // Title unavailable — the tab keeps its kind-qualified fallback.
        }
      }
      if (!cancelled && resolved.length > 0) {
        setKnowledgeTitles((prev) => {
          const next = new Map(prev)
          for (const [key, title] of resolved) next.set(key, title)
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [knowledgeRefs, workspaceId])

  const resolveKnowledgeTitle = useCallback(
    (ref: SurfaceKnowledgeRef) =>
      knowledgeTitles.get(`${workspaceId}:${knowledgeRefKey(ref)}`) ?? null,
    [knowledgeTitles, workspaceId],
  )

  const tabs = buildSurfaceTabViews({
    entries,
    focusedPanelId,
    resolveSessionTitle,
    resolveKnowledgeTitle,
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

  const layout = useMemo(() => {
    if (!tabGroupsEnabled || !workspaceId) return null
    return panelStackToWorkbenchLayout({
      workspaceId,
      entries,
      focusedPanelId,
    })
  }, [tabGroupsEnabled, workspaceId, entries, focusedPanelId])

  useEffect(() => {
    if (!layout || !workspaceId) return
    const persistable = persistableWorkbenchLayout(layout)
    if (!persistable) return
    storage.set(storage.KEYS.workbenchLayout, persistable, workspaceId)
  }, [layout, workspaceId])

  const grouped = tabGroupsEnabled
    ? groupTabsByLayout(tabs, layout)
    : tabs.length === 0
      ? []
      : [{ groupId: 'default', tabs }]

  const osTabs = browserSurfaceEnabled
    ? osBrowserSurfaceTabs(
        browserWindows.orderedInstances,
        browserWindows.activeInstanceId,
        t('surfaceTabs.browser'),
      )
    : []
  const osById = useMemo(
    () => new Map(browserWindows.orderedInstances.map((instance) => [instance.id, instance])),
    [browserWindows.orderedInstances],
  )

  const empty = grouped.every((group) => group.tabs.length === 0) && osTabs.length === 0

  return (
    <div
      role="tablist"
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      {empty ? (
        <span className="px-1 text-[12px] text-muted-foreground/50">{t('surfaceTabs.empty')}</span>
      ) : (
        <>
          {grouped.map((group, index) => (
            <div key={group.groupId} className="flex items-center gap-1">
              {tabGroupsEnabled && index > 0 && (
                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border/80" />
              )}
              {group.tabs.map((tab) => (
                <SurfaceTabItem key={tab.panelId} tab={tab} />
              ))}
            </div>
          ))}
          {osTabs.length > 0 && (grouped.some((group) => group.tabs.length > 0)) && (
            <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border/80" />
          )}
          {osTabs.map((tab) => {
            const instance = osById.get(tab.instanceId)
            if (!instance) return null
            return (
              <OsBrowserTabItem
                key={tab.instanceId}
                tab={tab}
                instance={instance}
                liveWindowActions={browserWindows.liveWindowActions}
                onFocus={browserWindows.focusBrowserWindow}
                onOpenSession={browserWindows.openSessionUsingWindow}
                onTerminate={browserWindows.terminateBrowserWindow}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
