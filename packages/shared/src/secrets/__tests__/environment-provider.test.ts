/**
 * secrets/providers/environment.ts — allowlist-gated env resolution.
 */
import { describe, expect, it } from 'bun:test'
import { EnvironmentProvider, defaultEnvironmentRefFor } from '../providers/environment.ts'

describe('defaultEnvironmentRefFor', () => {
  it('derives ROX_SECRET_<NAME> from a logical name', () => {
    expect(defaultEnvironmentRefFor('openai')).toBe('ROX_SECRET_OPENAI')
    expect(defaultEnvironmentRefFor('my-api-key')).toBe('ROX_SECRET_MY_API_KEY')
    expect(defaultEnvironmentRefFor('My API Key!')).toBe('ROX_SECRET_MY_API_KEY_')
  })
})

describe('EnvironmentProvider', () => {
  it('is always available', async () => {
    const p = new EnvironmentProvider({ env: {} })
    expect(p.id).toBe('environment')
    expect(await p.isAvailable()).toBe(true)
  })

  it('resolves an allowlisted variable by explicit ref', async () => {
    const p = new EnvironmentProvider({ env: { ROX_SECRET_OPENAI: 'sk-test-value' } })
    expect(await p.resolve({ name: 'openai', ref: 'ROX_SECRET_OPENAI' })).toBe('sk-test-value')
  })

  it('resolves via the derived default ref when ref is omitted', async () => {
    const p = new EnvironmentProvider({ env: { ROX_SECRET_OPENAI: 'sk-test-value' } })
    expect(await p.resolve({ name: 'openai' })).toBe('sk-test-value')
  })

  it('returns null for allowlisted variables that are not set', async () => {
    const p = new EnvironmentProvider({ env: {} })
    expect(await p.resolve({ name: 'openai', ref: 'ROX_SECRET_OPENAI' })).toBeNull()
  })

  it('refuses variables outside the allowlist even when set', async () => {
    const p = new EnvironmentProvider({ env: { ANTHROPIC_API_KEY: 'must-not-leak' } })
    expect(await p.resolve({ name: 'anthropic', ref: 'ANTHROPIC_API_KEY' })).toBeNull()
  })

  it('supports custom allowlist prefixes', async () => {
    const p = new EnvironmentProvider({
      env: { MYAPP_TOKEN: 'tok-123', ROX_SECRET_X: 'nope' },
      prefixes: ['MYAPP_'],
    })
    expect(await p.resolve({ name: 't', ref: 'MYAPP_TOKEN' })).toBe('tok-123')
    // default prefix no longer allowed with a custom allowlist
    expect(await p.resolve({ name: 'x', ref: 'ROX_SECRET_X' })).toBeNull()
  })

  it('lists allowlisted variables that are set', async () => {
    const p = new EnvironmentProvider({
      env: { ROX_SECRET_A: '1', ROX_SECRET_B: '2', PATH: '/usr/bin' },
    })
    const refs = await p.list!()
    expect(refs.map(r => r.ref).sort()).toEqual(['ROX_SECRET_A', 'ROX_SECRET_B'])
  })
})
