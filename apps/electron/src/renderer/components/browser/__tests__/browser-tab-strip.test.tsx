/**
 * W2.1 — browser tabs on the shared tab primitive.
 *
 * `BrowserTabStripView` is the hook-free half of the strip: it maps instances
 * onto `TabItem[]` and renders the shared `Tabs` primitive (real, unmocked —
 * that is where the ARIA/keyboard/close contract lives) plus the trailing
 * actions menu. The static-markup cases render the real component for anatomy;
 * the happy-dom cases drive the same component to prove the behaviour that the
 * strip itself wires (selection, closing, the overflow menu and its enabling
 * rules) instead of reading the source file to infer it.
 *
 * `@rox/ui` is stubbed with the repo's usual lightweight stand-ins. The Radix
 * menu only renders its content when opened — neither static rendering nor
 * happy-dom opens it — so the menu stand-in renders its content inline and
 * forwards each item's `disabled`/`variant`, the only way the strip's own
 * per-instance enabling logic is observable without a real browser.
 */

// Installed first: react-dom feature-detects `document` at load time, so the
// happy-dom globals must exist before it is evaluated (see dom-env's header).
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
  StyledDropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyledDropdownMenuItem: ({ children, disabled, variant }: { children?: ReactNode; disabled?: boolean; variant?: string }) => (
    <div data-menu-item="" data-variant={variant} data-disabled={disabled ? 'true' : 'false'}>{children}</div>
  ),
  StyledDropdownMenuSeparator: () => null,
  StyledDropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => (
    <div data-menu-subtrigger="">{children}</div>
  ),
  StyledDropdownMenuSubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

import { BrowserTabStripView, type BrowserTabStripViewProps } from '../BrowserTabStripView'

useDomForFile()
afterEach(() => { resetDom() })

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

const noop = () => {}

const stripProps = (partial: Partial<BrowserTabStripViewProps> = {}): BrowserTabStripViewProps => ({
  instances: [instance({ id: 'a', title: 'Docs' })],
  activeInstanceId: 'a',
  liveWindowActions: true,
  onFocusWindow: noop,
  onOpenSession: noop,
  onTerminate: noop,
  ...partial,
})

const render = (props: BrowserTabStripViewProps) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(BrowserTabStripView, props)))

async function mount(node: ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>) })
  return { root, container }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

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

describe('BrowserTabStripView behaviour through the shared primitive', () => {
  it('shows only the capped tabs plus the +k overflow count in the trailing menu', async () => {
    // Catches a strip that stops respecting maxVisibleBadges or drops the +k count.
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({
        instances: [
          instance({ id: 'a', title: 'One' }),
          instance({ id: 'b', title: 'Two' }),
          instance({ id: 'c', title: 'Three' }),
        ],
        maxVisibleBadges: 2,
      })} />,
    )

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(container.querySelector('[aria-label="Browser windows"]')?.textContent).toContain('+1')
    await unmount(root)
  })

  it('focuses the instance whose tab is selected', async () => {
    // Catches onSelect that no longer forwards the clicked instance to onFocusWindow.
    const focused: string[] = []
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({
        instances: [instance({ id: 'a', title: 'One' }), instance({ id: 'b', title: 'Two' })],
        onFocusWindow: (target) => focused.push(target.id),
      })} />,
    )

    await act(async () => { container.querySelector<HTMLElement>('[data-tab="b"]')!.click() })
    expect(focused).toEqual(['b'])
    await unmount(root)
  })

  it('terminates the instance from its labelled close button', async () => {
    // Catches a close button that stops calling onTerminate.
    const terminated: string[] = []
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({ onTerminate: (target) => terminated.push(target.id) })} />,
    )

    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Close browser window: Docs"]')!.click()
    })
    expect(terminated).toEqual(['a'])
    await unmount(root)
  })

  it('closes the focused tab on Delete', async () => {
    // Catches losing the primitive's Delete/Backspace close wiring.
    const terminated: string[] = []
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({
        instances: [instance({ id: 'a', title: 'One' }), instance({ id: 'b', title: 'Two' })],
        onTerminate: (target) => terminated.push(target.id),
      })} />,
    )

    const tab = container.querySelector<HTMLElement>('[data-tab="a"]')!
    await act(async () => {
      tab.focus()
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    })
    expect(terminated).toEqual(['a'])
    await unmount(root)
  })

  it('closes the tab from a middle-click', async () => {
    // Catches losing the primitive's auxiliary-click (button 1) close surface.
    const terminated: string[] = []
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({
        instances: [instance({ id: 'a', title: 'One' }), instance({ id: 'b', title: 'Two' })],
        onTerminate: (target) => terminated.push(target.id),
      })} />,
    )

    await act(async () => {
      container.querySelector('[data-tab-item="b"]')!
        .dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))
    })
    expect(terminated).toEqual(['b'])
    await unmount(root)
  })

  it('lists every instance in the trailing menu and disables its destructive action when window actions are off', async () => {
    // Catches a menu that skips overflowed instances or ignores liveWindowActions.
    const instances = [
      instance({ id: 'a', title: 'One' }),
      instance({ id: 'b', title: 'Two' }),
      instance({ id: 'c', title: 'Three' }),
    ]
    const off = await mount(
      <BrowserTabStripView {...stripProps({ instances, maxVisibleBadges: 2, liveWindowActions: false })} />,
    )

    const labels = Array.from(off.container.querySelectorAll('[data-menu-subtrigger]')).map((el) => el.textContent)
    expect(labels).toHaveLength(3)
    expect(labels.join(' ')).toContain('Three')
    const disabled = Array.from(off.container.querySelectorAll('[data-menu-item][data-variant="destructive"]'))
    expect(disabled).toHaveLength(3)
    expect(disabled.every((el) => el.getAttribute('data-disabled') === 'true')).toBe(true)
    await unmount(off.root)

    const on = await mount(
      <BrowserTabStripView {...stripProps({ instances, maxVisibleBadges: 2 })} />,
    )
    const enabled = Array.from(on.container.querySelectorAll('[data-menu-item][data-variant="destructive"]'))
    expect(enabled.every((el) => el.getAttribute('data-disabled') === 'false')).toBe(true)
    await unmount(on.root)
  })

  it('renders nothing without instances', async () => {
    // Catches the strip rendering empty tablist chrome for an empty registry.
    const { root, container } = await mount(
      <BrowserTabStripView {...stripProps({ instances: [], activeInstanceId: null })} />,
    )

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(container.innerHTML).toBe('')
    await unmount(root)
  })

  it('dresses the rendered strip in tokens, never literal sizes or raw colours', async () => {
    // Catches a literal chip size or raw colour creeping back into the rendered strip.
    const { root, container } = await mount(<BrowserTabStripView {...stripProps()} />)

    const html = container.innerHTML
    expect(html).toContain('--radius-control')
    expect(html).toContain('--control-sm')
    expect(html).toContain('icon-status')
    expect(html).toContain('icon-caption')
    expect(html).not.toContain('h-[26px]')
    expect(html).not.toContain('strokeWidth')
    expect(html).not.toContain('text-white/')
    await unmount(root)
  })
})