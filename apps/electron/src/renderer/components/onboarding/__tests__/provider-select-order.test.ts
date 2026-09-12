import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('provider select order', () => {
  it('lists Rox first, then subscriptions, then custom/local', () => {
    const source = readFileSync(join(import.meta.dir, '../ProviderSelectStep.tsx'), 'utf8')
    const rox = source.indexOf("ids: ['omp']")
    const subs = source.indexOf("ids: ['claude', 'chatgpt', 'copilot']")
    const custom = source.indexOf("ids: ['api_key', 'local']")
    expect(rox).toBeGreaterThan(0)
    expect(subs).toBeGreaterThan(rox)
    expect(custom).toBeGreaterThan(subs)
    expect(source).toContain('onboarding.providerSelect.otherProviderDesc')
    expect(source).toContain('onboarding.providerSelect.localModelDesc')
  })
})
