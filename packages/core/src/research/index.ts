export {
  DEFAULT_RESEARCH_CAPS,
  RESEARCH_CAP_CEILING,
  type CitationSpan,
  type PlannedQuery,
  type QueryProvenance,
  type RankedSource,
  type Reliability,
  type ResearchCacheDecision,
  type ResearchCaps,
  type ResearchConsent,
  type ResearchPlan,
  type ResearchProviderId,
  type ResearchQueryKind,
  type ResearchRequest,
  type ResearchRunResult,
  type SearchHit,
} from './types.ts'
export {
  clampResearchCaps,
  extractReferencedUrls,
  inferTopicLanguage,
  planEvidenceSearch,
  stripUrls,
} from './planner.ts'
export { canonicalUrl, dedupeAndRank, flagContradictions, sourceReliability } from './rank.ts'
export { decideResearchCache, shouldPersistResearchHit } from './cache-policy.ts'
export {
  citationMap,
  findCitationSpans,
  indexCitationViews,
  lookupCitation,
  toCitationView,
  type SourceCitationView,
} from './citations.ts'
export { runBoundedResearch, type ResearchSearchFn } from './execute.ts'
