import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'
import { historyUrl, isRecordableUrl, type BrowserLink } from '@/lib/browser-history'

export { BROWSER_HISTORY_MAX, isRecordableUrl, recordVisit, toggleBookmark, type BrowserLink } from '@/lib/browser-history'

export interface BrowserSidebarTab {
  id: string
  url: string
  title: string
  isLoading: boolean
  agentControlActive: boolean
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

/**
 * Браузер second sidebar: Открытые вкладки (live instances) → Закладки
 * (user order) → Недавнее (history, newest first, excluding URLs open in a
 * tab).
 */
export function buildBrowserSidebarSections(tabs: readonly BrowserSidebarTab[], bookmarks: readonly BrowserLink[], history: readonly BrowserLink[]): SidebarSection[] {
  const bookmarked = new Set(bookmarks.map((b) => b.url))
  const openUrls = new Set(tabs.map((t) => historyUrl(t.url)))
  const open: SidebarSectionItem[] = tabs.map((tab) => ({
    id: `tab:${tab.id}`,
    ...(tab.title.trim() ? { label: tab.title.trim() } : tab.url ? { label: hostOf(tab.url) } : { labelKey: 'screens.browser.newTab' }),
    icon: tab.agentControlActive ? 'bot' : 'globe',
    secondary: tab.url ? hostOf(tab.url) : undefined,
    ...(tab.isLoading || tab.agentControlActive ? { badge: 'running' as const } : {}),
    menu: [
      ...(isRecordableUrl(tab.url) ? [{ id: bookmarked.has(tab.url) ? 'unbookmark' : 'bookmark', labelKey: bookmarked.has(tab.url) ? 'screens.browser.unbookmark' : 'screens.browser.bookmark' }] : []),
      { id: 'close', labelKey: 'screens.browser.closeTab', destructive: true },
    ],
    target: { kind: 'view', viewId: tab.id },
  }))
  const marks: SidebarSectionItem[] = bookmarks.map((b) => ({
    id: `bookmark:${b.url}`,
    label: b.title.trim() || hostOf(b.url),
    icon: 'bookmark',
    secondary: hostOf(b.url),
    menu: [{ id: 'unbookmark', labelKey: 'screens.browser.unbookmark' }],
    target: { kind: 'url', url: b.url },
  }))
  const recent: SidebarSectionItem[] = history
    .filter((h) => !openUrls.has(h.url))
    .map((h) => ({
      id: `recent:${h.url}`,
      label: h.title.trim() || hostOf(h.url),
      icon: 'history',
      secondary: hostOf(h.url),
      menu: [{ id: bookmarked.has(h.url) ? 'unbookmark' : 'bookmark', labelKey: bookmarked.has(h.url) ? 'screens.browser.unbookmark' : 'screens.browser.bookmark' }],
      target: { kind: 'url', url: h.url },
    }))
  return nonEmptySections([
    { id: 'tabs', titleKey: 'screens.browser.groups.tabs', items: open, limit: 8, collapsible: true },
    { id: 'bookmarks', titleKey: 'screens.browser.groups.bookmarks', items: marks, limit: 8, collapsible: true },
    { id: 'recent', titleKey: 'screens.browser.groups.recent', items: recent, limit: 8, collapsible: true },
  ])
}
