import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerHealth } from '@craft-agent/core/types'
import type { DeviceDiagnosticKind, DeviceDiagnosticLogSource, DeviceDiagnosticSnapshot } from '../../../../shared/device-diagnostics'
import { createDiagnosticsPoller } from './diagnostics-poller'
import { diagnosticEndpoint } from './diagnostics-model'

export type DiagnosticsTab = DeviceDiagnosticKind | 'servers'
export interface ServerDiagnosticsSnapshot {
  kind: 'servers'
  sampledAt: number
  health: ServerHealth | null
  listener: { running: boolean; endpoint: string | null; needsRestart: boolean } | null
}
export type DiagnosticsSnapshot = DeviceDiagnosticSnapshot | ServerDiagnosticsSnapshot

async function readDiagnostics(tab: DiagnosticsTab, source: DeviceDiagnosticLogSource, signal: AbortSignal): Promise<DiagnosticsSnapshot> {
  if (tab === 'servers') {
    const [health, listener] = await Promise.allSettled([
      typeof window.electronAPI.getServerHealth === 'function' ? window.electronAPI.getServerHealth() : Promise.reject(),
      typeof window.electronAPI.getServerStatus === 'function'
        ? window.electronAPI.getServerStatus().then(value => ({
          running: value.running, endpoint: diagnosticEndpoint(value.url), needsRestart: value.needsRestart,
        }))
        : Promise.reject(),
    ])
    signal.throwIfAborted()
    return {
      kind: 'servers', sampledAt: Date.now(),
      health: health.status === 'fulfilled' ? health.value : null,
      listener: listener.status === 'fulfilled' ? listener.value : null,
    }
  }
  const api = window.deviceDiagnostics
  if (!api) throw new Error('native-only')
  const requestId = crypto.randomUUID()
  const cancel = () => { void api.cancel(requestId).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    return await api.read({ kind: tab, requestId, ...(tab === 'logs' ? { source } : {}) })
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export function useDiagnostics(tab: DiagnosticsTab, source: DeviceDiagnosticLogSource, scope = '') {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [previous, setPrevious] = useState<DeviceDiagnosticSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [paused, setPaused] = useState(document.visibilityState === 'hidden')
  const [error, setError] = useState<'native-only' | 'failed' | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])
  const requestKey = `${tab}:${source}:${scope}`

  useEffect(() => {
    let previousNetwork: DeviceDiagnosticSnapshot | null = null
    setSnapshot(null)
    setPrevious(null)
    setError(null)
    setLoading(false)
    const poller = createDiagnosticsPoller({
      load: signal => {
        setLoading(true)
        return readDiagnostics(tab, source, signal)
      },
      onValue: value => {
        if (value.kind === 'network') {
          setPrevious(previousNetwork)
          previousNetwork = value
        }
        setSnapshot(value)
        setLoadedKey(requestKey)
        setLoading(false)
        setError(null)
      },
      onError: error => {
        setLoading(false)
        setError(error instanceof Error && error.message === 'native-only' ? 'native-only' : 'failed')
      },
      intervalMs: ['overview', 'network', 'processes'].includes(tab) ? 5000 : undefined,
      setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      clearTimer: timer => window.clearTimeout(timer),
    })
    refreshRef.current = poller.refresh
    const updateVisibility = () => {
      const visible = document.visibilityState !== 'hidden'
      setPaused(!visible)
      if (!visible) {
        setLoading(false)
        previousNetwork = null
        setPrevious(null)
      }
      poller.setActive(visible)
    }
    document.addEventListener('visibilitychange', updateVisibility)
    updateVisibility()
    return () => {
      refreshRef.current = () => {}
      document.removeEventListener('visibilitychange', updateVisibility)
      poller.dispose()
    }
  }, [tab, source, requestKey])

  return { snapshot: loadedKey === requestKey ? snapshot : null, previous, loading, paused, error, refresh }
}
