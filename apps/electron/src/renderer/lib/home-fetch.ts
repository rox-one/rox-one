/**
 * Renderer side of the Home fetch bridge: a small hook that polls through the
 * main process, keeps the last good data on errors (offline / rate-limited),
 * and pauses polling while the window or the Home surface is hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HomeFetchApi, HomeFetchErrorReason, HomeFetchFormat, HomeFetchResult } from '../../shared/home-fetch'

declare global {
  interface Window {
    roxHomeFetch?: HomeFetchApi
  }
}

export function homeFetchApi(): HomeFetchApi | null {
  return typeof window !== 'undefined' && window.roxHomeFetch ? window.roxHomeFetch : null
}

export interface HomeFetchState<T> {
  data: T | null
  fetchedAt: number | null
  loading: boolean
  /** Set when the latest attempt failed; `data` may still hold older content. */
  error: HomeFetchErrorReason | null
  stale: boolean
  refresh: () => void
}

export interface UseHomeFetchOptions {
  as: HomeFetchFormat
  /** Poll interval; also the cache max age. Minimum 30 s. */
  refreshMs?: number
  /** Pause polling (e.g. Home surface hidden). */
  paused?: boolean
}

const MIN_REFRESH = 30_000

export function useHomeFetch<T = unknown>(url: string | null, options: UseHomeFetchOptions): HomeFetchState<T> {
  const { as, paused = false } = options
  const refreshMs = Math.max(MIN_REFRESH, options.refreshMs ?? 5 * 60_000)
  const [state, setState] = useState<Omit<HomeFetchState<T>, 'refresh'>>({ data: null, fetchedAt: null, loading: !!url, error: null, stale: false })
  const hidden = useDocumentHidden()
  const seq = useRef(0)
  const load = useCallback(
    async (force: boolean) => {
      const api = homeFetchApi()
      if (!url) return
      if (!api) {
        setState((s) => ({ ...s, loading: false, error: 'network' }))
        return
      }
      const id = ++seq.current
      setState((s) => ({ ...s, loading: true }))
      let res: HomeFetchResult<T>
      try {
        res = await api.fetch<T>({ url, as, maxAgeMs: refreshMs, ...(force ? { force: true } : {}) })
      } catch {
        res = { status: 'error', reason: 'network' }
      }
      if (id !== seq.current) return
      if (res.status === 'ok') setState({ data: res.data, fetchedAt: res.fetchedAt, loading: false, error: null, stale: res.stale })
      else setState((s) => ({
        data: res.status === 'error' && res.cached ? res.cached.data : s.data,
        fetchedAt: res.status === 'error' && res.cached ? res.cached.fetchedAt : s.fetchedAt,
        loading: false,
        error: res.status === 'error' ? res.reason : null,
        stale: true,
      }))
    },
    [as, refreshMs, url],
  )
  useEffect(() => {
    setState({ data: null, fetchedAt: null, loading: !!url, error: null, stale: false })
  }, [url, as])
  useEffect(() => {
    if (!url || paused || hidden) return
    void load(false)
    const timer = setInterval(() => void load(false), refreshMs)
    return () => clearInterval(timer)
  }, [hidden, load, paused, refreshMs, url])
  const refresh = useCallback(() => void load(true), [load])
  return { ...state, refresh }
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const on = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}
