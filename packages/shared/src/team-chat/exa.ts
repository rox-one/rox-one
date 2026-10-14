/**
 * Exa web search (https://docs.exa.ai/reference/search) with the resolved key.
 * Runs in the main process only; the key never reaches the renderer or logs.
 */
import { resolveCallCredentials } from './call-credentials.ts'

export interface ExaResult { title: string; url: string; publishedDate?: string; author?: string; text?: string }

export async function exaSearch(query: string, opts: { numResults?: number; fetchImpl?: typeof fetch } = {}): Promise<ExaResult[]> {
  const q = typeof query === 'string' ? query.trim().slice(0, 500) : ''
  if (!q) throw new Error('query is required')
  const key = resolveCallCredentials().exaApiKey
  if (!key) throw new Error('Exa is not configured')
  const res = await (opts.fetchImpl ?? fetch)('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query: q, numResults: Math.min(Math.max(1, opts.numResults ?? 5), 20), contents: { text: { maxCharacters: 500 } } }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Exa search failed (${res.status})`)
  const body = await res.json() as { results?: Array<Record<string, unknown>> }
  return (body.results ?? []).map(r => ({
    title: String(r.title ?? r.url ?? ''),
    url: String(r.url ?? ''),
    ...(typeof r.publishedDate === 'string' ? { publishedDate: r.publishedDate } : {}),
    ...(typeof r.author === 'string' ? { author: r.author } : {}),
    ...(typeof r.text === 'string' ? { text: r.text } : {}),
  })).filter(r => /^https?:\/\//.test(r.url))
}
