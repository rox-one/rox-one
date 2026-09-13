import { ENRICHMENT_DEFAULT_QUERIES, ENRICHMENT_MAX_QUERIES, type EnrichmentPlan, type EnrichmentQuery } from './types.ts'
const GREETING = /^(hi|hello|hey|привет|здравствуйте)\W*$/i
const SECRET = /(api[_-]?key|password|token|sk-[a-z0-9]+|bearer\s+[a-z0-9._-]+)/i
export function buildQueryPlan(transcript: string, enabled: boolean): EnrichmentPlan {
  if (!enabled) return { queries: [], skipped: true, reason: 'disabled' }
  const text = transcript.trim()
  if (!text || GREETING.test(text)) return { queries: [], skipped: true, reason: 'not-needed' }
  if (SECRET.test(text) && /password\s*[:=]\s*\S+/i.test(text)) return { queries: [], skipped: true, reason: 'unsafe' }
  const cleaned = redactSecrets(text)
  const planned = [
    { id: 'q-subject', purpose: 'subject' as const, query: `official documentation ${cleaned}` },
    { id: 'q-constraints', purpose: 'constraints' as const, query: `constraints compatibility limits ${cleaned}` },
    { id: 'q-freshness', purpose: 'freshness' as const, query: `latest changes alternatives ${cleaned}` },
  ]
  const queries: EnrichmentQuery[] = planned.slice(0, ENRICHMENT_DEFAULT_QUERIES)
  return { queries: queries.slice(0, ENRICHMENT_MAX_QUERIES), skipped: false }
}
export function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9]+/g, '[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[redacted]').replace(/\/(?:Users|home)\/[^\s]+/g, '[path]')
}
