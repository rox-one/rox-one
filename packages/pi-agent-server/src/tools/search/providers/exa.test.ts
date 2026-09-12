import { describe, expect, it } from 'bun:test'
import { ExaSearchProvider, readExaApiKey } from './exa.ts'

describe('ExaSearchProvider', () => {
  it('reads the first configured env key and never returns empty secrets', () => {
    expect(readExaApiKey({} as NodeJS.ProcessEnv)).toBeUndefined()
    expect(readExaApiKey({ EXA_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBeUndefined()
    expect(readExaApiKey({ ROX_EXA_API_KEY: 'abc' } as NodeJS.ProcessEnv)).toBe('abc')
  })

  it('maps Exa hits and redacts the key from HTTP errors', async () => {
    const key = 'exa-secret-test-key'
    const fetchImpl: typeof fetch = async () =>
      new Response('unauthorized exa-secret-test-key', { status: 401 }) as Response
    const provider = new ExaSearchProvider(key, fetchImpl)
    await expect(provider.search('rox', 3)).rejects.toThrow(/\[redacted\]/)
    try {
      await provider.search('rox', 3)
    } catch (err) {
      expect(String(err)).not.toContain(key)
    }
  })

  it('returns title/url/snippet without logging credentials', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-api-key')).toBe('k')
      return new Response(
        JSON.stringify({
          results: [
            { title: 'A', url: 'https://a.test', text: 'one', publishedDate: '2026-01-01' },
            { title: 'B', url: 'https://b.test', text: 'two' },
          ],
        }),
        { status: 200 },
      ) as Response
    }
    const provider = new ExaSearchProvider('k', fetchImpl)
    const results = await provider.search('query', 1)
    expect(results).toEqual([{ title: 'A', url: 'https://a.test', description: 'one' }])
  })
})
