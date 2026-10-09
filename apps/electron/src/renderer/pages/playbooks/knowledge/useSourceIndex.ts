/**
 * Source-index bridge for the Playbooks knowledge notebook (С-13, D12).
 *
 * Reuses the existing `sources:*` RPC surface (`sources:get|reindex|search|status`
 * + `sources:changed`/`sources:indexChanged` push) exactly as
 * `components/app-shell/SourcesListPanel.tsx` does; no new backend contract.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadedSource } from '../../../../shared/types'

export interface SourceIndexHit {
  readonly path: string
  readonly snippet: string
  readonly rank: number
  readonly mtime: number
}

export interface SourceIndexStatus {
  readonly indexed: number
  readonly primary: 'native' | 'ts'
}

export interface SourceIndexView {
  readonly sources: LoadedSource[]
  readonly status: SourceIndexStatus | null
  readonly loading: boolean
  readonly error: string | null
  readonly reindexing: boolean
  readonly lastReindexAt: number | null
  reload(): Promise<void>
  reindex(): Promise<void>
}

/** Limit mirrors the facade defaults (8 hits) used by retrieveSourcesForPrompt. */
export const SOURCE_SEARCH_LIMIT = 8

export function useSourceIndex(workspaceId: string | null): SourceIndexView {
  const [sources, setSources] = useState<LoadedSource[]>([])
  const [status, setStatus] = useState<SourceIndexStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [lastReindexAt, setLastReindexAt] = useState<number | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setSources([])
      setStatus(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextSources, nextStatus] = await Promise.all([
        window.electronAPI.getSources(workspaceId),
        typeof window.electronAPI.getSourceIndexStatus === 'function'
          ? window.electronAPI.getSourceIndexStatus(workspaceId)
          : Promise.resolve(null),
      ])
      if (!alive.current) return
      setSources(nextSources)
      setStatus(nextStatus)
    } catch (err) {
      if (!alive.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [workspaceId])

  const reindex = useCallback(async () => {
    if (!workspaceId || reindexing) return
    if (typeof window.electronAPI.reindexSources !== 'function') {
      setError('sources:reindex unavailable')
      return
    }
    setReindexing(true)
    setError(null)
    try {
      const result = await window.electronAPI.reindexSources(workspaceId)
      if (!alive.current) return
      setStatus((current) => ({ indexed: result.indexed, primary: current?.primary ?? (result.fts ? 'native' : 'ts') }))
      setLastReindexAt(Date.now())
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (alive.current) setReindexing(false)
    }
  }, [workspaceId, reindexing])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  useEffect(() => {
    if (!workspaceId) return
    const offSources = window.electronAPI.onSourcesChanged?.((changedWorkspaceId, next) => {
      if (changedWorkspaceId === workspaceId) setSources(next)
    })
    const offIndex = window.electronAPI.onSourceIndexChanged?.((changedWorkspaceId, payload) => {
      if (changedWorkspaceId === workspaceId) {
        setStatus((current) => ({ indexed: payload.indexed, primary: current?.primary ?? 'native' }))
      }
    })
    return () => {
      offSources?.()
      offIndex?.()
    }
  }, [workspaceId])

  return { sources, status, loading, error, reindexing, lastReindexAt, reload, reindex }
}

/** Retrieval for questions/preset-questions — the `sources:search` precedent. */
export async function searchSourceIndex(
  workspaceId: string | null,
  query: string,
  limit: number = SOURCE_SEARCH_LIMIT,
): Promise<SourceIndexHit[]> {
  const trimmed = query.trim()
  if (!workspaceId || !trimmed) return []
  if (typeof window.electronAPI.searchSourcesIndex !== 'function') return []
  const result = await window.electronAPI.searchSourcesIndex(workspaceId, trimmed, limit)
  return result.hits.map((hit) => ({ path: hit.path, snippet: hit.snippet, rank: hit.rank, mtime: hit.mtime }))
}