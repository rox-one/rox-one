/**
 * W2.1 — browser tabs on the shared tab primitive.
 *
 * `BrowserTabStripView` is the hook-free half of the strip: it maps instances
 * onto `TabItem[]` and renders the shared `Tabs` primitive (real, unmocked —
 * that is where the ARIA/keyboard/close contract lives) plus the trailing
 * actions menu. `@rox/ui` is stubbed with the repo's usual lightweight
 * stand-ins; the Radix menu only renders when opened, which SSR cannot do, so
 * the menu items themselves are covered by the source contract below.
 */

import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { BrowserInstanceInfo } from '../../../../shared/types'

mock.module('@rox/ui', () => ({
  Spinner: () => <span data-testid="spinner" />,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuSub: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuShortcut: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  // The dropdown content renders only when opened; SSR never opens it.
  StyledDropdownMenuContent: () => null,
  StyledDropdownMenuItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyledDropdownMenuSeparator: () => null,
  StyledDropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyledDropdownMenuSubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

import { BrowserTabStripView, type BrowserTabStripViewProps } from '../BrowserTabStripView'

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: { en: { translation: {
      'browser.tabsLabel': 'Browser tabs',
      'browser.closeTab': 'Close browser window',
      'browser.tabsMenu': 'Browser windows',
      'surfaceTabs.browser': 'Browser',
      'workbench.browser.showWindow': 'Show browser window',
      'workbench.browser.openSession': 'Open session which used this window',
      'workbench.browser.openSessionUsing': 'Open session using this window',
      'workbench.browser.terminate': 'Terminate browser',
      'common.close': 'Close',
      'common.loading': 'Loading',
    } } },
  })
})

function instance(partial: Partial<BrowserInstanceInfo> & { id: string }): BrowserInstanceInfo {
  return {
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    boundSessionId: null,
    ownerType: 'manual',
    ownerSessionId: null,
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
    ...partial,
  }
}

const render = (props: BrowserTabStripViewProps) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(BrowserTabStripView, props)))

const noop = () => {}

describe('BrowserTabStripView renders through the shared tab primitive', () => {
  it('exposes one browser tablist with ARIA tabs and a roving stop', () => {
    const html = render({
      instances: [instance({ id: 'a', title: 'Docs' }), instance({ id: 'b', title: 'Mail' })],
      activeInstanceId: 'a',
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html).toContain('data-tabs="browser"')
    expect(html).toContain('data-overflow="menu"')
    expect(html.match(/role="tablist"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Browser tabs"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-selected="false"')
    // One Tab stop: the active tab and its close button (the primitive keeps
    // the close affordance inside the roving stop).
    expect(html.match(/tabindex="0"/g)).toHaveLength(2)
    expect(html).toContain('tabindex="-1"')
  })

  it('caps visible tabs and counts the overflow in the trailing menu', () => {
    const html = render({
      instances: [
        instance({ id: 'a', title: 'One' }),
        instance({ id: 'b', title: 'Two' }),
        instance({ id: 'c', title: 'Three' }),
      ],
      activeInstanceId: 'a',
      maxVisibleBadges: 2,
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('data-tab="a"')
    expect(html).toContain('data-tab="b"')
    expect(html).not.toContain('data-tab="c"')
    expect(html).toContain('>+1<')
  })

  it('renders a labelled close button and a middle-click surface per tab', () => {
    const html = render({
      instances: [instance({ id: 'a', title: 'Docs' })],
      activeInstanceId: 'a',
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html).toContain('aria-label="Close browser window: Docs"')
    expect(html).toContain('data-tab-item="a"')
  })

  it('offers the per-instance menu from the strip trailing slot', () => {
    const html = render({
      instances: [instance({ id: 'a', title: 'Docs' })],
      activeInstanceId: 'a',
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html).toContain('aria-label="Browser windows"')
  })

  it('falls back to the hostname when a title is blank', () => {
    const html = render({
      instances: [
        instance({ id: 'a', title: '   ', url: 'https://docs.example.com/guide', favicon: null }),
      ],
      activeInstanceId: 'a',
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html).toContain('title="docs.example.com"')
  })

  it('sizes the favicon/globe glyph by token, not a literal', () => {
    const html = render({
      instances: [instance({ id: 'a', title: 'Docs' })],
      activeInstanceId: 'a',
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })

    expect(html).toContain('icon-status')
  })

  it('renders nothing without instances', () => {
    expect(render({
      instances: [],
      activeInstanceId: null,
      liveWindowActions: true,
      onFocusWindow: noop,
      onOpenSession: noop,
      onTerminate: noop,
    })).toBe('')
  })
})

const viewSource = readFileSync(join(import.meta.dir, '../BrowserTabStripView.tsx'), 'utf8')
const containerSource = readFileSync(join(import.meta.dir, '../BrowserTabStrip.tsx'), 'utf8')
const glyphSource = readFileSync(join(import.meta.dir, '../BrowserTabGlyph.tsx'), 'utf8')

describe('BrowserTabStripView delegates keyboard, ARIA and closing to the primitive', () => {
  it('imports the shared primitive and owns no tablist markup or keyboard', () => {
    expect(viewSource).toContain("from '@/components/ui/tabs'")
    expect(viewSource).toContain('<Tabs')
    expect(viewSource).toContain('variant="browser"')
    expect(viewSource).toContain('onClose=')
    expect(viewSource).toContain('trailing=')
    expect(viewSource).not.toContain('role="tablist"')
    expect(viewSource).not.toContain('role="tab"')
    expect(viewSource).not.toContain('onKeyDown')
    expect(viewSource).not.toContain('aria-selected')
    expect(viewSource).not.toContain('onAuxClick')
  })

  it('keeps the container free of tab markup', () => {
    expect(containerSource).toContain('<BrowserTabStripView')
    expect(containerSource).not.toContain('role="tab"')
    expect(containerSource).not.toContain('from \'@/components/ui/tabs\'')
  })

  it('preserves the per-instance menu items', () => {
    expect(viewSource).toContain("t('workbench.browser.showWindow')")
    expect(viewSource).toContain("t('workbench.browser.openSession')")
    expect(viewSource).toContain("t('workbench.browser.openSessionUsing')")
    expect(viewSource).toContain("t('workbench.browser.terminate')")
    expect(viewSource).toContain('DropdownMenuSub')
  })

  it('uses tokens for sizes, radii and glyphs (no literals, no raw colors)', () => {
    for (const source of [viewSource, containerSource, glyphSource]) {
      expect(source).not.toContain('h-[26px]')
      expect(source).not.toContain('h-3.5 w-3.5')
      expect(source).not.toContain('strokeWidth')
      expect(source).not.toMatch(/text-\[\d/)
      expect(source).not.toContain('bg-foreground/')
      expect(source).not.toContain('text-white/')
      expect(source).not.toContain('text-black/')
    }
    expect(viewSource).toContain('--radius-control')
    expect(viewSource).toContain('--control-sm')
    expect(viewSource).toContain('icon-status')
    expect(viewSource).toContain('icon-caption')
    expect(glyphSource).toContain('icon-status')
    expect(glyphSource).toContain('text-caption')
  })
})