/**
 * LRU cache for loadSession (S9-09).
 * Keyed by workspace + session id; invalidated when the JSONL mtime or size
 * changes. Caps the number of retained transcripts so a large workspace cannot
 * pin every session in memory.
 */

import type { StoredSession } from './types.ts'

export const SESSION_LOAD_CACHE_LIMIT = 128

export interface SessionLoadCacheEntry {
  mtimeMs: number
  size: number
  session: StoredSession
}

export const sessionLoadCacheStats = {
  hits: 0,
  misses: 0,
}

const cache = new Map<string, SessionLoadCacheEntry>()

export function sessionLoadCacheKey(workspaceRootPath: string, sessionId: string): string {
  return `${workspaceRootPath}\n${sessionId}`
}

export function resetSessionLoadCache(): void {
  cache.clear()
  sessionLoadCacheStats.hits = 0
  sessionLoadCacheStats.misses = 0
}

export function sessionLoadCacheSize(): number {
  return cache.size
}

export function invalidateSessionLoadCache(workspaceRootPath: string, sessionId: string): void {
  cache.delete(sessionLoadCacheKey(workspaceRootPath, sessionId))
}

export function readSessionLoadCache(
  workspaceRootPath: string,
  sessionId: string,
  mtimeMs: number,
  size: number,
): StoredSession | null {
  const key = sessionLoadCacheKey(workspaceRootPath, sessionId)
  const hit = cache.get(key)
  if (!hit || hit.mtimeMs !== mtimeMs || hit.size !== size) {
    sessionLoadCacheStats.misses += 1
    return null
  }
  cache.delete(key)
  cache.set(key, hit)
  sessionLoadCacheStats.hits += 1
  return hit.session
}

export function writeSessionLoadCache(
  workspaceRootPath: string,
  sessionId: string,
  entry: SessionLoadCacheEntry,
): void {
  const key = sessionLoadCacheKey(workspaceRootPath, sessionId)
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > SESSION_LOAD_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}
