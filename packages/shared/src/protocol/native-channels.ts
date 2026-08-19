/**
 * Sidecar RPC channels. Same strings as handshake-ack.json / craft-native.
 * Not registered on the product WS server — UDS only.
 */
export const NATIVE_SIDECAR_CHANNELS = [
  'native:health',
  'native:version',
  'native:capabilities',
  'index:reindex',
  'index:search',
  'index:retrieve',
  'index:count',
  'index:status',
] as const

export type NativeSidecarChannel = (typeof NATIVE_SIDECAR_CHANNELS)[number]
