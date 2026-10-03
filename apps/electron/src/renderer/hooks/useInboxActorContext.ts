import { useCallback, useEffect, useRef, useState } from 'react'

export interface InboxActorContext {
  workspaceId: string | null
  actorKey: string | null
  epoch: number
}

/** The event invalidates synchronously, before a pending source/action can settle. */
export function useInboxActorContext(workspaceId: string | null, active: boolean) {
  const hasIdentity = active && typeof window !== 'undefined' && typeof window.electronAPI?.identityGetState === 'function'
  const contextRef = useRef<InboxActorContext>({ workspaceId, actorKey: hasIdentity ? null : 'legacy', epoch: 0 })
  const [snapshot, setSnapshot] = useState(contextRef.current)
  const [identityFailure, setIdentityFailure] = useState<{ context: InboxActorContext; message: string } | null>(null)
  if (contextRef.current.workspaceId !== workspaceId) contextRef.current = { workspaceId, actorKey: hasIdentity ? null : 'legacy', epoch: contextRef.current.epoch + 1 }
  const context = snapshot === contextRef.current ? snapshot : contextRef.current

  const refreshIdentity = useCallback(async (invalidate = false): Promise<InboxActorContext | null> => {
    if (contextRef.current.workspaceId !== workspaceId) return null
    if (invalidate) {
      contextRef.current = { workspaceId, actorKey: null, epoch: contextRef.current.epoch + 1 }
      setSnapshot(contextRef.current)
      setIdentityFailure(null)
    }
    const captured = contextRef.current
    try {
      const [identity, principal] = hasIdentity ? await Promise.all([
        window.electronAPI.identityGetState({ workspaceId: workspaceId ?? undefined }),
        window.electronAPI.getOrgIdentity?.(),
      ]) : [null, null]
      if (contextRef.current !== captured) return null
      const validPrincipal = principal?.userId && (principal.authority === 'local' || principal.authority === 'native' && !!principal.issuer
        && identity?.annotationActorId === principal.userId)
      const actorKey = hasIdentity ? validPrincipal ? JSON.stringify([principal!.authority, principal!.issuer ?? '', principal!.userId]) : null : 'legacy'
      if (!actorKey) throw new Error('Authenticated identity is unavailable')
      if (captured.actorKey !== actorKey) {
        contextRef.current = { workspaceId, actorKey, epoch: captured.epoch + 1 }
        setSnapshot(contextRef.current)
      }
      setIdentityFailure(null)
      return contextRef.current
    } catch (error) {
      if (contextRef.current === captured) {
        contextRef.current = { workspaceId, actorKey: null, epoch: captured.epoch + 1 }
        setSnapshot(contextRef.current)
        setIdentityFailure({ context: contextRef.current, message: error instanceof Error ? error.message : String(error) })
      }
      return null
    }
  }, [hasIdentity, workspaceId])

  useEffect(() => {
    if (!active) return
    if (contextRef.current.workspaceId !== workspaceId) {
      contextRef.current = { workspaceId, actorKey: hasIdentity ? null : 'legacy', epoch: contextRef.current.epoch + 1 }
      setSnapshot(contextRef.current)
    }
    void refreshIdentity()
    const off = window.electronAPI?.onIdentityChanged?.(() => { void refreshIdentity(true) })
    return () => {
      off?.()
      if (contextRef.current.workspaceId === workspaceId) contextRef.current = { workspaceId: null, actorKey: null, epoch: contextRef.current.epoch + 1 }
    }
  }, [active, hasIdentity, refreshIdentity, workspaceId])

  return { context, contextRef, identityError: identityFailure?.context === context ? identityFailure.message : null, refreshIdentity }
}
