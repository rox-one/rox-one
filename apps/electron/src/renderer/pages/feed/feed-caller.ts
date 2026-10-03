import { useEffect, useRef, useState } from 'react'
import type { ElectronAPI } from '../../../shared/types'

export interface FeedCaller {
  key: string
  preferenceKey: string
  native: boolean
  isCurrent(): boolean
  verify(): Promise<void>
}

/** A same-workspace account change invalidates private data before the next render. */
export function useFeedCaller(workspaceId: string | null, api: ElectronAPI | undefined) {
  const epoch = useRef(0)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ workspaceId: string | null; caller: FeedCaller | null; failed: boolean }>({ workspaceId, caller: null, failed: false })
  useEffect(() => {
    let disposed = false
    const load = async () => {
      const generation = ++epoch.current
      setState({ workspaceId, caller: null, failed: false })
      const current = () => !disposed && epoch.current === generation
      const identity = async () => {
        if (!api?.getOrgIdentity || !workspaceId) throw new Error('Feed caller unavailable')
        const value = await api.getOrgIdentity()
        if (!current() || !value.userId || !['local', 'native'].includes(value.authority)
          || value.authority === 'native' && !value.issuer) throw new Error('Feed identity changed')
        return value
      }
      const boundWorkspace = async () => {
        if (!api?.getWindowWorkspace) throw new Error('Feed workspace unavailable')
        const id = await api.getWindowWorkspace()
        if (!current() || id !== workspaceId) throw new Error('Feed workspace changed')
      }
      try {
        const actor = await identity()
        await boundWorkspace()
        const actorKey = JSON.stringify([actor.authority, actor.issuer ?? null, actor.userId, workspaceId])
        const verify = async () => {
          try {
            if (!current()) throw new Error('Feed caller changed')
            const before = await identity()
            await boundWorkspace()
            const after = await identity()
            await boundWorkspace()
            if (!current() || JSON.stringify([before.authority, before.issuer ?? null, before.userId, workspaceId]) !== actorKey
              || JSON.stringify([after.authority, after.issuer ?? null, after.userId, workspaceId]) !== actorKey) throw new Error('Feed caller changed')
          } catch (error) {
            if (current()) { ++epoch.current; setState({ workspaceId, caller: null, failed: true }) }
            throw error
          }
        }
        await verify()
        if (current()) setState({ workspaceId, failed: false, caller: { key: `${actorKey}:${generation}`, preferenceKey: actorKey, native: actor.authority === 'native', isCurrent: current, verify } })
      } catch { if (current()) setState({ workspaceId, caller: null, failed: true }) }
    }
    void load()
    const off = api?.onIdentityChanged?.(() => { void load() })
    return () => { disposed = true; ++epoch.current; off?.() }
  }, [api, workspaceId, retry])
  return { caller: state.workspaceId === workspaceId ? state.caller : null,
    failed: state.workspaceId === workspaceId && state.failed, retry: () => setRetry(value => value + 1) }
}
