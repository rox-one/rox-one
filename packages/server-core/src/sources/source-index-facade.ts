/**
 * Production seam for the workspace source index.
 *
 * Callers (RPC sources.REINDEX/SEARCH and SessionManager retrieve) MUST import
 * from this module, not from source-index.ts directly. The TS implementation
 * stays primary; when CRAFT_FEATURE_NATIVE_SIDECAR is on, search/reindex also
 * run against the Rust sidecar and diffs are logged (shadow mode).
 */
import { isNativeSidecarEnabled } from '@craft-agent/shared/feature-flags'
import { getNativeSidecarClient } from '../native/supervisor.ts'
import {
  closeAllSourceIndexes,
  countIndexedFiles as countIndexedFilesTs,
  indexSourceTree,
  isSourceIndexFtsAvailable,
  reindexWorkspaceSources as reindexWorkspaceSourcesTs,
  retrieveSourcesForPrompt as retrieveSourcesForPromptTs,
  searchSourceIndex as searchSourceIndexTs,
  SOURCE_RETRIEVE_DEFAULT_LIMIT,
  SOURCE_RETRIEVE_MAX_TOKENS,
  walkSourceTree,
  type SourceReindexResult,
  type SourceRetrieveResult,
  type SourceSearchResult,
} from './source-index.ts'

export {
  closeAllSourceIndexes,
  indexSourceTree,
  isSourceIndexFtsAvailable,
  SOURCE_RETRIEVE_DEFAULT_LIMIT,
  SOURCE_RETRIEVE_MAX_TOKENS,
  walkSourceTree,
}
export type {
  SourceIndexFileRow,
  SourceReindexResult,
  SourceRetrieveHit,
  SourceRetrieveResult,
  SourceSearchHit,
  SourceSearchResult,
} from './source-index.ts'

function pathSet(paths: Array<{ path: string }>): string {
  return [...new Set(paths.map((h) => h.path))].sort().join('\n')
}

function shadowWarn(message: string, extra?: unknown): void {
  // Shadow diffs must be visible while the flag is on, even without CRAFT_DEBUG.
  console.warn(`[source-index-shadow] ${message}`, extra ?? '')
}

function shadowEnabled(): boolean {
  return isNativeSidecarEnabled() && getNativeSidecarClient() !== null
}

function fireShadow(work: () => Promise<void>): void {
  if (!shadowEnabled()) return
  void work().catch((error) => {
    shadowWarn('native invoke failed', error instanceof Error ? error.message : error)
  })
}

export function reindexWorkspaceSources(
  workspaceRoot: string,
  roots: Array<{ slug: string; path: string }>,
): SourceReindexResult {
  const ts = reindexWorkspaceSourcesTs(workspaceRoot, roots)
  fireShadow(async () => {
    const rust = await getNativeSidecarClient()!.invoke<SourceReindexResult>(
      'index:reindex',
      workspaceRoot,
      roots,
    )
    if (rust.indexed !== ts.indexed || Boolean(rust.truncated) !== Boolean(ts.truncated)) {
      shadowWarn('reindex diff', { ts: { indexed: ts.indexed, truncated: ts.truncated }, rust })
    }
  })
  return ts
}

export function searchSourceIndex(
  workspaceRoot: string,
  query: string,
  options: { limit?: number } = {},
): SourceSearchResult {
  const ts = searchSourceIndexTs(workspaceRoot, query, options)
  fireShadow(async () => {
    const rust = await getNativeSidecarClient()!.invoke<SourceSearchResult>(
      'index:search',
      workspaceRoot,
      query,
      options,
    )
    const tsPaths = pathSet(ts.hits)
    const rustPaths = pathSet(rust.hits ?? [])
    if (tsPaths !== rustPaths) {
      shadowWarn('search path-set diff', { query, ts: tsPaths, rust: rustPaths })
    }
  })
  return ts
}

export function retrieveSourcesForPrompt(
  workspaceRoot: string,
  query: string,
  options: { limit?: number; maxTokens?: number } = {},
): SourceRetrieveResult {
  const ts = retrieveSourcesForPromptTs(workspaceRoot, query, options)
  fireShadow(async () => {
    const rust = await getNativeSidecarClient()!.invoke<SourceRetrieveResult>(
      'index:retrieve',
      workspaceRoot,
      query,
      options,
    )
    const tsPaths = pathSet(ts.hits)
    const rustPaths = pathSet(rust.hits ?? [])
    if (tsPaths !== rustPaths) {
      shadowWarn('retrieve path-set diff', { query, ts: tsPaths, rust: rustPaths })
    }
  })
  return ts
}

export function countIndexedFiles(workspaceRoot: string): number {
  const ts = countIndexedFilesTs(workspaceRoot)
  fireShadow(async () => {
    const rust = await getNativeSidecarClient()!.invoke<number>('index:count', workspaceRoot)
    if (rust !== ts) {
      shadowWarn('count diff', { ts, rust })
    }
  })
  return ts
}
