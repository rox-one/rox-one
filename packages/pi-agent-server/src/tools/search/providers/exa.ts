/**
 * Exa neural search. Credentials stay in env; errors never echo the key.
 */

import type { WebSearchProvider, WebSearchResult } from '../types.ts'

export const EXA_ENV_KEYS = ['EXA_API_KEY', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY'] as const

export function readExaApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of EXA_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text
  return text.split(secret).join('[redacted]')
}

interface ExaSearchResponse {
  results?: Array<{
    title?: string
    url?: string
    text?: string
    publishedDate?: string
  }>
}

export class ExaSearchProvider implements WebSearchProvider {
  name = 'Exa'

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const response = await this.fetchImpl('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: count,
        type: 'auto',
        contents: { text: { maxCharacters: 400 } },
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      const errorText = redactSecret(await response.text(), this.apiKey)
      throw new Error(`Exa search failed (HTTP ${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as ExaSearchResponse
    const results: WebSearchResult[] = []
    for (const item of data.results ?? []) {
      if (!item.url) continue
      results.push({
        title: item.title || item.url,
        url: item.url,
        description: item.text || item.publishedDate || '',
      })
      if (results.length >= count) break
    }
    return results
  }
}
