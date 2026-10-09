/**
 * SiYuan plugin bridge contracts (W6).
 *
 * SiYuan plugins remain runtime `siyuan-plugin` and execute inside the SiYuan
 * runtime — never in Electron main / Craft Extension Host.
 */

export type CompatLevel = 0 | 1 | 2 | 3

export type SiyuanDockPosition =
  | 'LeftTop'
  | 'LeftBottom'
  | 'RightTop'
  | 'RightBottom'
  | 'BottomLeft'
  | 'BottomRight'

export type CraftPanelSlot =
  | 'navigator-primary'
  | 'navigator-secondary'
  | 'inspector'
  | 'bottom'

export const DOCK_TO_SLOT: Record<SiyuanDockPosition, CraftPanelSlot> = {
  LeftTop: 'navigator-primary',
  LeftBottom: 'navigator-secondary',
  RightTop: 'inspector',
  RightBottom: 'inspector',
  BottomLeft: 'bottom',
  BottomRight: 'bottom',
}

export interface SiYuanPluginJson {
  name: string
  version: string
  author?: string
  displayName?: Record<string, string> | string
  description?: Record<string, string> | string
  minAppVersion?: string
  backends?: string[]
  frontends?: string[]
  disabledInPublish?: boolean
  [key: string]: unknown
}

export interface BridgeCommandContribute {
  id: string
  title: string
  titleRu?: string
  when?: string
  defaultHotkey?: string
  permissions?: string[]
}

export interface BridgeMenuContribute {
  location: 'editor' | 'tree' | 'dock' | 'block' | 'tab'
  command: string
  when?: string
}

export interface BridgeTabContribute {
  type: string
  title: string
  icon?: string
}

export interface BridgeStatusItemContribute {
  id: string
  text: string
  tooltip?: string
  command?: string
}

export interface BridgeSettingContribute {
  key: string
  title: string
  type: 'checkbox' | 'text' | 'number' | 'select'
  default: unknown
  options?: string[]
}

export interface BridgeAgentActionContribute {
  id: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  permissions: string[]
}

export interface BridgeDockContribute {
  position: SiyuanDockPosition
  title?: string
  icon?: string
  permissions?: string[]
}

export interface SiYuanBridgeCraftBlock {
  level: 2 | 3
  contributes?: {
    commands?: BridgeCommandContribute[]
    menus?: BridgeMenuContribute[]
    tabs?: BridgeTabContribute[]
    docks?: BridgeDockContribute[]
    statusItems?: BridgeStatusItemContribute[]
    settings?: BridgeSettingContribute[]
    agentActions?: BridgeAgentActionContribute[]
  }
  gracefulDegrade?: string[]
  requiresFullChrome?: boolean
}

export interface SiYuanBridgeManifest extends SiYuanPluginJson {
  craft?: SiYuanBridgeCraftBlock
}

export interface BridgeProjectionDiagnostic {
  kind: 'permission-denied' | 'skipped-level' | 'invalid'
  contributeType: string
  id?: string
  permission?: string
  message: string
}

export interface BridgeProjectedContributions {
  commands: Array<BridgeCommandContribute & { source: 'siyuan-plugin'; pluginId: string }>
  panels: Array<{
    id: string
    slot: CraftPanelSlot
    title: string
    source: { type: 'siyuan-plugin'; id: string }
    permissions?: string[]
  }>
  surfaces: Array<{
    kind: 'extension'
    extensionId: string
    viewId: string
    title: string
    icon?: string
  }>
  menus: Array<BridgeMenuContribute & { pluginId: string }>
  statusItems: Array<BridgeStatusItemContribute & { pluginId: string }>
  settings: Array<BridgeSettingContribute & { pluginId: string }>
  agentActions: Array<BridgeAgentActionContribute & { pluginId: string; source: 'siyuan-plugin' }>
  diagnostics: BridgeProjectionDiagnostic[]
  level: CompatLevel
  pluginId: string
}

export interface PluginBridgeListItem {
  id: string
  name: string
  version: string
  displayName?: string
  description?: string
  enabled: boolean
  level: CompatLevel
  requiresFullChrome?: boolean
  author?: string
}

export interface PluginBridgeListResult {
  plugins: PluginBridgeListItem[]
  /** true when list came from fixture/in-memory, not live kernel */
  fixture?: boolean
  /** soft residual note when kernel API unavailable */
  residual?: string
}

export interface PluginBridgeGetProjectionsArgs {
  pluginId: string
  grantedPermissions?: string[]
  /** optional raw manifest override for tests */
  manifest?: unknown
  capabilityProbeFailed?: boolean
}

export interface PluginBridgeSetEnabledArgs {
  pluginId: string
  enabled: boolean
}

export interface PluginBridgeSetEnabledResult {
  pluginId: string
  enabled: boolean
  persisted: 'local' | 'kernel' | 'none'
  residual?: string
}

/** Kernel Bazaar install args (pluginBridge:installBazaar). LOCAL_ONLY. */
export interface PluginBridgeInstallBazaarArgs {
  packageName: string
  repoURL: string
  repoHash: string
}

export interface PluginBridgeInstallBazaarResult {
  packageName: string
  /** Whether setPetalEnabled(true) succeeded after install. */
  enabled?: boolean
  residual?: string
}

/** Kernel Bazaar uninstall args (pluginBridge:uninstallBazaar). LOCAL_ONLY. */
export interface PluginBridgeUninstallBazaarArgs {
  packageName: string
}

export interface PluginBridgeUninstallBazaarResult {
  packageName: string
  residual?: string
}

export interface ExtensionHostStatus {
  status: 'stopped' | 'starting' | 'running' | 'degraded'
  pid?: number
  /** honest: host does NOT execute SiYuan plugins */
  executesSiyuanPlugins: false
  message?: string
  /** craft-sandbox extension ids currently loaded in the worker */
  loadedExtensions?: string[]
}

// ── Wave 3 — Craft Extension Host descriptor + activation lifecycle ─────────
// Request/response contracts for `extensionHost:listDescriptors|activate|reload`
// (LOCAL_ONLY; the craft-sandbox utilityProcess runs in the local host only).

/** One installed craft-sandbox extension descriptor (`extensionHost:listDescriptors`). */
export interface ExtensionDescriptor {
  extensionId: string
  entryPath: string
  manifestPath?: string
  name?: string
  version?: string
  /** True when the extension module is currently loaded in the worker. */
  active: boolean
  /** Effective grants resolved from the workspace permissions.json. */
  grantedPermissions?: string[]
}

/** One row of the activation plan (why an extension will/will not activate). */
export interface ExtensionActivationPlanEntry {
  extensionId: string
  /** Machine-readable reason (e.g. 'activationEvent' | 'disabled' | 'missingEntry'). */
  reason: string
}

/** Result of `extensionHost:listDescriptors`. */
export interface ExtensionHostListDescriptorsResult {
  descriptors: ExtensionDescriptor[]
  /** Ordered activation plan derived from activationEvents + workspace state. */
  plan: ExtensionActivationPlanEntry[]
  /** Extension ids currently loaded in the craft-sandbox worker. */
  loaded: string[]
}

/** One command declared by a loaded extension (`extensionHost:activate`). */
export interface ExtensionCommandDescriptor {
  id: string
  title: string
  when?: string
  defaultHotkey?: string
  keywords?: string[]
}

/** Result of `extensionHost:activate`. */
export interface ExtensionHostActivateResult {
  commands: ExtensionCommandDescriptor[]
}

/** Result of `extensionHost:reload` — host status plus reload provenance. */
export interface ExtensionHostReloadResult {
  status: ExtensionHostStatus['status']
  generation?: number
  entryHash?: string
  reason?: string
}
