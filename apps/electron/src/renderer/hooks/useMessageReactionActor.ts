import { useEffect, useState } from 'react'
import type { AnnotationAuthor } from '@craft-agent/core'

/** Load the annotation actor from the same authenticated route as the chat. */
export function useAuthenticatedReactionActor(workspaceId?: string): AnnotationAuthor | null {
  const [state, setState] = useState<{ workspaceId?: string; actor: AnnotationAuthor | null }>(() => ({ workspaceId, actor: null }))
  useEffect(() => {
    let disposed = false
    let generation = 0
    const load = async () => {
      const request = ++generation
      setState({ workspaceId, actor: null })
      try {
        const identity = await window.electronAPI.identityGetState({ workspaceId })
        if (disposed || request !== generation) return
        setState({ workspaceId, actor: identity.annotationActorId
          ? { id: identity.annotationActorId, name: identity.profile.displayName, type: 'user' }
          : { id: 'local-user', name: 'local', type: 'user' } })
      } catch {
        // An unknown authenticated actor must not create a duplicate like.
        // Identity changes and refocusing retry transient connection failures.
      }
    }
    void load()
    const offIdentity = window.electronAPI.onIdentityChanged?.(() => { void load() })
    const retry = () => { void load() }
    window.addEventListener('focus', retry)
    return () => { disposed = true; ++generation; offIdentity?.(); window.removeEventListener('focus', retry) }
  }, [workspaceId])
  return state.workspaceId === workspaceId ? state.actor : null
}
