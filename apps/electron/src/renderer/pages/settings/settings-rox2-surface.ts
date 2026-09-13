/**
 * ROX2-031 hub + ROX2-041..055 settings pages.
 * Settings pages stay in SETTINGS_PAGES. Conation is not this surface.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  liveResult,
  queuedResult,
  requiresExplicitGrant,
  type Rox2Context,
  type Rox2Permission,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const SETTINGS_SURFACE_ID = 'settings' as const

/** Matches settings-registry.ts. Settings hub is not gated on Conation flags. */
export const SETTINGS_HUB_REQUIRES_CONATION_FLAG = false as const

/** ROX2-041..043: first three SETTINGS_PAGES entries. */
export const ROX2_SETTINGS_PAGE_IDS = ['account', 'privacy', 'runtime'] as const
/** ROX2-044..046: next three SETTINGS_PAGES entries. */
export const ROX2_SETTINGS_WAVE2_PAGE_IDS = ['context', 'marketplace', 'knowledge'] as const
/** ROX2-047..049: extensions, import, app. */
export const ROX2_SETTINGS_WAVE3_PAGE_IDS = ['extensions', 'import', 'app'] as const
/** ROX2-050..052: ai, appearance, input. */
export const ROX2_SETTINGS_WAVE4_PAGE_IDS = ['ai', 'appearance', 'input'] as const
/** ROX2-053..055: workspace, accounts, permissions. */
export const ROX2_SETTINGS_WAVE5_PAGE_IDS = ['workspace', 'accounts', 'permissions'] as const
export type Rox2SettingsPageId =
  | (typeof ROX2_SETTINGS_PAGE_IDS)[number]
  | (typeof ROX2_SETTINGS_WAVE2_PAGE_IDS)[number]
  | (typeof ROX2_SETTINGS_WAVE3_PAGE_IDS)[number]
  | (typeof ROX2_SETTINGS_WAVE4_PAGE_IDS)[number]
  | (typeof ROX2_SETTINGS_WAVE5_PAGE_IDS)[number]

export type SettingsPageActionKind =
  | 'profile-write'
  | 'avatar-read'
  | 'plan-write'
  | 'spend'
  | 'export'
  | 'remote-deletion'
  | 'permission-mode'
  | 'doc-write'
  | 'doc-delete'
  | 'install'
  | 'uninstall'
  | 'token-write'
  | 'migrate'
  | 'scan'
  | 'persist'
  | 'pref-write'
  | 'toggle'
  | 'connection-write'
  | 'connection-delete'
  | 'connection-test'
  | 'identity-connect'
  | 'identity-reset'
  | 'config-read'

const PAGE_ACTION_PERMISSION: Record<SettingsPageActionKind, Rox2Permission> = {
  'profile-write': 'write',
  'avatar-read': 'device-read',
  'plan-write': 'write',
  spend: 'spend',
  export: 'device-read',
  'remote-deletion': 'destroy',
  'permission-mode': 'write',
  'doc-write': 'write',
  'doc-delete': 'destroy',
  install: 'cloud-send',
  uninstall: 'destroy',
  'token-write': 'write',
  migrate: 'device-read',
  scan: 'device-read',
  persist: 'write',
  'pref-write': 'write',
  toggle: 'write',
  'connection-write': 'write',
  'connection-delete': 'destroy',
  'connection-test': 'cloud-send',
  'identity-connect': 'cloud-send',
  'identity-reset': 'destroy',
  'config-read': 'device-read',
}

export function bindSettingsHubContext(
  workspaceId: string,
  pageId: string,
  permissionMode: Rox2Context['permissionMode'] = 'allow-all',
): Rox2Context {
  if (!workspaceId) throw new Error('workspace id is empty')
  return {
    workspaceId,
    surfaceId: `settings:${pageId}`,
    entityRefs: [],
    permissionMode,
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

/**
 * Per-page Rox2 action gate. Plan is a local label (not spend).
 * Remote deletion stays queued until a completed receipt exists.
 * Marketplace and extension install is cloud-send; it is never spend.
 * Import scan is device-read. App/appearance/input prefs are local writes.
 * AI connection save is local; test is cloud-send; delete is destroy.
 * Workspace prefs are local writes; permission mode is write, not spend.
 * Accounts profile is local; identity connect is cloud-send; reset is destroy.
 * Permissions config load is device-read.
 */
export function settingsPageActionResult(opts: {
  pageId: Rox2SettingsPageId
  action: SettingsPageActionKind
  source: 'native' | 'fixture' | 'conation'
  granted?: boolean
  deletionStatus?: 'none' | 'queued' | 'completed'
}): Rox2Result {
  const entityId = formatRox2EntityId('connection', `settings-${opts.pageId}`)
  if (opts.source === 'fixture') {
    return fixtureResult('settings.fixture', `Playground ${opts.pageId} stories are fixture, not live`)
  }
  if (opts.source === 'conation') {
    return queuedResult('settings.conation', `${opts.pageId} is native; Conation is not this page`)
  }
  if (opts.action === 'spend') {
    return queuedResult('settings.account.not-spend', 'Plan is a local label, not a spend')
  }
  const permission = PAGE_ACTION_PERMISSION[opts.action]
  if (requiresExplicitGrant(permission) && opts.granted !== true) {
    return queuedResult('settings.grant-required', `${permission} requires an explicit grant`)
  }
  if (opts.action === 'remote-deletion' && opts.deletionStatus !== 'completed') {
    return queuedResult('settings.privacy.deletion-queued', 'Remote deletion is queued, not completed')
  }
  return liveResult({
    entityId,
    lifecycle: 'succeeded',
    verification: 'receipt_verified',
    receipt: {
      provider: 'native',
      requestId: `settings.${opts.pageId}.${opts.action}`,
    },
  })
}
