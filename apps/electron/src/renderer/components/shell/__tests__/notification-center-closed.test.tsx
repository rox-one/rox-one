/**
 * The boot-closure split moved the notification PANEL behind `React.lazy` and
 * left the sources subscription eager. The risk that buys: the subscription
 * only runs while the panel is mounted, so nothing is collected until someone
 * opens the bell — the exact opposite of what the panel is for.
 *
 * This renders the real `NotificationCenter` with the panel closed and proves
 * (a) the subscription ran and fed the store, and (b) no panel DOM exists. It
 * is the runtime half of
 * `__tests__/boot-closure-notification-center.test.ts`.
 */
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@rox/ui/tooltip'
import { NotificationCenter } from '../NotificationCenter'
import * as store from '../notifications'

useDomForFile()

let i18n: I18n

beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: { en: { translation: {} } },
  })
})

let root: Root | null = null
let host: HTMLDivElement | null = null
/** Every balance reading the sources subscription took, in call order. */
let balanceCalls: Array<{ status: 'ok'; balance: number }> = []

beforeEach(() => {
  localStorage.clear()
  store.resetNotificationsCache()
  balanceCalls = []
  host = document.createElement('div')
  document.body.appendChild(host)
  // The app's preload installs `window.electronAPI`; the balance feed reads
  // exactly one method. Spreading keeps whatever else the environment left.
  window.electronAPI = {
    ...window.electronAPI,
    getRoxBalance: async () => {
      const reading = { status: 'ok' as const, balance: 0.05 }
      balanceCalls.push(reading)
      return reading
    },
  }
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  host?.remove()
  host = null
})

async function mountClosed(): Promise<HTMLElement> {
  root = createRoot(host!)
  await act(async () => {
    root!.render(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(TooltipProvider, null, React.createElement(NotificationCenter, { workspaceId: 'w1' })),
      ),
    )
  })
  return host!
}

describe('the bell keeps collecting while the panel is closed', () => {
  it('runs the sources subscription, feeds the store and mounts no panel', async () => {
    const el = await mountClosed()

    // (a) The subscription is eager: it polled the balance with the panel shut
    //     and pushed the low-balance notification into the store.
    expect(balanceCalls.length).toBeGreaterThan(0)
    expect(store.getNotifications().map((n) => n.kind)).toEqual(['balance'])

    // (b) The panel is not mounted at all: no popover body, no rows.
    expect(el.querySelector('[data-testid="notification-center"]')).toBeNull()
    expect(el.querySelector('[data-notification-id]')).toBeNull()

    // The bell exists and shows the unread badge from the eager store read.
    const bell = el.querySelector('[data-notification-bell]')
    expect(bell).not.toBeNull()
    expect(bell?.getAttribute('data-unread')).toBe('1')
  })

  it('survives a re-render without the panel ever mounting', async () => {
    const el = await mountClosed()
    const before = store.getNotifications().length
    await act(async () => {
      store.pushNotification({ kind: 'agent', title: 'while closed', workspaceId: 'w1' })
    })
    expect(store.getNotifications().length).toBe(before + 1)
    expect(el.querySelector('[data-testid="notification-center"]')).toBeNull()
    expect(el.querySelector('[data-notification-bell]')?.getAttribute('data-unread')).toBe('2')
  })
})
