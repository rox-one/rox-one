/** Keep a denied capability distinct from an available empty result. */
export async function readScopedCapability<T>(options: {
  read: () => Promise<T>
  isCurrent: () => boolean
  onAvailable: (value: T) => void
  onUnavailable: (error: unknown) => void
}): Promise<void> {
  if (!options.isCurrent()) return
  let value: T
  try { value = await options.read() }
  catch (error) {
    if (options.isCurrent()) options.onUnavailable(error)
    return
  }
  if (options.isCurrent()) options.onAvailable(value)
}

export function capabilityErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : 'CAPABILITY_UNAVAILABLE'
}

/** Optional preload events are unavailable in transports without that capability. */
export function subscribeOptionalCapability(
  subscribe: ((listener: () => void) => () => void) | undefined,
  listener: () => void,
  onUnavailable: (error: unknown) => void = () => {},
): () => void {
  let active = true
  if (typeof subscribe !== 'function') return () => { active = false }
  let unsubscribe: () => void
  let callbackError: unknown
  try {
    unsubscribe = subscribe(() => {
      if (!active) return
      try { listener() } catch (error) { callbackError = error; throw error }
    })
  } catch (error) {
    active = false
    // Refused capability registration is ordinary; programming bugs stay observable.
    if (callbackError === error || !['AUTH_FAILED', 'LOCAL_ONLY_DENIED', 'CHANNEL_NOT_FOUND',
      'CAPABILITY_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'].includes(capabilityErrorCode(error))
      || !(error && typeof error === 'object' && 'code' in error)) throw error
    onUnavailable(error)
    return () => {}
  }
  return () => { if (active) { active = false; unsubscribe() } }
}
