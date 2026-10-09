/**
 * SurfaceTabs (W1 unified shell, spec S-02 §3.3/§3.5) — tab strip over the
 * panel-stack area. Derives tabs from the existing panel-stack atoms
 * (read-only consumption: the URL/NavigationContext remains the single source
 * of truth; no forked persistence). Focus/close delegate to the existing
 * stack ops (`focusedPanelIdAtom` / `closePanelAtom`), which NavigationContext
 * syncs back to the URL.
 *
 * Behaviour lives in the shared `@/components/ui/tabs` primitive (spec D2):
 * ARIA tabs, roving tabindex, Arrow/Home/End, Delete/Backspace and middle-click
 * close. This file is a thin adapter — it only maps panel-stack state onto
 * `TabItem[]` and renders the strip in its two hosts (portalled TopBar row or
 * the inline compact strip).
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
import { BookOpen, DatabaseZap, Globe, MessageSquare, PanelTop, Settings, Zap, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveViewRoute } from '../../shared/route-parser'
import {
  closePanelAtom,
  focusedPanelIdAtom,
  panelStackAtom,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { topBarSurfaceTabsSlotAtom } from '@/atoms/unified-shell'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getSessionTitle } from '@/utils/session'
import { surfaceTabFromRoute, type SurfaceKnowledgeRef } from './layout-snapshot'
import { APP_NAV_DESTINATIONS } from '@/components/app-shell/nav-destinations'
import { EXTRA_SCREENS } from '@/pages/extra-screens/registry'
import { useShellModes } from './useModes'
import { buildRouteTitleKeys } from './surface-shell'
import { CHROME_DENSITY } from './chrome-density'
import { createKnowledgeTabTitleLoader } from './knowledge-tab-titles'
import { Tabs, type TabItem } from '@/components/ui/tabs'
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

export function SurfaceTabs() {
  const { t } = useTranslation()
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const closePanel = useSetAtom(closePanelAtom)
  const entries = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
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
  // W1-07 (#1504): reactive — follows flags (unified modes, Docs relabel)
  // and late mode registrations, using the same resolved list as the pill.
  const { titleModes: shellModes } = useShellModes()
  const routeTitleKeys = useMemo(
    () => buildRouteTitleKeys({ destinations: APP_NAV_DESTINATIONS, modes: shellModes, extraScreens: EXTRA_SCREENS }),
    [shellModes],
  )
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
  // Embedded-default desktop path: do not mount OS BrowserWindow chips in SurfaceTabs.
  // Browser lives in the inspector via createEmbedded(); os-browser-tabs helper remains
  // available for legacy callers/tests but is not product chrome here.

  const tabItems: TabItem[] = panelTabs.map((tab) => {
    const Icon = tabIcon(tab)
    return {
      id: tab.panelId,
      label: tab.title,
      title: tab.title,
      controls: tab.panelId,
      closable: true,
      icon: <Icon className="icon-caption shrink-0 opacity-70" aria-hidden />,
    }
  })

  // One tab row: on desktop the strip is portalled into the TopBar row (next to
  // back/forward), so tabs no longer take a separate strip above the panels.
  // Compact mode has no TopBar slot and keeps the inline strip.
  const topBarSlot = useAtomValue(topBarSurfaceTabsSlotAtom)
  const tabStrip = panelTabs.length === 0 ? null : (
    <Tabs
      items={tabItems}
      activeId={focusedPanelId}
      variant="surface"
      density="compact"
      overflow="scroll"
      keyboard
      ariaLabel={t('surfaceTabs.label')}
      closeLabel={t('surfaceTabs.closeTab')}
      className={topBarSlot ? 'min-w-0 gap-0.5' : 'shrink-0 overflow-x-visible'}
      onSelect={setFocusedPanelId}
      onClose={closePanel}
    />
  )
  if (topBarSlot) {
    return tabStrip ? createPortal(tabStrip, topBarSlot) : null
  }

  return (
    <div
      className="chrome-strip flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-foreground/5 px-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      {panelTabs.length === 0 ? (
        <span className="chrome-label px-1 text-muted-foreground/50">{t('surfaceTabs.empty')}</span>
      ) : (
        tabStrip
      )}
    </div>
  )
}