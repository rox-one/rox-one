import { describe, expect, it } from 'bun:test'
import { getModelDisplayMetadata } from '../models'

describe('getModelDisplayMetadata', () => {
  it('resolves public Rox models to the Rox provider rather than the legacy Anthropic catalog', () => {
    expect(getModelDisplayMetadata('rox/standard')).toEqual({
      id: 'rox/standard',
      name: 'ROX Standard',
      shortName: 'Standard',
      provider: 'rox',
    })
  })

  it('returns no provider metadata for a missing or arbitrary model', () => {
    expect(getModelDisplayMetadata(undefined)).toBeUndefined()
    expect(getModelDisplayMetadata('custom/local-model')).toBeUndefined()
  })

  it('preserves catalog metadata for an explicit known model', () => {
    expect(getModelDisplayMetadata('claude-sonnet-5')).toMatchObject({
      name: 'Sonnet 5',
      shortName: 'Sonnet',
      provider: 'anthropic',
    })
  })
})
