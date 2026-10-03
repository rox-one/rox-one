import type { NativeNotesApi } from './native-notes-sync'

/** Presence permits using the real transport; it never grants document authority. */
export function hasNativeNotesTransport(api: unknown): api is NativeNotesApi {
  if (!api || typeof api !== 'object') return false
  const value = api as Partial<NativeNotesApi>
  return !!value.nativeReplica && !!value.nativeData
    && ['open', 'close', 'enqueue', 'readSnapshot', 'pending', 'acknowledge'].every(
      method => typeof (value.nativeReplica as unknown as Record<string, unknown>)[method] === 'function')
    && typeof value.nativeData.readEntity === 'function' && typeof value.nativeData.mutate === 'function'
    && typeof value.getTransportConnectionState === 'function'
}
