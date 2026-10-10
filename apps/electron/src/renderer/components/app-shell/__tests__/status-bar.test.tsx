/**
 * DISPATCH A6 — compact status bar reads the existing transport + account
 * sources and shows the app version from the update channel.
 *
 * Deliberately no `mock.module` here: bun's module mocks are process-global and
 * cannot be undone, so a react-i18next mock in this file made every later test
 * file in the same process render raw keys (UI-001 Recovery went red on CI and
 * locally whenever the readdir order put a t()-asserting file behind this one).
 * The static render exercises the SSR path: effects do not run, the transport
 * hook reports null, and the model defaults to the local workspace.
 */
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { StatusBar } from '../StatusBar'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: {
    'workbench.status.local': 'Local',
    'workbench.status.remote': 'Remote',
    'workbench.status.offline': 'Offline',
    'workbench.status.syncOk': 'Synced',
    'profile.balanceLabel': 'Balance',
    'profile.balance': '{{amount}}',
    'profile.balanceUnknown': 'No data',
    'statusBar.version': 'v{{version}}',
  } } },
})

const account = { balance: { availableRox: '12.500000' } } as RoxAccountSnapshot
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)

describe('compact status bar', () => {
  it('shows the workspace/sync state and the account balance', () => {
    const html = render(<StatusBar account={account} />)
    expect(html).toContain('data-testid="compact-status-bar"')
    // Without transport state the model reports the local workspace, synced.
    expect(html).toContain('Local')
    expect(html).toContain('Synced')
    // Balance label plus interpolated amount prove t('profile.balance',
    // { amount }) received the account value: a missing value would render the
    // raw {{amount}} template instead.
    expect(html).toContain('Balance 12.5')
  })
})