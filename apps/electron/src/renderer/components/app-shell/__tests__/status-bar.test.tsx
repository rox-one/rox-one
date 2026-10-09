/**
 * DISPATCH A6 — compact status bar reads the existing transport + account
 * sources and shows the app version from the update channel.
 */
import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}(${JSON.stringify(values)})` : key),
  }),
}))

mock.module('@/hooks/useTransportConnectionState', () => ({
  useTransportConnectionState: () => ({ mode: 'local', status: 'idle' }),
}))

import { StatusBar } from '../StatusBar'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const account = { balance: { availableRox: '12.500000' } } as RoxAccountSnapshot

describe('compact status bar', () => {
  it('shows the workspace/sync state and the account balance', () => {
    const html = renderToStaticMarkup(<StatusBar account={account} />)
    expect(html).toContain('data-testid="compact-status-bar"')
    expect(html).toContain('workbench.status.local')
    expect(html).toContain('workbench.status.syncOk')
    expect(html).toContain('profile.balanceLabel')
    // Same formatting path as ProfileStrip: t('profile.balance', { amount }).
    expect(html).toContain('profile.balance({"amount":12.5})')
  })
})