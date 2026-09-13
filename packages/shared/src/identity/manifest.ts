/**
 * W7 Rox migration manifest (tracker Issue 33).
 *
 * Canonical product identity, bundle IDs, URI schemes, storage names,
 * environment keys, endpoints, compatibility aliases, and the removal
 * deadline for Craft-era names. Geist distribution stays on DG-05;
 * in-app typography already uses Geist and falls back to system fonts.
 */

export const ROX_BRAND_MIGRATION_VERSION = 1

/** ISO date after which Craft-era aliases may be dropped. */
export const ROX_ALIAS_REMOVAL_DEADLINE = '2027-03-01'

export const ROX_PRODUCT_NAME = 'Rox'

export const ROX_BUNDLE_ID = 'one.rox.app'

/** Packaged appId stays on this alias so existing update channels keep working. */
export const ROX_LEGACY_BUNDLE_ID = 'com.lukilabs.craft-agent'

export const ROX_DEEPLINK_SCHEME = 'rox'
export const ROX_LEGACY_DEEPLINK_SCHEME = 'craftagents'

export const ROX_CONFIG_DIR_NAME = '.rox'
export const ROX_LEGACY_CONFIG_DIR_NAME = '.craft-agent'

export const ROX_CONFIG_DIR_ENV = 'ROX_CONFIG_DIR'
export const ROX_LEGACY_CONFIG_DIR_ENV = 'CRAFT_CONFIG_DIR'

export const ROX_PUBLIC_ORIGIN = 'https://rox.one'
export const ROX_BRO_ORIGIN = 'https://bro.rox.one'
export const ROX_UPDATE_CHANNEL = 'https://rox.one/electron/latest'
export const ROX_LEGACY_UPDATE_CHANNEL = 'https://thecraftagents.com/electron/latest'

export const ROX_TYPOGRAPHY = {
  inAppFamily: 'Geist',
  distribution: 'system-fallback',
  distributionNote:
    'DG-05 is open: do not ship Geist font files. Packaged UI uses the in-app stack with a documented system-ui fallback.',
} as const

export const ROX_LEGACY_ALIASES = {
  productNames: ['Craft', 'Craft Agent', 'Craft Agents'] as const,
  bundleIds: [ROX_LEGACY_BUNDLE_ID] as const,
  deeplinkSchemes: [ROX_LEGACY_DEEPLINK_SCHEME] as const,
  configDirNames: [ROX_LEGACY_CONFIG_DIR_NAME] as const,
  envPrefixes: ['CRAFT_'] as const,
} as const

export const ROX_MIGRATION_MANIFEST = {
  version: ROX_BRAND_MIGRATION_VERSION,
  productName: ROX_PRODUCT_NAME,
  bundleId: ROX_BUNDLE_ID,
  legacyBundleId: ROX_LEGACY_BUNDLE_ID,
  deeplinkScheme: ROX_DEEPLINK_SCHEME,
  legacyDeeplinkScheme: ROX_LEGACY_DEEPLINK_SCHEME,
  configDirName: ROX_CONFIG_DIR_NAME,
  legacyConfigDirName: ROX_LEGACY_CONFIG_DIR_NAME,
  configDirEnv: ROX_CONFIG_DIR_ENV,
  legacyConfigDirEnv: ROX_LEGACY_CONFIG_DIR_ENV,
  publicOrigin: ROX_PUBLIC_ORIGIN,
  broOrigin: ROX_BRO_ORIGIN,
  updateChannel: ROX_UPDATE_CHANNEL,
  legacyUpdateChannel: ROX_LEGACY_UPDATE_CHANNEL,
  aliasRemovalDeadline: ROX_ALIAS_REMOVAL_DEADLINE,
  typography: ROX_TYPOGRAPHY,
} as const

export type RoxMigrationManifest = typeof ROX_MIGRATION_MANIFEST

/** User-facing brand names for windows, menus, and installer copy (issue #341). */
export const ROX_BRAND_MANIFEST = {
  productName: ROX_PRODUCT_NAME,
  windowTitle: ROX_PRODUCT_NAME,
  aboutProduct: ROX_PRODUCT_NAME,
  menu: {
    aboutKey: 'menu.aboutCraftAgents',
    hideKey: 'menu.hideCraftAgents',
    quitKey: 'menu.quitCraftAgents',
  },
  installer: {
    productName: ROX_PRODUCT_NAME,
    appId: ROX_BUNDLE_ID,
    legacyAppId: ROX_LEGACY_BUNDLE_ID,
  },
  noticesRequired: true,
} as const

export type RoxBrandManifest = typeof ROX_BRAND_MANIFEST

const DEEPLINK_SCHEMES = new Set([
  `${ROX_DEEPLINK_SCHEME}:`,
  `${ROX_LEGACY_DEEPLINK_SCHEME}:`,
])

export function isRoxDeeplinkProtocol(protocol: string): boolean {
  return DEEPLINK_SCHEMES.has(protocol.toLowerCase())
}

export function isRoxDeeplinkUrl(url: string): boolean {
  try {
    return isRoxDeeplinkProtocol(new URL(url).protocol)
  } catch {
    return false
  }
}
