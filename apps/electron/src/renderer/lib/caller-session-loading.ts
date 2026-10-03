export type SessionCallerAuthority = 'native' | 'local' | null

/** Native inventory comes only from the workspace-scoped RPC registered for that actor. */
export async function loadCallerSessionInventory<T>(ports: {
  getAuthority(): SessionCallerAuthority
  getNativeWorkspaceId?(): string | null
  getScopeKey?(): unknown
  request(): Promise<T[]>
  markUnavailable(): void
}): Promise<{ kind: 'available'; sessions: T[] } | { kind: 'unavailable' }> {
  const unavailable = () => {
    ports.markUnavailable()
    return { kind: 'unavailable' as const }
  }
  const authority = ports.getAuthority()
  const workspaceId = ports.getNativeWorkspaceId?.()
  const scopeKey = ports.getScopeKey?.()
  if (!authority || authority === 'native' && !workspaceId) return unavailable()
  const isCurrent = () => ports.getAuthority() === authority && ports.getScopeKey?.() === scopeKey
    && (authority !== 'native' || ports.getNativeWorkspaceId?.() === workspaceId)
  try {
    const sessions = await ports.request()
    if (!isCurrent()) return { kind: 'unavailable' }
    if (authority === 'native' && sessions.some(session => !session || typeof session !== 'object'
      || !('workspaceId' in session) || session.workspaceId !== workspaceId)) throw new Error('native-session-workspace-mismatch')
    return { kind: 'available', sessions }
  } catch (error) {
    if (!isCurrent()) return { kind: 'unavailable' }
    throw error
  }
}

/** Fence asynchronous legacy session reads before and after their transport boundary. */
export async function readLocalSessionCapability<T>(ports: {
  getAuthority(): SessionCallerAuthority
  request(): Promise<T>
}): Promise<{ kind: 'available'; value: T } | { kind: 'unavailable' }> {
  if (ports.getAuthority() !== 'local') return { kind: 'unavailable' }
  try {
    const value = await ports.request()
    return ports.getAuthority() === 'local'
      ? { kind: 'available', value } : { kind: 'unavailable' }
  } catch (error) {
    if (ports.getAuthority() !== 'local') return { kind: 'unavailable' }
    throw error
  }
}
