/**
 * WP5 review1 fixes: «Ещё» opens for an active destination inside it, and the
 * session-filter section / «Показать пустые» persist through AppShell's
 * expanded-sections store (survive a remount).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Home } from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { TooltipProvider } from '@rox/ui'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { NavigationContext, NavigationStatusContext, type NavigationStatus } from '@/contexts/NavigationContext'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import type { LinkItem, SidebarItem } from '../LeftSidebar'
import { SESSION_FILTERS_EMPTY_HIDDEN_ID, SESSION_FILTERS_ID, ShellSidebarNav } from '../ShellSidebarNav'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

const noop = () => {}
const status = (id: string, count: number): LinkItem => ({
  id: `nav:state:${id}`, title: id, label: String(count), count, icon: Home, variant: 'ghost', onClick: noop,
})

function links(memoryActive: boolean, inboxActive = false): SidebarItem[] {
  return [
    { id: 'nav:inbox', title: 'Inbox', icon: Home, variant: inboxActive ? 'default' : 'ghost', onClick: noop },
    {
      id: 'nav:allSessions', title: 'Sessions', icon: Home, variant: 'ghost', onClick: noop, expandable: true, expanded: true,
      sortable: { onReorder: noop },
      items: [status('backlog', 0), status('todo', 3), { id: 'separator:states-flagged', type: 'separator' }],
    },
    { id: 'nav:memory', title: 'Memory', icon: Home, variant: memoryActive ? 'default' : 'ghost', onClick: noop },
  ]
}

const SHELL = { activeWorkspaceId: null, pendingPermissions: new Map(), labels: [] } as unknown as AppShellContextType
const NAV = { navigate: () => {} } as unknown as React.ContextType<typeof NavigationContext>

/** AppShell's store shape: a set of collapsed ids, persisted across mounts. */
function makeStore() {
  const collapsed = new Set<string>()
  return {
    collapsed,
    isExpanded: (id: string) => !collapsed.has(id),
    toggle: (id: string) => { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id) },
  }
}

function Harness({ store, navigator, memoryActive, inboxActive = false }: { store: ReturnType<typeof makeStore>; navigator: string; memoryActive: boolean; inboxActive?: boolean }) {
  // A new isExpanded identity per store change, as AppShell's collapsedItems-based callback.
  const [version, bump] = React.useReducer((n: number) => n + 1, 0)
  const baseLinks = React.useMemo(() => links(memoryActive, inboxActive), [memoryActive, inboxActive])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates on store change
  const isExpanded = React.useCallback((id: string) => store.isExpanded(id), [store, version])
  const toggleExpanded = React.useCallback((id: string) => { store.toggle(id); bump() }, [store])
  const status = { isReady: true, isSessionsReady: true, unavailableWorkspaceSlug: null, navigationState: { navigator }, navigationRevision: 0, canGoBack: false, canGoForward: false } as unknown as NavigationStatus
  // The Sessions screen publishes its second sidebar via ScreenSidebarHost, which
  // reads the workspace from AppShell and navigation; the real shell always provides both.
  return (
    <AppShellProvider value={SHELL}>
    <NavigationContext.Provider value={NAV}>
    <NavigationStatusContext.Provider value={status}>
      <ShellSidebarNav baseLinks={baseLinks} isCollapsed={false} onExpand={noop} onOpenBrowser={noop}
        isExpanded={isExpanded} toggleExpanded={toggleExpanded} />
    </NavigationStatusContext.Provider>
    </NavigationContext.Provider>
    </AppShellProvider>
  )
}

async function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(<Provider store={createStore()}><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always"><TooltipProvider>{node}</TooltipProvider></MotionConfig></I18nextProvider></Provider>)
  })
}
async function unmount() {
  await act(async () => root!.unmount())
  root = null
  host?.remove()
}
async function waitForConfig(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  const ready = () => host!.querySelector('[data-sidebar-primary-nav]')?.getAttribute('data-sidebar-content') === 'config'
  while (!ready() && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(ready()).toBe(true)
}

const allRowIds = () => Array.from(host!.querySelectorAll('[data-sidebar-link-id]')).map(el => el.getAttribute('data-sidebar-link-id'))

describe('contextual sidebar replaces «Навигация» / «Инструменты»', () => {
  it('no global sections on any screen: Сессии shows only its own filters', async () => {
    await mount(<Harness store={makeStore()} navigator="sessions" memoryActive={false} />)
    expect(host!.querySelector('section[data-sidebar-tools]')).toBeNull()
    expect(host!.querySelector('[data-sidebar-section-header]')).toBeNull()
    expect(allRowIds()).not.toContain('nav:memory')
    expect(allRowIds()).not.toContain('nav:inbox')
    // Сессии publishes its own second sidebar (ScreenSidebarConfig); once the lazy
    // publisher resolves it replaces the legacy filter list, still with no globals.
    await waitForConfig()
    expect(host!.querySelector('section[data-sidebar-tools]')).toBeNull()
    expect(allRowIds()).not.toContain('nav:memory')
  })

  it('Память (no own nav) shows no other screens in the sidebar', async () => {
    await mount(<Harness store={makeStore()} navigator="memory" memoryActive />)
    expect(allRowIds().filter(id => id?.startsWith('nav:'))).toEqual([])
    expect(host!.querySelector('[data-sidebar-primary-nav]')?.getAttribute('data-sidebar-surface')).toBe('memory')
  })
})

describe('WP5 fix1 (2): session filters persist through the expanded-sections store', () => {
  // Since #4dea56dff Сессии renders its published ScreenSidebarConfig; the legacy
  // filter list (with «Показать пустые») is only the fallback until the lazy
  // publisher resolves. The persisted ids must not leak into the published sidebar
  // and must still be honoured by the fallback when it is shown.
  it('the published Sessions sidebar replaces the legacy filters and keeps the stored state', async () => {
    const store = makeStore()
    store.toggle(SESSION_FILTERS_EMPTY_HIDDEN_ID)
    store.toggle(SESSION_FILTERS_ID)
    await mount(<Harness store={store} navigator="sessions" memoryActive={false} />)
    const fallbackHeader = host!.querySelector(`[data-sidebar-link-id="${SESSION_FILTERS_ID}"]`)
    if (fallbackHeader) expect(fallbackHeader.getAttribute('aria-expanded')).toBe('false')
    await waitForConfig()
    expect(host!.querySelector('[data-session-filters]')).toBeNull()
    expect(host!.querySelector('[data-sidebar-primary-nav]')?.getAttribute('data-sidebar-surface')).toBe('sessions')

    await unmount()
    await mount(<Harness store={store} navigator="sessions" memoryActive={false} />)
    await waitForConfig()
    expect(host!.querySelector('[data-session-filters]')).toBeNull()
    expect(store.collapsed.has(SESSION_FILTERS_EMPTY_HIDDEN_ID)).toBe(true)
    expect(store.collapsed.has(SESSION_FILTERS_ID)).toBe(true)
  })
})
