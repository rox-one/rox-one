/**
 * ConnectedAccountsSection — the "Connected accounts" surface on the Profile
 * (Accounts & Connections) settings page.
 *
 * Renders against a synthetic renderer transport (`window.electronAPI`), the
 * same preload/RPC boundary the sibling settings suites use, so the connect and
 * sign-out dispatches are the real ones the fabric exposes.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NAVIGATE_EVENT, type NavigateEventDetail } from '@/lib/navigate'
import type { ServiceConnection } from '../../../../shared/types'
import type { ConnectedAccountsSection as ConnectedAccountsSectionComponent } from '../ConnectedAccountsSection'

useDomForFile()

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: async () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}))

mock.module('sonner', () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}))

// Typed with the REAL args of `window.electronAPI.*` so the call assertions below
// read the argument the component actually passed.
const identityConnect = mock(async (_args: { provider: string; workspaceId: string; accountLabel?: string; credentialValue?: string; connectionId?: string }) => ({}))
const identityDisconnect = mock(async (_args: { connectionId: string }) => ({}))
const identityRefreshStatus = mock(async (_args?: { workspaceId?: string }) => ({}))

Object.assign(window, {
  electronAPI: { identityConnect, identityDisconnect, identityRefreshStatus },
})

function connection(overrides: Partial<ServiceConnection> = {}): ServiceConnection {
  return {
    id: 'svc-github',
    workspaceId: 'ws-1',
    provider: 'github',
    accountLabel: 'octocat',
    status: 'connected',
    ...overrides,
  }
}

/** Mounted in `beforeAll` so the component module sees the transport mock. */
let ConnectedAccountsSection: typeof ConnectedAccountsSectionComponent

describe('ConnectedAccountsSection', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeAll(async () => {
    // Static import cannot work: the component module graph must load only
    // after the transport/i18n mocks above are registered.
    ConnectedAccountsSection = (await import('../ConnectedAccountsSection')).ConnectedAccountsSection
  })

  beforeEach(() => {
    identityConnect.mockClear()
    identityDisconnect.mockClear()
    identityRefreshStatus.mockClear()
  })

  afterEach(async () => {
    const mounted = root
    root = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  async function render(
    connections: ServiceConnection[],
    workspaceId: string | undefined = 'ws-1',
  ): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(ConnectedAccountsSection, { connections, workspaceId }),
      )
    })
  }

  function buttonByText(label: string): HTMLButtonElement {
    const match = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    )
    if (!match) throw new Error(`button "${label}" not found`)
    return match
  }

  it('renders each connected account with its provider label and status', async () => {
    await render([connection({ id: 'svc-github', provider: 'github', status: 'connected' })])

    expect(container.textContent).toContain('settings.accounts.connectedAccountsSection')
    expect(container.textContent).toContain('Github')
    expect(container.textContent).toContain('octocat')
    expect(container.textContent).toContain('settings.accounts.status.connected')
  })

  it('shows an honest empty state when nothing is connected', async () => {
    await render([])

    expect(container.textContent).toContain('settings.accounts.connectedAccountsEmpty')
    expect(container.textContent).not.toContain('Github')
  })

  it('dispatches identity.connect when an account is connected', async () => {
    await render([], 'ws-1')

    await act(async () => {
      buttonByText('settings.accounts.connect').click()
    })

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(identityConnect).toHaveBeenCalledTimes(1)
    expect(identityConnect.mock.calls[0]?.[0]).toMatchObject({
      provider: 'github',
      workspaceId: 'ws-1',
    })
  })

  it('dispatches identity.disconnect when an owned account is signed out', async () => {
    await render([connection({ id: 'svc-github' })])

    await act(async () => {
      buttonByText('settings.accounts.signOut').click()
    })

    expect(identityDisconnect).toHaveBeenCalledTimes(1)
    expect(identityDisconnect.mock.calls[0]?.[0]).toEqual({ connectionId: 'svc-github' })
  })

  it('links a read-only reflection out to AI Settings instead of disconnecting it', async () => {
    const routes: string[] = []
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<NavigateEventDetail>).detail
      if (detail) routes.push(String(detail.route))
    }
    window.addEventListener(NAVIGATE_EVENT, listener)
    try {
      await render([
        connection({
          id: 'llm:openai',
          provider: 'openai',
          status: 'connected',
          accountLabel: 'OpenAI (work)',
          readOnly: true,
        }),
      ])

      expect(container.textContent).toContain('settings.accounts.managedInAi')
      expect(container.querySelector('button[title="settings.accounts.signOut"]')).toBeNull()
      expect(Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent === 'settings.accounts.signOut',
      )).toBe(false)

      await act(async () => {
        buttonByText('settings.accounts.openAiSettings').click()
      })

      expect(routes).toContain('settings/ai')
      expect(identityDisconnect).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(NAVIGATE_EVENT, listener)
    }
  })
})