/**
 * Contextual sidebar: the sidebar shows only the CURRENT screen — its title,
 * primary action and own navigation (context section, page portal, or
 * «Закреплённое» / «Недавнее»). No global Навигация / Инструменты lists.
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
import { ShellSidebarNav, buildContextSection } from '../ShellSidebarNav'
import { sessionMetaMapAtom } from '@/atoms/sessions'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

const i18n = createInstance()
let navRenders = 0
i18n.use({
  type: 'postProcessor', name: 'count',
  process(value: string, key: string | string[]) {
    if ((Array.isArray(key) ? key[0] : key) === 'sidebar.navigation') navRenders++
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
    { id: 'nav:allSessions', title: 'Chat', icon: MessageSquare, variant: 'ghost', onClick: noop, actions: <button type="button" data-tutorial="new-chat-button">+</button> },
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

function Shell({ slotRef, collapsed = false }: { slotRef: (el: HTMLDivElement | null) => void; collapsed?: boolean }) {
  useAtomValue(inspectorVisibleAtom)
  const links = React.useMemo(makeLinks, [])
  return (
    <ShellSidebarNav baseLinks={links} isCollapsed={collapsed} onExpand={noop} onOpenBrowser={noop}
      isExpanded={alwaysOpen} toggleExpanded={noop} contextSlotRef={slotRef} workspaceIds={['ws1']} />
  )
}

async function mount(navigationState: unknown, opts: { collapsed?: boolean; seed?: (store: ReturnType<typeof createStore>) => void } = {}) {
  const store = createStore()
  opts.seed?.(store)
  let slot: HTMLDivElement | null = null
  const slotRef = (el: HTMLDivElement | null) => { slot = el }
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <NavigationStatusContext.Provider value={status(navigationState)}><Shell slotRef={slotRef} collapsed={opts.collapsed} /></NavigationStatusContext.Provider>
        </I18nextProvider>
      </Provider>,
    )
  })
  // Let the lazy «Недавнее» chunk resolve.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { store, slot: () => slot }
}

const ids = (el: Element | null | undefined) => Array.from(el?.querySelectorAll('[data-sidebar-link-id]') ?? []).map(n => n.getAttribute('data-sidebar-link-id'))

const seedSessions = (store: ReturnType<typeof createStore>) => {
  const meta = (id: string, at: number, over: Record<string, unknown> = {}) => [id, { id, workspaceId: 'ws1', name: `Chat ${id}`, lastMessageAt: at, ...over }] as const
  store.set(sessionMetaMapAtom, new Map([
    meta('a', 3), meta('b', 2, { isFlagged: true }), meta('c', 1), meta('z', 9, { isArchived: true }), meta('other', 8, { workspaceId: 'ws2' }),
  ]) as never)
}

describe('contextual sidebar', () => {
  it('a context surface shows its title and its own sub-items — no global surface rows', async () => {
    await mount({ navigator: 'sources' })
    const nav = host!.querySelector('[data-sidebar-primary-nav]')
    expect(nav?.getAttribute('data-sidebar-surface')).toBe('sources')
    expect(host!.querySelector('[data-sidebar-screen-title]')?.textContent).toBe('sidebar.sources')
    const context = host!.querySelector('[data-sidebar-context]')
    expect(ids(context)).toContain('nav:sources:api')
    // The global lists are gone.
    expect(host!.querySelector('[data-sidebar-tools]')).toBeNull()
    expect(ids(host)).not.toContain('nav:notes')
    expect(ids(host)).not.toContain('nav:allSessions')
  })

  it('a portal surface hands the sidebar to its page; until the page portals, the fallback shows', async () => {
    const { slot } = await mount({ navigator: 'notes' }, { seed: seedSessions })
    expect(host!.querySelector('[data-sidebar-context]')).toBeNull()
    expect(slot()?.hasAttribute('data-primary-sidebar-context')).toBe(true)
    expect(host!.querySelector('[data-sidebar-recent-pinned]')).not.toBeNull()
    await act(async () => { const nav = document.createElement('div'); nav.textContent = 'tree'; slot()!.appendChild(nav) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host!.querySelector('[data-sidebar-recent-pinned]')).toBeNull()
    expect(host!.querySelector('[data-sidebar-primary-nav]')?.getAttribute('data-sidebar-content')).toBe('portal')
  })

  it('a screen without navigation shows «Закреплённое» (flagged) + «Недавнее» for this workspace, and «+ новый чат»', async () => {
    await mount({ navigator: 'home' }, { seed: seedSessions })
    const fallback = host!.querySelector('[data-sidebar-recent-pinned]')
    expect(fallback).not.toBeNull()
    const [pinned, recent] = Array.from(fallback!.querySelectorAll('section'))
    expect(ids(pinned)).toEqual(['recent:b'])
    expect(ids(recent)).toEqual(['recent:a', 'recent:c'])
    expect(host!.querySelector('[data-sidebar-screen-header] [data-tutorial="new-chat-button"]')).not.toBeNull()
  })

  it('collapsed rail: the current screen\'s items as icons, never the global surfaces', async () => {
    await mount({ navigator: 'sources' }, { collapsed: true })
    expect(ids(host)).toEqual(expect.arrayContaining(['nav:sources:api', 'nav:sources:mcp']))
    expect(ids(host)).not.toContain('nav:notes')
    expect(host!.querySelector('[data-sidebar-screen-header]')).toBeNull()
  })

  it('keeps the WP3 gain: unrelated atom changes do not re-render the nav', async () => {
    const { store } = await mount({ navigator: 'home' })
    const before = navRenders
    for (let i = 0; i < 5; i++) await act(async () => { store.set(inspectorVisibleAtom, !store.get(inspectorVisibleAtom)) })
    expect(navRenders).toBe(before)
  })
})

describe('context helpers', () => {
  const row = makeLinks()[2] as Extract<SidebarItem, { title: string }>
  it('buildContextSection keeps the row title, icon and context menu', () => {
    const { title, links } = buildContextSection(row, { open: true, onToggle: noop })
    expect(title).toBe('Sources')
    const group = links[0] as Extract<SidebarItem, { title: string }>
    expect(group.id).toBe('nav:sources:context')
    expect(group.items).toBe(row.items)
  })
})
