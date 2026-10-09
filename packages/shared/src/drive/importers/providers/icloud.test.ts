/**
 * The iCloud provider is deliberately unsupported: it must fail loudly with a
 * typed error and a clear Russian message, never fabricate behavior.
 */
import { describe, test, expect } from 'bun:test'
import { ImportProviderError } from './auth'
import { createICloudProvider, ICLOUD_UNSUPPORTED_MESSAGE } from './icloud'

describe('createICloudProvider', () => {
  test('advertises the icloud id', () => {
    expect(createICloudProvider().id).toBe('icloud')
  })

  test('list() rejects with a typed unsupported error in Russian', async () => {
    const provider = createICloudProvider()
    await expect(provider.list()).rejects.toBeInstanceOf(ImportProviderError)
    try {
      await provider.list()
    } catch (error) {
      const typed = error as ImportProviderError
      expect(typed.code).toBe('unsupported')
      expect(typed.provider).toBe('icloud')
      expect(typed.message).toBe(ICLOUD_UNSUPPORTED_MESSAGE)
    }
  })

  test('stream() rejects with the same unsupported error', async () => {
    const provider = createICloudProvider()
    await expect(provider.stream('anything')).rejects.toMatchObject({
      name: 'ImportProviderError',
      code: 'unsupported',
      provider: 'icloud',
    })
  })
})