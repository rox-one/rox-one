/**
 * RMA-I020 / #376 — adapter factory.
 * Missing mutation → unsupported, never a invented endpoint.
 * Native UI + existing credential broker only. Secrets stay out of renderer.
 */

import {
  blocked,
  denied,
  unsupported,
  type MeetingOpResult,
} from '../types.ts'
import {
  confirmWrite,
  CONATION_LIVE_SCHEMA_CONFIRMED,
  type ConationModuleId,
  type ConationOperationName,
  nativeFallbackFor,
} from './capabilities.ts'

export type ConationAdapterKind = 'native' | 'remote' | 'iframe' | 'none'

export type ConationAdapterRequest = {
  readonly moduleId: ConationModuleId
  readonly operation: ConationOperationName
  readonly kind: ConationAdapterKind
  readonly authPresent: boolean
  readonly schemaHash?: string | null
  readonly credentialRef?: string
  readonly rendererSecret?: string
}

export function dispatchConation(request: ConationAdapterRequest): MeetingOpResult {
  if (request.rendererSecret) {
    return denied('secrets-not-in-renderer')
  }
  if (request.kind === 'iframe') {
    return unsupported('iframe-is-not-native')
  }
  if (request.credentialRef && !request.credentialRef.startsWith('cred_')) {
    return denied('credential-ref-required')
  }

  const write = confirmWrite({
    moduleId: request.moduleId,
    operation: request.operation,
    schemaHash: request.schemaHash,
    authPresent: request.authPresent,
    liveSchemaConfirmed: CONATION_LIVE_SCHEMA_CONFIRMED,
  })
  if (!write.allowed) {
    if (write.reason === 'no-auth') return denied('no-auth')
    if (write.reason === 'live-unconfirmed' || write.reason === 'fixture-schema-not-live') {
      return blocked(write.reason)
    }
    return unsupported(write.reason)
  }

  return unsupported('no-live-adapter')
}

export function describeNativePath(moduleId: ConationModuleId): MeetingOpResult {
  const fallback = nativeFallbackFor(moduleId)
  if (!fallback) return blocked('no-native-fallback')
  return {
    status: 'pending',
    reason: 'native-fallback',
    live: false,
    evidenceLevel: 'U1',
    payload: { fallback },
  }
}
