/**
 * Production seam for the workspace source index.
 *
 * Callers (RPC sources.REINDEX/SEARCH and SessionManager retrieve) MUST import
 * from this module, not from source-index.ts directly. The TS implementation
 * stays primary; when CRAFT_FEATURE_NATIVE_SIDECAR is on, search/reindex also
 * run against the Rust sidecar and diffs are logged (shadow mode).
 */
export {
  closeAllSourceIndexes,
  countIndexedFiles,
  indexSourceTree,
  isSourceIndexFtsAvailable,
  reindexWorkspaceSources,
  retrieveSourcesForPrompt,
  searchSourceIndex,
  SOURCE_RETRIEVE_DEFAULT_LIMIT,
  SOURCE_RETRIEVE_MAX_TOKENS,
  walkSourceTree,
} from './source-index'
export type {
  SourceIndexFileRow,
  SourceReindexResult,
  SourceRetrieveHit,
  SourceRetrieveResult,
  SourceSearchHit,
  SourceSearchResult,
} from './source-index'
