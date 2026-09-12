import type { ResearchCacheDecision, ResearchConsent } from './types.ts'

/**
 * Search-result cache follows explicit search-cache consent and provider terms.
 * Indexing / product-improvement consent is never enough to store SERP copies.
 */
export function decideResearchCache(consent: ResearchConsent | null | undefined): ResearchCacheDecision {
  if (!consent || consent.searchCache !== true) return 'none'
  return 'local'
}

export function shouldPersistResearchHit(consent: ResearchConsent | null | undefined): boolean {
  return decideResearchCache(consent) === 'local'
}
