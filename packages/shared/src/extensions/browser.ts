/**
 * Browser-safe extension catalog contracts and permission vocabulary.
 * Persistent extension state and provider adapters are node-only.
 */
export * from './types.ts'
export {
  EXTENSION_CENTER_GROUPS,
  canToggleSkillOrSource,
  extensionCenterGroupFor,
  groupExtensionCenterRecords,
  type ExtensionCenterGroupId,
  type ExtensionCenterItem,
} from './center-groups.ts'
export { countInstalledExtensionRecords } from './installed-counts.ts'
export type { ExtensionHostStatus } from './siyuan-bridge/types.ts'
export {
  EXTENSION_PERMISSION_GROUPS,
  EXTENSION_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  extensionPermissionRisk,
  groupExtensionPermissions,
  isExtensionPermission,
  permissionGroupFor,
  permissionsFromAlwaysAllow,
  type ExtensionPermissionGroup,
  type ExtensionPermissionRisk,
} from './permissions.ts'
export {
  MARKETPLACE_KIND_PERMISSIONS,
  isHighRiskMarketplacePermission,
  permissionsForMarketplaceKind,
} from './marketplace-kind.ts'
