/**
 * WP3: the shell sidebar must not re-render when an atom it does not read
 * changes. A harness mirrors AppShell: it subscribes to an unrelated atom
 * (inspectorVisibleAtom), memoises the links and renders ShellSidebarNav.
 * Render counts come from translation calls each component makes on every
 * render (LeftSidebar: `sidebar.contextNavigation`; ShellSidebarNav:
 * `workbench.mode.more`), counted by an i18next post-processor. (A
 * React.Profiler is not usable here: it reports a commit whenever its parent
 * re-renders, even when every child bails out.) A control harness with the
 * pre-WP3 shape (links rebuilt inline every render) shows the old behaviour.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Provider, createStore, useAtomValue } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Home, MessageSquare } from 'lucide-react'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { inspectorVisibleAtom } from '@/atoms/unified-shell'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { NavigationStatusContext, type NavigationStatus } from '@/contexts/NavigationContext'
import { LeftSidebar, type SidebarItem } from '../LeftSidebar'
import { ShellSidebarNav } from '../ShellSidebarNav'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

const counts = { shell: 0, sidebar: 0, nav: 0, left: 0 }
const i18n = createInstance()
i18n.use({
  type: 'postProcessor',
  name: 'renderCounter',
  process(value: string, key: string | string[]) {
    const k = Array.isArray(key) ? key[0] : key
    if (k === 'sidebar.recent') counts.sidebar++
    if (k === 'sidebar.contextNavigation') counts.left++
    if (k === 'workbench.mode.home') counts.nav++
    return value
  },
})
await i18n.init({ lng: 'en', fallbackLng: 'en', postProcess: ['renderCounter'], resources: { en: { translation: {} } } })

const navStatus = {
  isReady: true, isSessionsReady: true, unavailableWorkspaceSlug: null,
  navigationState: { navigator: 'home' }, navigationRevision: 0, canGoBack: false, canGoForward: false,
} as unknown as NavigationStatus

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

const noop = () => {}
const alwaysExpanded = () => true

function makeLinks(): SidebarItem[] {
  return [
    { id: 'nav:home', title: 'Home', icon: Home, variant: 'default', onClick: noop },
    { id: 'nav:allSessions', title: 'Chat', icon: MessageSquare, variant: 'ghost', onClick: noop },
    { id: 'nav:pages', title: 'Pages', icon: Home, variant: 'ghost', onClick: noop },
  ]
}


/** Post-WP3 shape: memoised links, stable callbacks, memoised sidebar child. */
function MemoShell() {
  useAtomValue(inspectorVisibleAtom) // unrelated to the sidebar
  counts.shell++
  const links = React.useMemo(makeLinks, [])
  const onExpand = React.useCallback(noop, [])
  return (
    <ShellSidebarNav baseLinks={links} isCollapsed={false} onExpand={onExpand} onOpenBrowser={noop} isExpanded={alwaysExpanded} toggleExpanded={noop} />
  )
}

/** Pre-WP3 shape: links rebuilt inline on every shell render. */
function InlineShell() {
  useAtomValue(inspectorVisibleAtom)
  counts.shell++
  return (
    <LeftSidebar isCollapsed={false} onExpand={() => {}} links={makeLinks()} />
  )
}

async function mount(node: React.ReactNode) {
  const store = createStore()
  counts.shell = 0
  counts.sidebar = 0
  counts.nav = 0
  counts.left = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <NavigationStatusContext.Provider value={navStatus}>{node}</NavigationStatusContext.Provider>
        </I18nextProvider>
      </Provider>,
    )
  })
  // The «Недавнее» fallback is a lazy chunk.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return store
}

async function toggleUnrelated(store: ReturnType<typeof createStore>, times: number) {
  for (let i = 0; i < times; i++) {
    await act(async () => { store.set(inspectorVisibleAtom, !store.get(inspectorVisibleAtom)) })
  }
}

describe('WP3: shell sidebar re-renders', () => {
  it('does not re-render the sidebar when an unrelated atom changes', async () => {
    const store = await mount(<MemoShell />)
    const shellAfterMount = counts.shell
    const sidebarAfterMount = counts.sidebar
    const navAfterMount = counts.nav
    expect(sidebarAfterMount).toBeGreaterThan(0)
    expect(navAfterMount).toBeGreaterThan(0)
    await toggleUnrelated(store, 5)
    expect(counts.shell).toBe(shellAfterMount + 5)
    expect(counts.nav).toBe(navAfterMount)
    expect(counts.sidebar).toBe(sidebarAfterMount)
    console.info(`[WP3] after: shell renders +${counts.shell - shellAfterMount}, ShellSidebarNav +${counts.nav - navAfterMount}, LeftSidebar renders +${counts.sidebar - sidebarAfterMount}`)
  })

  it('control: the pre-WP3 inline-links shape re-renders the sidebar on every shell render', async () => {
    const store = await mount(<InlineShell />)
    const leftAfterMount = counts.left
    await toggleUnrelated(store, 5)
    expect(counts.left).toBe(leftAfterMount + 5)
    console.info(`[WP3] before: LeftSidebar renders +${counts.left - leftAfterMount} for 5 unrelated atom changes`)
  })

  it('a sidebar-only atom (session metas) re-renders the sidebar list, not the shell', async () => {
    const store = await mount(<MemoShell />)
    const shellAfterMount = counts.shell
    const sidebarAfterMount = counts.sidebar
    expect(host!.querySelector('[data-sidebar-link-id="recent:s1"]')).toBeNull()
    await act(async () => { store.set(sessionMetaMapAtom, new Map([['s1', { id: 's1', workspaceId: 'ws', name: 'One', lastMessageAt: 1 }]]) as never) })
    expect(counts.shell).toBe(shellAfterMount)
    expect(counts.sidebar).toBeGreaterThan(sidebarAfterMount)
    expect(host!.querySelector('[data-sidebar-link-id="recent:s1"]')).not.toBeNull()
  })
})
