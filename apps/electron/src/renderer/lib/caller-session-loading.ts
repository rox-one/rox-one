export type SessionCallerAuthority = 'native' | 'local' | null

/** Host session inventory is a legacy-local capability, not a native grant. */
export async function loadCallerSessionInventory<T>(ports: {
  getAuthority(): SessionCallerAuthority
  request(): Promise<T[]>
  markUnavailable(): void
}): Promise<{ kind: 'available'; sessions: T[] } | { kind: 'unavailable' }> {
  const unavailable = () => {
    ports.markUnavailable()
    return { kind: 'unavailable' as const }
  }
  if (ports.getAuthority() !== 'local') return unavailable()
  try {
    const sessions = await ports.request()
    // A late local response must not repopulate host inventory after a native switch.
    if (ports.getAuthority() !== 'local') return unavailable()
    return { kind: 'available', sessions }
  } catch (error) {
    if (ports.getAuthority() !== 'local') return unavailable()
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
