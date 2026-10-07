import type { CredentialManager } from '@rox/shared/credentials'
import type { HandlerDeps } from './handlers/handler-deps'

type Authority = NonNullable<HandlerDeps['nativeData']>['authority']
export interface NativeTransportBinding { workspaceId: string; nativeRoot: string }

/** Main-only bootstrap. The caller supplies an owned-window lookup, never renderer identity. */
export async function resolveNativeTransportCredential(options: {
  credentials: Pick<CredentialManager, 'getNativeTransportCredential'>
  authority: Authority
  getBinding: () => NativeTransportBinding | null
  expectedWorkspaceId: string
  legacyToken: string
}): Promise<string> {
  const binding = options.getBinding()
  if (!binding) throw new Error('Native transport window binding unavailable')
  const expected = options.expectedWorkspaceId.trim()
  if (expected && binding.workspaceId !== expected) {
    throw new Error('Native transport window binding unavailable')
  }
  const credential = await options.credentials.getNativeTransportCredential(binding.workspaceId)
  const current = options.getBinding()
  if (!current || current.workspaceId !== binding.workspaceId || current.nativeRoot !== binding.nativeRoot) {
    throw new Error('Native transport window binding changed')
  }
  // Absence alone preserves the legacy session transport. Invalid enrollment never falls back.
  if (credential === null) return options.legacyToken
  const principal = options.authority.authenticate(credential)
  if (!principal || !options.authority.authorize(principal, binding.workspaceId, 'read', binding.nativeRoot)) {
    throw new Error('Native transport credential denied')
  }
  return credential
}
