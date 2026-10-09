/**
 * Read-only data for «Состояние». Every probe degrades to `null`/`[]` on
 * failure (or when the IPC channel is missing on this runtime) so the screen
 * shows an honest `unknown` row instead of throwing. Credentials and server
 * config are never read beyond what the existing pages already expose.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  CredentialHealthStatus,
  IdentityState,
  LoadedSource,
  NoteIndexHealth,
} from '../../../../shared/types'
import { nativeSidecarHealthView, type NativeSidecarHealthView } from '../../settings/native-sidecar-health'

export interface HealthData {
  workspaceId: string | null
  identity: IdentityState | null
  credentials: CredentialHealthStatus | null
  vault: boolean | null
  sources: LoadedSource[]
  index: NoteIndexHealth | null
  sidecar: NativeSidecarHealthView
  loaded: boolean
}

const EMPTY_SIDECAR: NativeSidecarHealthView = { tone: 'off', detail: 'disabled' }

function emptyData(workspaceId: string | null): HealthData {
  return { workspaceId, identity: null, credentials: null, vault: null, sources: [], index: null, sidecar: EMPTY_SIDECAR, loaded: false }
}

export function useHealthData(workspaceId: string | null, refreshToken: number): HealthData {
  const [data, setData] = useState<HealthData>(() => emptyData(workspaceId))

  const load = useCallback(async (id: string | null, current: () => boolean) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api) return
    const scope = id ? { workspaceId: id } : undefined

    const [identity, credentials, vault, sources, index, serverHealth] = await Promise.all([
      typeof api.identityGetState === 'function' ? api.identityGetState(scope).catch(() => null) : Promise.resolve(null),
      typeof api.getCredentialHealth === 'function' ? api.getCredentialHealth().catch(() => null) : Promise.resolve(null),
      typeof api.fabricInfisicalHealth === 'function' ? api.fabricInfisicalHealth().then((health) => health.available).catch(() => null) : Promise.resolve(null),
      id && typeof api.getSources === 'function' ? api.getSources(id).catch(() => []) : Promise.resolve<LoadedSource[]>([]),
      id && typeof api.getNoteIndexHealth === 'function' ? api.getNoteIndexHealth(id).catch(() => null) : Promise.resolve(null),
      typeof api.getServerHealth === 'function' ? api.getServerHealth().catch(() => null) : Promise.resolve(null),
    ])
    if (!current()) return
    setData({
      workspaceId: id,
      identity,
      credentials,
      vault,
      sources: Array.isArray(sources) ? sources : [],
      index,
      sidecar: serverHealth ? nativeSidecarHealthView(serverHealth.checks) : EMPTY_SIDECAR,
      loaded: true,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const current = () => !cancelled
    setData((previous) => (previous.workspaceId === workspaceId ? previous : emptyData(workspaceId)))
    void load(workspaceId, current)
    return () => {
      cancelled = true
    }
  }, [workspaceId, refreshToken, load])

  return data.workspaceId === workspaceId ? data : emptyData(workspaceId)
}