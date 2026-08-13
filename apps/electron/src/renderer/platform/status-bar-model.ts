/**
 * Status bar ready-state copy (T7). Failures stay in TransportConnectionBanner
 * / ToolchainStatusBanner; this module only classifies *ready* indicators.
 */

import type { PermissionMode } from '../../shared/types'

export type StatusBarTransportKind = 'local' | 'connected' | 'hidden'
export type StatusBarRuntimeKind = 'ready' | 'hidden'

export interface TransportLike {
  mode: 'local' | 'remote'
  status: string
}

export interface RuntimeLike {
  phase: string
}

export function statusBarTransportKind(state: TransportLike | null): StatusBarTransportKind {
  if (!state || state.mode === 'local') return 'local'
  if (state.status === 'connected') return 'connected'
  return 'hidden'
}

export function statusBarRuntimeKind(tool: RuntimeLike | undefined): StatusBarRuntimeKind {
  if (!tool) return 'hidden'
  if (tool.phase === 'ready' || tool.phase === 'outdated') return 'ready'
  return 'hidden'
}

export function permissionModeI18nKey(mode: PermissionMode): string {
  switch (mode) {
    case 'safe':
      return 'mode.safe'
    case 'ask':
      return 'mode.ask'
    case 'allow-all':
      return 'mode.allow-all'
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

export function statusBarPermissionMode(
  sessionId: string | null | undefined,
  sessionMode: PermissionMode | undefined,
): PermissionMode | null {
  if (!sessionId) return null
  return sessionMode ?? null
}
