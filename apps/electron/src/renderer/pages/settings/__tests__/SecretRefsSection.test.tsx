/**
 * SecretRefsSection — settings vertical slice for runtime.secretRefs.
 * Mock i18n as `t: (key) => key`. No secret values and no raw provider error
 * codes in visible markup.
 */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import {
  SecretProviderStatusRow,
  secretProviderStatus,
  secretProviderStatusKey,
  secretRefRowShowsUnavailable,
} from '../secret-refs-ui'

const pagesDir = join(import.meta.dir, '..')

describe('secretProviderStatus', () => {
  it('maps vault availability to a human status', () => {
    expect(secretProviderStatus(true)).toBe('connected')
    expect(secretProviderStatus(false)).toBe('disconnected')
    expect(secretProviderStatusKey('connected')).toBe('settings.runtime.secretProviderConnected')
    expect(secretProviderStatusKey('disconnected')).toBe('settings.runtime.secretProviderNotConnected')
  })
})

describe('secretRefRowShowsUnavailable', () => {
  it('is true only for vault-pinned rows when the vault is down', () => {
    expect(secretRefRowShowsUnavailable({ provider: 'infisical' }, false)).toBe(true)
    expect(secretRefRowShowsUnavailable({ provider: 'infisical' }, true)).toBe(false)
    expect(secretRefRowShowsUnavailable({ provider: 'environment' }, false)).toBe(false)
    expect(secretRefRowShowsUnavailable({}, false)).toBe(false)
  })
})

describe('SecretProviderStatusRow', () => {
  it('renders a localized status and never a raw provider error code', () => {
    const html = renderToStaticMarkup(<SecretProviderStatusRow available={false} />)
    expect(html).toContain('data-provider-status="disconnected"')
    expect(html).toContain('settings.runtime.secretProviderNotConnected')
    expect(html).not.toContain('INFISICAL_UNAVAILABLE')
    expect(html).not.toContain('Infisical is unavailable')
  })

  it('renders the connected state when the vault is reachable', () => {
    const html = renderToStaticMarkup(<SecretProviderStatusRow available={true} />)
    expect(html).toContain('data-provider-status="connected"')
    expect(html).toContain('settings.runtime.secretProviderConnected')
  })
})

describe('RuntimeSettingsPage mounts SecretRefsSection', () => {
  it('imports SecretRefsSection instead of a fake Infisical settings page', () => {
    const page = readFileSync(join(pagesDir, 'RuntimeSettingsPage.tsx'), 'utf8')
    const section = readFileSync(join(pagesDir, 'SecretRefsSection.tsx'), 'utf8')
    expect(page).toContain("from './SecretRefsSection'")
    expect(page).toContain('<SecretRefsSection')
    expect(page).not.toMatch(/InfisicalSettingsPage/)
    expect(section).toContain('getSecretRefs')
    expect(section).toContain('setSecretRefs')
    expect(section).not.toContain("<select")
    expect(section).toContain('PremiumMenuSelect')
    // Human states only — the raw provider error code is gone from visible text.
    expect(section).not.toContain('INFISICAL_UNAVAILABLE')
    expect(section).toContain('SecretProviderStatusRow')
    expect(section).not.toContain("@rox/shared/agent")
    expect(page).toContain('getToolchainDisabled?.()')
    expect(page).toContain('getDefaultThinkingLevel?.()')
    expect(page).toContain('getEnvOverrides?.()')
    expect(page).toContain('getWorkspaceSettings?.(')
  })
})