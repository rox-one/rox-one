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
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, DatabaseZap, Globe, MessageSquare, PanelTop, Settings, X, Zap, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveViewRoute } from '../../shared/route-parser'
import {
  closePanelAtom,
  focusedPanelIdAtom,
  focusedSessionIdAtom,
  panelStackAtom,
  type PanelType,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { topBarSurfaceTabsSlotAtom } from '@/atoms/unified-shell'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { surfaceTabFromRoute, type SurfaceKnowledgeRef } from './layout-snapshot'
import { APP_NAV_DESTINATIONS } from '@/components/app-shell/nav-destinations'
import { EXTRA_SCREENS } from '@/pages/extra-screens/registry'
import { getModeRegistry } from './mode-registry-bootstrap'
import { CHROME_DENSITY } from './chrome-density'
import { createKnowledgeTabTitleLoader } from './knowledge-tab-titles'
import { surfaceTabRovingId, surfaceTabKeyboardTarget, surfaceTabCloseTarget } from './surface-tab-navigation'
import {
  buildSurfaceTabViews,
  knowledgeRefKey,
  type SurfaceTabView,
} from './surface-tab-model'

const TAB_STRIP_HEIGHT = CHROME_DENSITY.tabStripHeight

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

function SurfaceTabItem({ tab, isTabStop, onNavigate, onClose }: {
  tab: SurfaceTabView
  isTabStop: boolean
  onNavigate: (panelId: string, key: string) => void
  onClose: (panelId: string) => void
}) {
  const { t } = useTranslation()
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const Icon = tabIcon(tab)

  return (
    <div
      role="presentation"
      data-surface-tab-item={tab.panelId}
      data-surface-tab-panel-id={tab.panelId}
      onAuxClick={(event) => {
        if (event.button === 1) { event.preventDefault(); onClose(tab.panelId) }
      }}
      className={cn(
        'group chrome-label titlebar-no-drag flex h-6 max-w-[200px] min-w-0 shrink cursor-default items-center gap-1 rounded-[6px] transition-colors',
        tab.focused ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab.focused}
        aria-controls={tab.panelId}
        data-surface-tab={tab.panelId}
        tabIndex={isTabStop ? 0 : -1}
        title={tab.title}
        onClick={() => setFocusedPanelId(tab.panelId)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); onNavigate(tab.panelId, event.key)
          } else if (event.key === 'Delete') {
            event.preventDefault(); onClose(tab.panelId)
          }
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-[6px] pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      </button>
      <button
        type="button"
        tabIndex={isTabStop ? 0 : -1}
        aria-label={`${t('surfaceTabs.closeTab')}: ${tab.title}`}
        onClick={() => onClose(tab.panelId)}
        className={cn(
          'mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] outline-none transition-all hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring',
          tab.focused ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 group-focus-within:opacity-60',
        )}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  )
}

export function SurfaceTabs() {
  const { t } = useTranslation()
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const closePanel = useSetAtom(closePanelAtom)
  const tabListRef = useRef<HTMLDivElement>(null)
  const entries = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id

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
  const titleLoader = useRef(createKnowledgeTabTitleLoader())
  useEffect(() => {
    if (knowledgeRefs.length === 0 || !workspaceId) return
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.knowledge
    if (!api?.get || !api?.listConnections) return
    let cancelled = false
    void titleLoader.current.load(workspaceId, knowledgeRefs, api).then(resolved => {
      if (!cancelled) setKnowledgeTitles(resolved)
    })
    return () => { cancelled = true }
  }, [knowledgeRefs, workspaceId])

  const resolveKnowledgeTitle = useCallback(
    (ref: SurfaceKnowledgeRef) =>
      knowledgeTitles.get(`${workspaceId}:${knowledgeRefKey(ref)}`) ?? null,
    [knowledgeTitles, workspaceId],
  )

  // Route root → screen title, from the same registries the rail, the mode
  // pill and the «Ещё» group read (one name per screen everywhere).
  const routeTitleKeys = useMemo(() => {
    const map = new Map<string, string>()
    const root = (route: string) => route.split('?')[0].split('/')[0]
    for (const dest of APP_NAV_DESTINATIONS) {
      if (dest.route) map.set(root(dest.route()), dest.labelKey)
    }
    for (const mode of getModeRegistry().list()) {
      if (mode.rootRoute) map.set(root(mode.rootRoute), mode.titleKey)
    }
    for (const screen of EXTRA_SCREENS) map.set(screen.id, screen.labelKey)
    return map
  }, [])
  const resolveRouteTitle = useCallback(
    (route: string) => {
      if (resolveViewRoute(route).navigator === 'unavailable') return t('common.unavailable')
      const key = routeTitleKeys.get(route.split('?')[0].split('/')[0])
      return key ? t(key) : null
    },
    [routeTitleKeys, t],
  )

  const tabs = buildSurfaceTabViews({
    entries,
    focusedPanelId,
    resolveSessionTitle,
    resolveKnowledgeTitle,
    resolveRouteTitle,
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
  const panelTabs = tabs.filter((tab) => tab.kind !== 'browser')
  const rovingTabId = surfaceTabRovingId(panelTabs, focusedPanelId)
  const focusTab = (panelId: string, activate = true) => {
    const button = Array.from(tabListRef.current?.querySelectorAll<HTMLButtonElement>('[data-surface-tab]') ?? [])
      .find(element => element.dataset.surfaceTab === panelId)
    if (!button || !button.isConnected || button.getClientRects().length === 0) return
    if (activate) setFocusedPanelId(panelId)
    // The surviving button already exists. Immediate focus cannot steal a
    // later dialog/editor focus through a delayed animation-frame callback.
    button.focus({ preventScroll: true })
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const navigateTab = (panelId: string, key: string) => {
    const nextId = surfaceTabKeyboardTarget(panelTabs, panelId, key)
    if (nextId) focusTab(nextId)
  }
  const closeTab = (panelId: string) => {
    const nextId = surfaceTabCloseTarget(panelTabs, panelId, focusedPanelId)
    const ownsDOMFocus = document.activeElement?.closest<HTMLElement>('[data-surface-tab-item]')?.dataset.surfaceTabItem === panelId
    closePanel(panelId)
    // Middle-click from an editor leaves its focus owner intact. A tab or its
    // close button keeps keyboard focus inside the remaining visible strip.
    if (nextId && ownsDOMFocus) focusTab(nextId, panelId === focusedPanelId)
  }
  // Embedded-default desktop path: do not mount OS BrowserWindow chips in SurfaceTabs.
  // Browser lives in the inspector via createEmbedded(); os-browser-tabs helper remains
  // available for legacy callers/tests but is not product chrome here.

  // One tab row: on desktop the strip is portalled into the TopBar row (next to
  // back/forward), so tabs no longer take a separate strip above the panels.
  // Compact mode has no TopBar slot and keeps the inline strip.
  const topBarSlot = useAtomValue(topBarSurfaceTabsSlotAtom)
  const tabList = panelTabs.length === 0 ? null : (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label={t('surfaceTabs.label')}
      className={topBarSlot
        ? 'flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-hide'
        : 'flex shrink-0 items-center gap-1'}
      data-surface-tabs={topBarSlot ? 'topbar' : 'strip'}
    >
      {panelTabs.map((tab) => <SurfaceTabItem key={tab.panelId} tab={tab} isTabStop={tab.panelId === rovingTabId} onNavigate={navigateTab} onClose={closeTab} />)}
    </div>
  )
  if (topBarSlot) {
    return tabList ? createPortal(tabList, topBarSlot) : null
  }

  return (
    <div
      className="chrome-strip flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-foreground/5 px-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      {panelTabs.length === 0 ? (
        <span className="chrome-label px-1 text-muted-foreground/50">{t('surfaceTabs.empty')}</span>
      ) : (
        tabList
      )}
    </div>
  )
}
