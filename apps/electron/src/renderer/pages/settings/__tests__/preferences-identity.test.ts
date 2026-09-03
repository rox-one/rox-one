import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(
  join(import.meta.dir, '..', 'PreferencesPage.tsx'),
  'utf-8',
)

describe('PreferencesPage agent identity', () => {
  it('exposes agent name and persona fields backed by AgentIdentity', () => {
    expect(SOURCE).toContain("t('settings.identity.title')")
    expect(SOURCE).toContain("t('settings.identity.name')")
    expect(SOURCE).toContain("t('settings.identity.persona')")
    expect(SOURCE).toContain('persistAgentIdentity')
    expect(SOURCE).toContain('agentIdentity')
  })
})
