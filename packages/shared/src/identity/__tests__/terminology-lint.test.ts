import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMPATIBILITY_RUNTIME_TERMS,
  isCompatibilityRuntimeTerm,
  localeValueViolations,
  ROX_VISIBLE_TERMS,
} from '../terms'

const LOCALES_DIR = join(import.meta.dir, '../../i18n/locales')

describe('Rox terminology catalog', () => {
  it('exports the visible product terms', () => {
    expect(ROX_VISIBLE_TERMS.product).toBe('Rox')
    expect(ROX_VISIBLE_TERMS.cli).toBe('Rox CLI')
    expect(ROX_VISIBLE_TERMS.cloud).toBe('Rox Cloud')
    expect(ROX_VISIBLE_TERMS.defaultAgentName).toBe('Agent Rox#001')
  })

  it('classifies OMP/Pi/Craft/Hermes as compatibility runtime terms', () => {
    for (const term of COMPATIBILITY_RUNTIME_TERMS) {
      expect(isCompatibilityRuntimeTerm(term)).toBe(true)
    }
    expect(isCompatibilityRuntimeTerm('Rox')).toBe(false)
    expect(isCompatibilityRuntimeTerm('Rox CLI')).toBe(false)
  })
})

describe('terminology linter', () => {
  it('does not flag allowlisted compatibility locale keys', () => {
    expect(localeValueViolations('skillsList.ompBadge', 'OMP')).toEqual([])
    expect(localeValueViolations('onboarding.reauth.loginAgain', 'Craft Agents')).toEqual([])
    expect(localeValueViolations('errors.omp.noModels.title', 'OMP has no models configured')).toEqual([])
  })

  it('flags runtime names in normal-UI locale values', () => {
    expect(localeValueViolations('onboarding.providerSelect.ompDesc', 'Local oh-my-pi agent')).toContain('oh-my-pi')
    expect(localeValueViolations('settings.identity.title', 'OMP identity')).toContain('OMP')
    expect(localeValueViolations('onboarding.welcome.title', 'Welcome to Craft Agents')).toContain('Craft Agents')
  })

  it('scans every locale for leaked runtime names outside the allowlist', () => {
    const files = readdirSync(LOCALES_DIR).filter((file) => file.endsWith('.json'))
    expect(files.length).toBe(10)
    const leaks: string[] = []
    for (const file of files) {
      const json = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8')) as Record<string, string>
      for (const [key, value] of Object.entries(json)) {
        if (typeof value !== 'string') continue
        const hits = localeValueViolations(key, value)
        for (const hit of hits) leaks.push(`${file} ${key}: ${hit}`)
      }
    }
    expect(leaks).toEqual([])
  })
})
