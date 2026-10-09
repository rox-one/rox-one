/**
 * W3.1 — Лента sections: the segmented strip (shared Tabs primitive) carries
 * «Поток» / «Входящие» and selecting a section navigates to that section's
 * route, so the mode menu / rail deep-links into the merged screen.
 * Interaction runs against happy-dom.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { NAVIGATE_EVENT, type NavigateEventDetail } from '@/lib/navigate'
import { FeedSectionTabs } from '../FeedSectionTabs'

useDomForFile()
afterEach(() => { resetDom() })

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: {
      en: {
        translation: {
          'feed.section.label': 'Feed sections',
          'feed.section.stream': 'Stream',
          'feed.section.inbox': 'Inbox',
        },
      },
    },
  })
})

async function mount(node: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>) })
  return { root, container }
}

describe('Лента section strip', () => {
  it('shows both sections on one labelled tablist and marks the active one', async () => {
    const { root, container } = await mount(<FeedSectionTabs section="inbox" />)
    const tablist = container.querySelector('[role="tablist"]')
    expect(tablist?.getAttribute('aria-label')).toBe('Feed sections')
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(container.querySelector('[data-tab="inbox"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-tab="stream"]')?.getAttribute('aria-selected')).toBe('false')
    await act(async () => { root.unmount() })
  })

  it('navigates to the inbox route when «Входящие» is selected', async () => {
    const routes: string[] = []
    const listener = (event: Event) => routes.push((event as CustomEvent<NavigateEventDetail>).detail.route as string)
    window.addEventListener(NAVIGATE_EVENT, listener)
    const { root, container } = await mount(<FeedSectionTabs section="stream" />)
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-tab="inbox"]')!.click() })
    window.removeEventListener(NAVIGATE_EVENT, listener)
    await act(async () => { root.unmount() })
    expect(routes).toEqual(['inbox'])
  })

  it('navigates to the feed route when «Поток» is selected', async () => {
    const routes: string[] = []
    const listener = (event: Event) => routes.push((event as CustomEvent<NavigateEventDetail>).detail.route as string)
    window.addEventListener(NAVIGATE_EVENT, listener)
    const { root, container } = await mount(<FeedSectionTabs section="inbox" />)
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-tab="stream"]')!.click() })
    window.removeEventListener(NAVIGATE_EVENT, listener)
    await act(async () => { root.unmount() })
    expect(routes).toEqual(['feed'])
  })
})