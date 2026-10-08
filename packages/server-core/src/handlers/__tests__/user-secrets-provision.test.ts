import { describe, expect, it } from 'bun:test'
import { provisionDefaultSecretsForUser } from '../user-secrets-provision.ts'

describe('provisionDefaultSecretsForUser', () => {
  it('returns stable ref ids for each default key', async () => {
    const result = await provisionDefaultSecretsForUser('user-abc')
    expect(result.userId).toBe('user-abc')
    expect(result.refs.length).toBeGreaterThan(5)
    const rox = result.refs.find((r) => r.key === 'ROX_API_KEY')
    expect(rox?.ref).toBe('rox://secret/user-abc/ROX_API_KEY/v1')
    expect(rox?.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const pinecone = result.refs.find((r) => r.key === 'PINECONE_API_KEY')
    expect(pinecone?.ref).toBe('rox://secret/user-abc/PINECONE_API_KEY/v1')
  })
})
