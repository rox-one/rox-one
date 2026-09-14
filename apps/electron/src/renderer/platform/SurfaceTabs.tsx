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
import { useActiveWorkspace } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { surfaceTabFromRoute, type SurfaceKnowledgeRef } from './layout-snapshot'
import { CHROME_DENSITY } from './chrome-density'
import { surfaceTabKeyboardTarget, surfaceTabRovingId } from './surface-tab-navigation'
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
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          onClose(tab.panelId)
        }
      }}
      className={cn(
        'group chrome-label flex min-h-7 max-w-[220px] min-w-0 shrink-0 items-center rounded-md transition-colors',
        tab.focused ? 'bg-background text-foreground shadow-minimal' : 'text-muted-foreground hover:bg-foreground/5',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab.focused}
        tabIndex={isTabStop ? 0 : -1}
        data-surface-tab={tab.panelId}
        title={tab.title}
        onClick={() => setFocusedPanelId(tab.panelId)}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            onNavigate(tab.panelId, event.key)
          } else if (event.key === 'Delete') {
            event.preventDefault()
            onClose(tab.panelId)
          }
        }}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 truncate">{tab.title}</span>
      </button>
      <button
        type="button"
        tabIndex={isTabStop ? 0 : -1}
        aria-label={`${t('surfaceTabs.closeTab')}: ${tab.title}`}
        onClick={() => onClose(tab.panelId)}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
          tab.focused ? 'opacity-70' : 'opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 [@media(pointer:coarse)]:opacity-100',
        )}
      >
        <X className="size-3" aria-hidden />
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
  const panelTabs = tabs.filter((tab) => tab.kind !== 'browser')
  const rovingTabId = surfaceTabRovingId(panelTabs, focusedPanelId)
  const focusTab = (panelId: string) => {
    setFocusedPanelId(panelId)
    requestAnimationFrame(() => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[data-surface-tab]')
      const button = Array.from(buttons ?? []).find(element => element.dataset.surfaceTab === panelId)
      button?.focus()
      button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
  const navigateTab = (panelId: string, key: string) => {
    const target = surfaceTabKeyboardTarget(panelTabs, panelId, key)
    if (target) focusTab(target)
  }
  const closeTab = (panelId: string) => {
    const index = panelTabs.findIndex(tab => tab.panelId === panelId)
    const next = panelTabs[index + 1] ?? panelTabs[index - 1]
    const wasFocused = panelId === focusedPanelId
    closePanel(panelId)
    if (wasFocused && next) focusTab(next.panelId)
  }

  // Embedded-default desktop path: do not mount OS BrowserWindow chips in SurfaceTabs.
  // Browser lives in the inspector via createEmbedded(); os-browser-tabs helper remains
  // available for legacy callers/tests but is not product chrome here.

  return (
    <div
      className="chrome-strip flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-foreground/5 px-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      {panelTabs.length === 0 ? (
        <span className="chrome-label px-1 text-muted-foreground/50">{t('surfaceTabs.empty')}</span>
      ) : (
        <div ref={tabListRef} role="tablist" aria-label={t('panelWorkspace.openPanels')} className="flex shrink-0 items-center gap-1">
          {panelTabs.map((tab) => <SurfaceTabItem key={tab.panelId} tab={tab} isTabStop={tab.panelId === rovingTabId} onNavigate={navigateTab} onClose={closeTab} />)}
        </div>
      )}
    </div>
  )
}
