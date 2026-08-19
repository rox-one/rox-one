/**
 * secrets/types.ts — SecretRefEntry schema validation + SecretResolveError shape.
 */
import { describe, expect, it } from 'bun:test'
import {
  SECRET_PROVIDER_IDS,
  SecretConfigError,
  SecretRefEntrySchema,
  SecretResolveError,
  toPublicSecretRef,
} from '../types.ts'

describe('SECRET_PROVIDER_IDS', () => {
  it('contains exactly the three known providers in chain order', () => {
    expect(SECRET_PROVIDER_IDS).toEqual(['environment', 'local-encrypted', 'infisical'])
  })
})

describe('SecretRefEntrySchema', () => {
  it('accepts a minimal entry with name + envVar', () => {
    const r = SecretRefEntrySchema.safeParse({ name: 'openai', envVar: 'OPENAI_API_KEY' })
    expect(r.success).toBe(true)
  })

  it('accepts a fully specified entry', () => {
    const r = SecretRefEntrySchema.safeParse({
      name: 'openai',
      envVar: 'OPENAI_API_KEY',
      provider: 'infisical',
      ref: 'OPENAI_API_KEY',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(SecretRefEntrySchema.safeParse({ name: '', envVar: 'X' }).success).toBe(false)
  })

  it('rejects an invalid envVar shape', () => {
    for (const envVar of ['HAS SPACE', 'foo-bar', '1ABC', 'foo=bar', '']) {
      expect(SecretRefEntrySchema.safeParse({ name: 'x', envVar }).success).toBe(false)
    }
  })

  it('rejects an unknown provider id', () => {
    const r = SecretRefEntrySchema.safeParse({ name: 'x', envVar: 'X', provider: 'vault' })
    expect(r.success).toBe(false)
  })

  it('rejects an empty ref string', () => {
    const r = SecretRefEntrySchema.safeParse({ name: 'x', envVar: 'X', ref: '' })
    expect(r.success).toBe(false)
  })
})

describe('SecretResolveError', () => {
  it('carries code, provider and message', () => {
    const err = new SecretResolveError('INFISICAL_AUTH_FAILED', 'infisical', 'bad token')
    expect(err.code).toBe('INFISICAL_AUTH_FAILED')
    expect(err.provider).toBe('infisical')
    expect(err.message).toBe('bad token')
    expect(err instanceof Error).toBe(true)
  })
})

describe('SecretConfigError', () => {
  it('carries typed SECRET_ENVVAR_DENIED without a provider', () => {
    const err = new SecretConfigError('SECRET_ENVVAR_DENIED', 'secret ref envVar not allowed: PATH', 'PATH')
    expect(err.name).toBe('SecretConfigError')
    expect(err.code).toBe('SECRET_ENVVAR_DENIED')
    expect(err.envVar).toBe('PATH')
    expect(err instanceof Error).toBe(true)
  })
})

describe('toPublicSecretRef', () => {
  it('keeps name/envVar/provider/ref and strips value', () => {
    const planted = 'sk-must-not-appear'
    const out = toPublicSecretRef({
      name: 'openai',
      envVar: 'OPENAI_API_KEY',
      provider: 'infisical',
      ref: 'OPENAI_API_KEY',
      value: planted,
    } as { name: string; envVar: string; provider: 'infisical'; ref: string; value: string })
    expect(out).toEqual({
      name: 'openai',
      envVar: 'OPENAI_API_KEY',
      provider: 'infisical',
      ref: 'OPENAI_API_KEY',
    })
    expect(JSON.stringify(out)).not.toContain(planted)
    expect('value' in out).toBe(false)
  })
})
