import { describe, expect, it } from 'bun:test'
import { isClaimContention, withClaimRetry } from '../document-writer-retry'

describe('document writer retry', () => {
  it('treats DOCUMENT_BUSY and rateLimited as contention', () => {
    expect(isClaimContention({ code: 'DOCUMENT_BUSY', message: 'x' })).toBe(true)
    expect(isClaimContention({ code: 'rateLimited', message: 'Document claim requires recovery' })).toBe(true)
    expect(isClaimContention(new Error('Document writer is busy'))).toBe(true)
    expect(isClaimContention({ code: 'HASH_CONFLICT', message: 'note revision conflict' })).toBe(false)
  })

  it('retries DOCUMENT_BUSY then returns the successful write', async () => {
    let attempts = 0
    const result = await withClaimRetry(async () => {
      attempts += 1
      if (attempts === 1) throw { code: 'DOCUMENT_BUSY', message: 'Document writer is busy' }
      return 'saved'
    })
    expect(result).toBe('saved')
    expect(attempts).toBe(2)
  }, 15_000)

  it('does not retry a permanent failure', async () => {
    let attempts = 0
    await expect(withClaimRetry(async () => {
      attempts += 1
      throw { code: 'HASH_CONFLICT', message: 'note revision conflict' }
    })).rejects.toMatchObject({ code: 'HASH_CONFLICT' })
    expect(attempts).toBe(1)
  })
})
