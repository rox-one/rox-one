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
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { NavigationStatusContext, type NavigationStatus } from '@/contexts/NavigationContext'
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

function links(memoryActive: boolean): SidebarItem[] {
  return [
    {
      id: 'nav:allSessions', title: 'Sessions', icon: Home, variant: 'ghost', onClick: noop, expandable: true, expanded: true,
      sortable: { onReorder: noop },
      items: [status('backlog', 0), status('todo', 3), { id: 'separator:states-flagged', type: 'separator' }],
    },
    { id: 'nav:memory', title: 'Memory', icon: Home, variant: memoryActive ? 'default' : 'ghost', onClick: noop },
  ]
}

/** AppShell's store shape: a set of collapsed ids, persisted across mounts. */
function makeStore() {
  const collapsed = new Set<string>()
  return {
    collapsed,
    isExpanded: (id: string) => !collapsed.has(id),
    toggle: (id: string) => { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id) },
  }
}

function Harness({ store, navigator, memoryActive }: { store: ReturnType<typeof makeStore>; navigator: string; memoryActive: boolean }) {
  // A new isExpanded identity per store change, as AppShell's collapsedItems-based callback.
  const [version, bump] = React.useReducer((n: number) => n + 1, 0)
  const baseLinks = React.useMemo(() => links(memoryActive), [memoryActive])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates on store change
  const isExpanded = React.useCallback((id: string) => store.isExpanded(id), [store, version])
  const toggleExpanded = React.useCallback((id: string) => { store.toggle(id); bump() }, [store])
  const status = { isReady: true, isSessionsReady: true, unavailableWorkspaceSlug: null, navigationState: { navigator }, navigationRevision: 0, canGoBack: false, canGoForward: false } as unknown as NavigationStatus
  return (
    <NavigationStatusContext.Provider value={status}>
      <ShellSidebarNav baseLinks={baseLinks} isCollapsed={false} onExpand={noop} onOpenBrowser={noop}
        isExpanded={isExpanded} toggleExpanded={toggleExpanded} applicationSectionsOpen={false} onApplicationSectionsOpenChange={noop} />
    </NavigationStatusContext.Provider>
  )
}

async function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(<Provider store={createStore()}><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">{node}</MotionConfig></I18nextProvider></Provider>)
  })
}
async function unmount() {
  await act(async () => root!.unmount())
  root = null
  host?.remove()
}
const details = () => host!.querySelector('details[data-application-sections]') as HTMLDetailsElement
const rowIds = () => Array.from(host!.querySelectorAll('[data-session-filters] [data-sidebar-link-id]')).map(el => el.getAttribute('data-sidebar-link-id'))

describe('WP5 fix1 (1): «Ещё» reveals an active destination', () => {
  it('is closed when nothing inside is active', async () => {
    await mount(<Harness store={makeStore()} navigator="memory" memoryActive={false} />)
    expect(details().open).toBe(false)
  })

  it('opens when the active destination lives in «Ещё» (deep link / route change)', async () => {
    await mount(<Harness store={makeStore()} navigator="memory" memoryActive />)
    expect(details().open).toBe(true)
  })
})

describe('WP5 fix1 (2): session filters persist through the expanded-sections store', () => {
  it('«Показать пустые» and the section collapse survive a remount', async () => {
    const store = makeStore()
    await mount(<Harness store={store} navigator="sessions" memoryActive={false} />)
    expect(rowIds()).not.toContain('nav:state:backlog')
    const toggle = host!.querySelector('[data-session-filters] button[aria-pressed]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => toggle.click())
    expect(store.collapsed.has(SESSION_FILTERS_EMPTY_HIDDEN_ID)).toBe(true)
    expect(rowIds()).toContain('nav:state:backlog')

    await unmount()
    await mount(<Harness store={store} navigator="sessions" memoryActive={false} />)
    expect(rowIds()).toContain('nav:state:backlog')

    const header = host!.querySelector(`[data-sidebar-link-id="${SESSION_FILTERS_ID}"]`) as HTMLButtonElement
    await act(async () => header.click())
    expect(store.collapsed.has(SESSION_FILTERS_ID)).toBe(true)
    await unmount()
    await mount(<Harness store={store} navigator="sessions" memoryActive={false} />)
    expect(host!.querySelector(`[data-sidebar-link-id="${SESSION_FILTERS_ID}"]`)?.getAttribute('aria-expanded')).toBe('false')
    expect(rowIds()).not.toContain('nav:state:todo')
  })
})
