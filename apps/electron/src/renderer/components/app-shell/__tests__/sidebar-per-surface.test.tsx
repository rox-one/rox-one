/**
 * WP6 (#1533): one slot model on every surface — global primary nav, then the
 * open surface's contextual section (plus the portal slot screens use), then
 * «Ещё». Surface rows never carry their sub-items in the global nav.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Provider, createStore, useAtomValue } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Globe, Home, MessageSquare, Plug } from 'lucide-react'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { inspectorVisibleAtom } from '@/atoms/unified-shell'
import { NavigationStatusContext, type NavigationStatus } from '@/contexts/NavigationContext'
import type { SidebarItem } from '../LeftSidebar'
import { ShellSidebarNav, buildContextSection, stripContextItems } from '../ShellSidebarNav'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

const i18n = createInstance()
let navRenders = 0
i18n.use({
  type: 'postProcessor', name: 'count',
  process(value: string, key: string | string[]) {
    if ((Array.isArray(key) ? key[0] : key) === 'workbench.mode.more') navRenders++
    return value
  },
})
await i18n.init({ lng: 'en', fallbackLng: 'en', postProcess: ['count'], resources: { en: { translation: {} } } })

const noop = () => {}
const alwaysOpen = () => true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

const status = (navigationState: unknown) => ({
  isReady: true, isSessionsReady: true, unavailableWorkspaceSlug: null,
  navigationState, navigationRevision: 0, canGoBack: false, canGoForward: false,
}) as unknown as NavigationStatus

function makeLinks(): SidebarItem[] {
  return [
    { id: 'nav:allSessions', title: 'Chat', icon: MessageSquare, variant: 'ghost', onClick: noop },
    { id: 'nav:notes', title: 'Docs', icon: Home, variant: 'ghost', onClick: noop },
    {
      id: 'nav:sources', title: 'Sources', icon: Plug, variant: 'default', onClick: noop, expandable: true, expanded: true,
      items: [
        { id: 'nav:sources:api', title: 'APIs', icon: Globe, variant: 'ghost', onClick: noop },
        { id: 'nav:sources:mcp', title: 'MCP', icon: Globe, variant: 'ghost', onClick: noop },
      ],
    },
  ]
}

function Shell({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  useAtomValue(inspectorVisibleAtom)
  const links = React.useMemo(makeLinks, [])
  return (
    <ShellSidebarNav baseLinks={links} isCollapsed={false} onExpand={noop} onOpenBrowser={noop}
      isExpanded={alwaysOpen} toggleExpanded={noop} applicationSectionsOpen={false}
      onApplicationSectionsOpenChange={noop} contextSlotRef={slotRef} />
  )
}

async function mount(navigationState: unknown) {
  const store = createStore()
  let slot: HTMLDivElement | null = null
  const slotRef = (el: HTMLDivElement | null) => { slot = el }
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <NavigationStatusContext.Provider value={status(navigationState)}><Shell slotRef={slotRef} /></NavigationStatusContext.Provider>
        </I18nextProvider>
      </Provider>,
    )
  })
  return { store, slot: () => slot }
}

const ids = (el: Element | null | undefined) => Array.from(el?.querySelectorAll('[data-sidebar-link-id]') ?? []).map(n => n.getAttribute('data-sidebar-link-id'))

describe('WP6 per-surface sidebar', () => {
  it('renders primary nav → context section → portal slot → «Ещё», sub-items only in the context section', async () => {
    const { slot } = await mount({ navigator: 'sources' })
    const context = host!.querySelector('[data-sidebar-context]')
    const details = host!.querySelector('details[data-application-sections]')
    expect(context).not.toBeNull()
    expect(ids(context)).toContain('nav:sources:api')
    expect(ids(details)).toContain('nav:sources')
    expect(ids(details)).not.toContain('nav:sources:api')
    const s = slot()
    expect(s?.hasAttribute('data-primary-sidebar-context')).toBe(true)
    // DOM order: context section, then the slot, then «Ещё».
    expect(context!.compareDocumentPosition(s!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(s!.compareDocumentPosition(details!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('no context section on a surface without sub-navigation', async () => {
    await mount({ navigator: 'notes' })
    expect(host!.querySelector('[data-sidebar-context]')).toBeNull()
  })

  it('keeps the WP3 gain: unrelated atom changes do not re-render the nav', async () => {
    const { store } = await mount({ navigator: 'sources' })
    const before = navRenders
    for (let i = 0; i < 5; i++) await act(async () => { store.set(inspectorVisibleAtom, !store.get(inspectorVisibleAtom)) })
    expect(navRenders).toBe(before)
  })
})

describe('WP6 helpers', () => {
  const row = makeLinks()[2] as Extract<SidebarItem, { title: string }>
  it('stripContextItems drops sub-items; the open surface row navigates to its root', () => {
    let routed = 0
    const entry = { route: () => { routed++; return 'sources' as never }, isActive: () => true }
    const stripped = stripContextItems(row, entry, { navigator: 'sources' } as never)
    expect(stripped.items).toBeUndefined()
    expect(stripped.expandable).toBe(false)
    expect(stripped.onClick).not.toBe(row.onClick)
    const inactive = stripContextItems(row, { ...entry, isActive: () => false }, { navigator: 'notes' } as never)
    expect(inactive.onClick).toBe(row.onClick)
    expect(routed).toBe(0)
  })

  it('buildContextSection keeps the row title, icon and context menu', () => {
    const { title, links } = buildContextSection(row, { open: true, onToggle: noop })
    expect(title).toBe('Sources')
    const group = links[0] as Extract<SidebarItem, { title: string }>
    expect(group.id).toBe('nav:sources:context')
    expect(group.items).toBe(row.items)
  })
})
