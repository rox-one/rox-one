/**
 * use-knowledge-map — data hook for the knowledge map.
 *
 * Fetches the DTO through `window.electronAPI.buildKnowledgeMap()`, rebuilds on
 * demand, debounces change-event refreshes by 500 ms and drops stale responses
 * with a generation counter. Subscribes to the existing change events
 * (`onContextDocsChanged`, `onMemoryChanged`, `onNotesChanged`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KnowledgeMapDto } from '@rox/shared/knowledge/knowledge-map-types'
import { toErrorMessage } from '@/lib/errors'

const REFRESH_DEBOUNCE_MS = 500

export interface UseKnowledgeMapResult {
  dto: KnowledgeMapDto | null
  loading: boolean
  error: string | null
  /** True when the host build does not expose the knowledge-map channel. */
  unavailable: boolean
  refresh: () => void
}

export function useKnowledgeMap(): UseKnowledgeMapResult {
  const [dto, setDto] = useState<KnowledgeMapDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const generationRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const runFetch = useCallback(async () => {
    const build = typeof window !== 'undefined' ? window.electronAPI?.buildKnowledgeMap : undefined
    if (typeof build !== 'function') {
      setUnavailable(true)
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    try {
      const next = await build()
      if (!mountedRef.current || generation !== generationRef.current) return
      setDto(next)
      setError(null)
      setUnavailable(false)
    } catch (cause) {
      if (!mountedRef.current || generation !== generationRef.current) return
      setError(toErrorMessage(cause))
    } finally {
      if (mountedRef.current && generation === generationRef.current) setLoading(false)
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void runFetch()
    }, REFRESH_DEBOUNCE_MS)
  }, [runFetch])

  const refresh = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLoading(true)
    void runFetch()
  }, [runFetch])

  useEffect(() => {
    mountedRef.current = true
    void runFetch()
    const api = window.electronAPI
    const unsubscribers = [
      api?.onContextDocsChanged?.(() => scheduleRefresh()),
      api?.onMemoryChanged?.(() => scheduleRefresh()),
      api?.onNotesChanged?.(() => scheduleRefresh()),
    ]
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      for (const unsubscribe of unsubscribers) unsubscribe?.()
    }
  }, [runFetch, scheduleRefresh])

  return { dto, loading, error, unavailable, refresh }
}