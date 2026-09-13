/**
 * ROX2-031: native settings hub.
 * Settings pages stay in SETTINGS_PAGES. Conation is not this surface.
 */
import {
  fixtureResult,
  queuedResult,
  requiresExplicitGrant,
  type Rox2Context,
  type Rox2Permission,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const SETTINGS_SURFACE_ID = 'settings' as const

/** Matches settings-registry.ts. Settings hub is not gated on Conation flags. */
export const SETTINGS_HUB_REQUIRES_CONATION_FLAG = false as const

export function bindSettingsHubContext(workspaceId: string, pageId: string): Rox2Context {
  if (!workspaceId) throw new Error('workspace id is empty')
  return {
    workspaceId,
    surfaceId: `settings:${pageId}`,
    entityRefs: [],
    permissionMode: 'allow-all',
  }
}

export function settingsHubActionResult(opts: {
  source: 'native' | 'fixture' | 'conation'
  permission?: Rox2Permission
  granted?: boolean
}): Rox2Result {
  if (opts.source === 'fixture') {
    return fixtureResult('settings.fixture', 'Playground settings stories are fixture, not live')
  }
  if (opts.source === 'conation') {
    return queuedResult('settings.conation', 'Settings hub is native; Conation is not this page')
  }
  const permission = opts.permission ?? 'read'
  if (requiresExplicitGrant(permission) && opts.granted !== true) {
    return queuedResult('settings.grant-required', `${permission} requires an explicit grant`)
  }
  return { ok: true, state: 'live', entityId: 'project:settings-hub' }
}
