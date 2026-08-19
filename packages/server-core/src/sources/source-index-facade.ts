/**
 * Production seam for the workspace source index.
 *
 * Callers (RPC sources.REINDEX/SEARCH/STATUS and SessionManager retrieve) MUST import
 * from this module, not from source-index.ts directly.
 *
 * Default: TypeScript stays primary (2000/32MB). When
 * CRAFT_FEATURE_NATIVE_SIDECAR is on, search/reindex also run against the Rust
 * sidecar and diffs are logged (shadow mode).
 *
 * CRAFT_FEATURE_NATIVE_INDEX_PRIMARY=1 (requires sidecar): Rust is primary
 * (20k files / 256MB). TS is the fallback if the sidecar invoke fails.
 */
import { join } from 'node:path'
import { isNativeIndexPrimaryEnabled, isNativeSidecarEnabled } from '@craft-agent/shared/feature-flags'
import { getNativeSidecarClient } from '../native/supervisor.ts'
import {
  closeAllSourceIndexes,
  countIndexedFiles as countIndexedFilesTs,
  indexSourceTree,
  isSourceIndexFtsAvailable,
  reindexWorkspaceSources as reindexWorkspaceSourcesTs,
  retrieveSourcesForPrompt as retrieveSourcesForPromptTs,
  searchSourceIndex as searchSourceIndexTs,
  SOURCE_INDEX_REL,
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
  return (
    isNativeSidecarEnabled() &&
    !isNativeIndexPrimaryEnabled() &&
    getNativeSidecarClient() !== null
  )
}

function primaryEnabled(): boolean {
  return isNativeIndexPrimaryEnabled() && getNativeSidecarClient() !== null
}

async function tryPrimary<T>(op: string, work: () => Promise<T>): Promise<T | undefined> {
  if (!primaryEnabled()) return undefined
  try {
    return await work()
  } catch (error) {
    console.warn(
      `[source-index-primary] ${op} failed, falling back to TS`,
      error instanceof Error ? error.message : error,
    )
    return undefined
  }
}

function fireShadow(work: () => Promise<void>): void {
  if (!shadowEnabled()) return
  void work().catch((error) => {
    shadowWarn('native invoke failed', error instanceof Error ? error.message : error)
  })
}

export async function reindexWorkspaceSources(
  workspaceRoot: string,
  roots: Array<{ slug: string; path: string }>,
): Promise<SourceReindexResult> {
  const rust = await tryPrimary('reindex', () =>
    getNativeSidecarClient()!.invoke<SourceReindexResult>('index:reindex', workspaceRoot, roots),
  )
  if (rust) return rust
  const ts = reindexWorkspaceSourcesTs(workspaceRoot, roots)
  fireShadow(async () => {
    const shadow = await getNativeSidecarClient()!.invoke<SourceReindexResult>(
      'index:reindex',
      workspaceRoot,
      roots,
    )
    if (shadow.indexed !== ts.indexed || Boolean(shadow.truncated) !== Boolean(ts.truncated)) {
      shadowWarn('reindex diff', { ts: { indexed: ts.indexed, truncated: ts.truncated }, rust: shadow })
    }
  })
  return ts
}

export async function searchSourceIndex(
  workspaceRoot: string,
  query: string,
  options: { limit?: number } = {},
): Promise<SourceSearchResult> {
  const rust = await tryPrimary('search', () =>
    getNativeSidecarClient()!.invoke<SourceSearchResult>(
      'index:search',
      workspaceRoot,
      query,
      options,
    ),
  )
  if (rust) return rust
  const ts = searchSourceIndexTs(workspaceRoot, query, options)
  fireShadow(async () => {
    const shadow = await getNativeSidecarClient()!.invoke<SourceSearchResult>(
      'index:search',
      workspaceRoot,
      query,
      options,
    )
    const tsPaths = pathSet(ts.hits)
    const rustPaths = pathSet(shadow.hits ?? [])
    if (tsPaths !== rustPaths) {
      shadowWarn('search path-set diff', { query, ts: tsPaths, rust: rustPaths })
    }
  })
  return ts
}

export async function retrieveSourcesForPrompt(
  workspaceRoot: string,
  query: string,
  options: { limit?: number; maxTokens?: number } = {},
): Promise<SourceRetrieveResult> {
  const rust = await tryPrimary('retrieve', () =>
    getNativeSidecarClient()!.invoke<SourceRetrieveResult>(
      'index:retrieve',
      workspaceRoot,
      query,
      options,
    ),
  )
  if (rust) return rust
  const ts = retrieveSourcesForPromptTs(workspaceRoot, query, options)
  fireShadow(async () => {
    const shadow = await getNativeSidecarClient()!.invoke<SourceRetrieveResult>(
      'index:retrieve',
      workspaceRoot,
      query,
      options,
    )
    const tsPaths = pathSet(ts.hits)
    const rustPaths = pathSet(shadow.hits ?? [])
    if (tsPaths !== rustPaths) {
      shadowWarn('retrieve path-set diff', { query, ts: tsPaths, rust: rustPaths })
    }
  })
  return ts
}

export interface SourceIndexStatus {
  primary: 'native' | 'ts'
  sidecarLive: boolean
  indexed: number
  fts: boolean
  dbPath: string
}

export async function statusWorkspaceSources(workspaceRoot: string): Promise<SourceIndexStatus> {
  const sidecarLive = getNativeSidecarClient() !== null
  const rust = await tryPrimary('status', () =>
    getNativeSidecarClient()!.invoke<{ dbPath?: string; fts?: boolean; indexed?: number }>(
      'index:status',
      workspaceRoot,
    ),
  )
  if (rust) {
    return {
      primary: 'native',
      sidecarLive: true,
      indexed: rust.indexed ?? 0,
      fts: Boolean(rust.fts),
      dbPath: rust.dbPath ?? '',
    }
  }
  return {
    primary: 'ts',
    sidecarLive,
    indexed: countIndexedFilesTs(workspaceRoot),
    fts: isSourceIndexFtsAvailable(),
    dbPath: join(workspaceRoot, SOURCE_INDEX_REL),
  }
}

export async function countIndexedFiles(workspaceRoot: string): Promise<number> {
  const rust = await tryPrimary('count', () =>
    getNativeSidecarClient()!.invoke<number>('index:count', workspaceRoot),
  )
  if (rust !== undefined) return rust
  const ts = countIndexedFilesTs(workspaceRoot)
  fireShadow(async () => {
    const shadow = await getNativeSidecarClient()!.invoke<number>('index:count', workspaceRoot)
    if (shadow !== ts) {
      shadowWarn('count diff', { ts, rust: shadow })
    }
  })
  return ts
}
