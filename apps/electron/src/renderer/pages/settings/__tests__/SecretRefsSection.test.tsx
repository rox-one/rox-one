/**
 * SecretRefsSection — settings vertical slice for runtime.secretRefs.
 * Mock i18n as `t: (key) => key`. No secret values in markup.
 */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import {
  InfisicalUnavailableRow,
  secretRefRowShowsUnavailable,
} from '../secret-refs-ui'

const pagesDir = join(import.meta.dir, '..')

describe('secretRefRowShowsUnavailable', () => {
  it('is true only for infisical-pinned rows when Infisical is down', () => {
    expect(secretRefRowShowsUnavailable({ provider: 'infisical' }, false)).toBe(true)
    expect(secretRefRowShowsUnavailable({ provider: 'infisical' }, true)).toBe(false)
    expect(secretRefRowShowsUnavailable({ provider: 'environment' }, false)).toBe(false)
    expect(secretRefRowShowsUnavailable({}, false)).toBe(false)
  })
})

describe('InfisicalUnavailableRow', () => {
  it('renders a typed INFISICAL_UNAVAILABLE state and never a placeholder Infisical page', () => {
    const html = renderToStaticMarkup(
      <InfisicalUnavailableRow available={false} errorCode="INFISICAL_UNAVAILABLE" />,
    )
    expect(html).toContain('data-error-code="INFISICAL_UNAVAILABLE"')
    expect(html).toContain('settings.runtime.secretInfisicalUnavailable')
    expect(html).not.toContain('placeholder')
    expect(html.toLowerCase()).not.toContain('infisical settings')
  })

  it('renders nothing when Infisical is available', () => {
    const html = renderToStaticMarkup(<InfisicalUnavailableRow available={true} />)
    expect(html).toBe('')
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
    expect(section).not.toContain("@craft-agent/shared/secrets")
    expect(section).not.toContain("@craft-agent/shared/agent")
  })
})
