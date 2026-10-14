import { useCallback, useMemo } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Bookmark, Bot, Eraser, Globe, History, Plus } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig } from '@/components/shell/screen-sidebar'
import {
  activeBrowserInstanceIdAtom, browserBookmarksAtom, browserHistoryAtom, browserInstancesAtom,
  browserPaneRegistryStatusAtom, filterInstancesForWorkspace, setBrowserInstancesAtom,
} from '@/atoms/browser-pane'
import { openOrFocusBrowserPanelAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'
import { isBrowserNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { openOrFocusEmbeddedBrowserPanel } from '@/platform/browser-panel-lifecycle'
import { useOpenPillBrowser } from '@/platform/pill-activate'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { historyKey, toggleBookmark } from '@/lib/browser-history'
import { buildBrowserSidebarSections } from './browser-sidebar-sections'

const ICONS = { globe: Globe, bot: Bot, bookmark: Bookmark, history: History } as const

/** Publishes the Браузер second sidebar (open tabs, bookmarks, recent). */
export function BrowserScreenSidebar() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const navState = useNavigationState()
  const all = useAtomValue(browserInstancesAtom)
  const registry = useAtomValue(browserPaneRegistryStatusAtom)
  const [bookmarks, setBookmarks] = useAtom(browserBookmarksAtom)
  const [historyAll, setHistoryAll] = useAtom(browserHistoryAtom)
  const history = useMemo(() => historyAll[historyKey(activeWorkspaceId)] ?? [], [historyAll, activeWorkspaceId])
  const clearHistory = useCallback(() => {
    setHistoryAll((all) => ({ ...all, [historyKey(activeWorkspaceId)]: [] }))
  }, [setHistoryAll, activeWorkspaceId])
  const setActive = useSetAtom(activeBrowserInstanceIdAtom)
  const openOrFocusBrowserPanel = useSetAtom(openOrFocusBrowserPanelAtom)
  const newTab = useOpenPillBrowser()
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const retryRegistry = useCallback(() => {
    void window.electronAPI?.browserPane?.list().then(setInstances, (error) => console.warn('[browser-sidebar] list failed:', error))
  }, [setInstances])

  const tabs = useMemo(() => filterInstancesForWorkspace(all, activeWorkspaceId, null), [all, activeWorkspaceId])
  const sections = useMemo(() => buildBrowserSidebarSections(tabs, bookmarks, history), [tabs, bookmarks, history])

  const focusTab = useCallback((instanceId: string) => {
    setActive(instanceId)
    openOrFocusEmbeddedBrowserPanel({ instanceId, openOrFocusBrowserPanel })
  }, [setActive, openOrFocusBrowserPanel])

  const openUrl = useCallback((url: string) => {
    const api = window.electronAPI?.browserPane
    if (!api) return
    void api.createEmbedded({ url, useImportedCookies: true })
      .catch(() => api.createEmbedded({ url }))
      .then((id) => focusTab(id))
      .catch((error) => console.warn('[browser-sidebar] open failed:', error))
  }, [focusTab])

  const onTarget = useCallback((target: SidebarTarget) => {
    if (target.kind === 'view') focusTab(target.viewId)
    else if (target.kind === 'url') openUrl(target.url)
  }, [focusTab, openUrl])

  const onMenu = useCallback((target: SidebarTarget, actionId: string) => {
    if (actionId === 'close' && target.kind === 'view') {
      void window.electronAPI?.browserPane?.destroy(target.viewId).catch((error) => console.warn('[browser-sidebar] close failed:', error))
      return
    }
    const link = target.kind === 'url'
      ? bookmarks.find((b) => b.url === target.url) ?? history.find((h) => h.url === target.url) ?? { url: target.url, title: '', at: Date.now() }
      : target.kind === 'view' ? (() => { const tab = tabs.find((x) => x.id === target.viewId); return tab ? { url: tab.url, title: tab.title, at: Date.now() } : null })() : null
    if (link && (actionId === 'bookmark' || actionId === 'unbookmark')) setBookmarks((prev) => toggleBookmark(prev, link))
  }, [bookmarks, history, tabs, setBookmarks])

  const activeKey = isBrowserNavigation(navState) && navState.details?.type === 'browser' ? `view:${navState.details.id}` : null

  const config = useMemo<ScreenSidebarConfig>(() => {
    const newTabAction = { id: 'new-tab', label: t('screens.browser.newTab'), icon: Plus, shortcut: '⌘T', onSelect: newTab }
    const groups = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, onMenu, activeKey })
    return {
      screenId: 'browser',
      title: t('surfaceTabs.browser'),
      primaryAction: newTabAction,
      headerActions: [{ id: 'clear-history', label: t('screens.browser.clearHistory'), icon: Eraser, disabled: history.length === 0, onSelect: clearHistory }],
      groups: registry.state === 'unavailable'
        ? [{ id: 'tabs', title: t('screens.browser.groups.tabs'), items: [], state: { kind: 'error', label: t('screens.browser.unavailable'), onRetry: retryRegistry } }, ...groups.filter((g) => g.id !== 'tabs')]
        : groups.length > 0 ? groups : [{ id: 'empty', items: [], state: { kind: 'empty', label: t('screens.browser.empty'), action: newTabAction } }],
    }
  }, [t, sections, onTarget, onMenu, activeKey, newTab, registry.state, retryRegistry, history.length, clearHistory])

  useScreenSidebar(config)
  return null
}
