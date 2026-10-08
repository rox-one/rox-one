import { describe, it, expect } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@rox/shared/openclaw'
import { CHANNEL_MAP } from '../channel-map'

type AnyFn = (...args: any[]) => any

type FunctionKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFn> extends never ? never : K
}[keyof T] & string

// Aliases are pre-extracted: the bun transpiler cannot parse a bracket-indexed
// type inside `${...}` of a template-literal type (`ElectronAPI['x']}` fails);
// the alias form is the identical type.
type BrowserPaneApi = ElectronAPI['browserPane']
// Knowledge (P1 read-only) nests like browserPane via dotted CHANNEL_MAP keys.
type KnowledgeApi = ElectronAPI['knowledge']
type NativeDataApi = ElectronAPI['nativeData']
type WorkgraphApi = ElectronAPI['workgraph']
// SiYuan engine surfaces (P2) nest the same way.
type SiyuanEngineApi = ElectronAPI['siyuanEngine']
// Extension UI surfaces (S-05) nest the same way.
type ExtensionSurfaceApi = ElectronAPI['extensionSurface']
type BrowserPaneKeys = `browserPane.${FunctionKeys<BrowserPaneApi>}`
type KnowledgeKeys = `knowledge.${FunctionKeys<KnowledgeApi>}`
type NativeDataKeys = `nativeData.${FunctionKeys<NativeDataApi>}`
type WorkgraphKeys = `workgraph.${FunctionKeys<WorkgraphApi>}`
type SiyuanEngineKeys = `siyuanEngine.${FunctionKeys<SiyuanEngineApi>}`
type ExtensionSurfaceKeys = `extensionSurface.${FunctionKeys<ExtensionSurfaceApi>}`
// OpenClaw data APIs nest through dotted CHANNEL_MAP keys like other routed namespaces.
type OpenClawRuntimeApi = ElectronAPI['openclawRuntime']
type SecurityAuditApi = ElectronAPI['securityAudit']
type OpenClawRuntimeKeys = `openclawRuntime.${FunctionKeys<OpenClawRuntimeApi>}`
type SecurityAuditKeys = `securityAudit.${FunctionKeys<SecurityAuditApi>}`

type OpenClawHostControlApiKeys = 'openControlUi' | 'copyGatewayTokenForSetup'
type AssertFalse<T extends false> = true
type AssertTrue<T extends true> = true
type Equal<Left, Right> = (
  <Value>() => Value extends Left ? 1 : 2
) extends (
  <Value>() => Value extends Right ? 1 : 2
) ? true : false

const _runtimeRequestIsSafeWorkspaceInput: AssertTrue<
  Equal<Parameters<OpenClawRuntimeApi['getStatus']>, [{ workspaceId: string }]>
> = true
const _runtimeSignatureIsCanonical: AssertTrue<
  Equal<
    OpenClawRuntimeApi['getStatus'],
    (args: { workspaceId: string }) => Promise<OpenClawRuntimeStatus>
  >
> = true
const _auditRunRequestIsCanonical: AssertTrue<
  Equal<Parameters<SecurityAuditApi['run']>, [{ workspaceId: string; mode: AuditMode }]>
> = true
const _auditRunSignatureIsCanonical: AssertTrue<
  Equal<
    SecurityAuditApi['run'],
    (args: { workspaceId: string; mode: AuditMode }) => Promise<SecurityAuditSnapshot>
  >
> = true
const _auditAcceptanceRequestIsCanonical: AssertTrue<
  Equal<Parameters<SecurityAuditApi['acceptRisk']>, [AcceptSecurityRiskRequest]>
> = true
const _auditLatestSignatureIsCanonical: AssertTrue<
  Equal<
    SecurityAuditApi['getLatest'],
    (args: { workspaceId: string }) => Promise<SecurityAuditSnapshot | null>
  >
> = true
const _auditAcceptanceSignatureIsCanonical: AssertTrue<
  Equal<SecurityAuditApi['acceptRisk'], (args: AcceptSecurityRiskRequest) => Promise<void>>
> = true
const _auditRevokeSignatureIsSafeWorkspaceInput: AssertTrue<
  Equal<
    SecurityAuditApi['revokeRiskAcceptance'],
    (args: { workspaceId: string; fingerprint: string }) => Promise<void>
  >
> = true

void _runtimeRequestIsSafeWorkspaceInput
void _runtimeSignatureIsCanonical
void _auditRunRequestIsCanonical
void _auditRunSignatureIsCanonical
void _auditAcceptanceRequestIsCanonical
void _auditLatestSignatureIsCanonical
void _auditAcceptanceSignatureIsCanonical
void _auditRevokeSignatureIsSafeWorkspaceInput


// Direct preload methods use local state or window-bound Electron IPC; they
// must not enter the remote WS channel map and expose host-owned storage.
type ApiToChannelMapKeys = Exclude<
  FunctionKeys<ElectronAPI>,
  | 'performOAuth'
  | 'getTransportConnectionState'
  | 'getProjectAuthorityState' // direct preload authority state; no credential data
  | 'onProjectAuthorityChanged' // local projection invalidation callback
  | 'getProjectAuthorityConfiguration' // metadata-only direct IPC
  | 'connectProjectAuthority' // main-owned credential exchange
  | 'disconnectProjectAuthority' // main-owned encrypted credential deletion
  | 'getLicenseAuditIntent' // existing encrypted intent slot
  | 'queueLicenseAudit' // main persists typed audit before delivery
  | 'retryLicenseAudit' // current canonical scope and readback
  | 'cancelLicenseAudit' // explicit local-only cancellation
  | 'getSharedProjectCreateIntent' // window-bound encrypted intent read
  | 'queueSharedProjectCreate' // main persists intent before remote delivery
  | 'retrySharedProjectCreate' // main revalidates the stored session and command
  | 'cancelSharedProjectCreate' // local intent deletion, no remote command
  | 'getRuntimeEnvironment'
  | 'onTransportConnectionStateChanged'
  | 'reconnectTransport'
  | 'isChannelAvailable'
  | 'getSystemWarnings' // reads env var set at startup — no IPC needed
  | 'relaunchApp' // direct IPC to main process — not through WS RPC
  | 'removeWorkspace' // direct IPC to main process — modifies local config
  | 'invokeOnServer' // direct IPC to main process — cross-server RPC
  | 'transferSessionToWorkspace' // direct IPC to main process — orchestrated remote transfer
  | 'onTransferProgress' // direct IPC listener — chunk upload progress
  | 'changeLanguage' // direct IPC to main process — syncs i18n language
  | 'setUnifiedSurfaceRoutesEnabled' // W1-07 direct IPC — surface route gate for main deep links
  | 'setEntitiesLinksEnabled' // direct IPC to main process — entities.links.v1 flag mirror
  | 'exportNotePdf' // direct IPC to main process — uses BrowserWindow.printToPDF
  | 'saveTextFile' // direct IPC — save dialog + write for knowledge export
  | 'getFilePath' // renderer-local — webUtils.getPathForFile, no IPC round-trip
  // SSH remote hosts + tunnels — direct IPC to main process (Electron-only)
  | 'sshListHosts'
  | 'sshAddHost'
  | 'sshUpdateHost'
  | 'sshDeleteHost'
  | 'sshImportFromConfig'
  | 'sshConnect'
  | 'sshBootstrapConnect'
  | 'sshResolveWorkspaceConnection'
  | 'onSshBootstrapProgress'
  | 'onSshConnectionStatus'
  | 'onOmniboxOpen' // direct IPC listener — embedded BrowserView ⌘K bridge
  | 'remoteTlsInspect' // direct IPC — inspect peer cert before token handshake
  | 'remoteTlsDecide' // direct IPC — accept/reject/rollover enrollment
  | 'exitMiniWindow' // direct IPC — native window lifecycle
  | 'onPanelFocusDirection' // direct IPC — native directional focus shortcut
> | BrowserPaneKeys
  | KnowledgeKeys
  | NativeDataKeys
  | WorkgraphKeys
  | SiyuanEngineKeys
  | ExtensionSurfaceKeys
  | OpenClawRuntimeKeys
  | SecurityAuditKeys
type ChannelMapKeys = keyof typeof CHANNEL_MAP & string

type AssertNever<T extends never> = true

// Compile-time guardrails: if these fail, CHANNEL_MAP and ElectronAPI drifted.
const _missingFromMap: AssertNever<Exclude<ApiToChannelMapKeys, ChannelMapKeys>> = true
const _extraInMap: AssertNever<Exclude<ChannelMapKeys, ApiToChannelMapKeys>> = true

// Host-only controls must never become part of ElectronAPI or its routed map.
const _hostControlNamesAbsentFromApi: AssertFalse<
  Extract<FunctionKeys<ElectronAPI>, OpenClawHostControlApiKeys> extends never ? false : true
> = true
const _hostControlNamesAbsentFromMap: AssertFalse<
  Extract<ChannelMapKeys, OpenClawHostControlApiKeys> extends never ? false : true
> = true
const _hostControlBridgeAbsentFromApi: AssertFalse<
  Extract<keyof ElectronAPI, 'openClawHostControl'> extends never ? false : true
> = true

void _hostControlNamesAbsentFromApi
void _hostControlNamesAbsentFromMap
void _hostControlBridgeAbsentFromApi

void _missingFromMap
void _extraInMap

describe('CHANNEL_MAP runtime contract', () => {
  it('has valid entry kinds and channels', () => {
    for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
      expect(typeof method).toBe('string')
      expect(entry.type === 'invoke' || entry.type === 'listener').toBe(true)
      expect(typeof entry.channel).toBe('string')
      expect(entry.channel.length).toBeGreaterThan(0)

      if (entry.type === 'listener') {
        expect((entry as any).transform).toBeUndefined()
      }
    }
  })

  it('contains at least one listener and one invoke entry', () => {
    const values = Object.values(CHANNEL_MAP)
    expect(values.some((entry) => entry.type === 'listener')).toBe(true)
    expect(values.some((entry) => entry.type === 'invoke')).toBe(true)
  })

  it('exposes only the remote-safe OpenClaw data channels', () => {
    expect(CHANNEL_MAP['openclawRuntime.getStatus']).toMatchObject({
      type: 'invoke',
      channel: 'openclawRuntime:getStatus',
    })
    expect(CHANNEL_MAP['openclawRuntime.install']).toMatchObject({
      type: 'invoke',
      channel: 'openclawRuntime:install',
    })
    expect(CHANNEL_MAP['openclawRuntime.provision']).toMatchObject({
      type: 'invoke',
      channel: 'openclawRuntime:provision',
    })
    expect(CHANNEL_MAP['openclawRuntime.start']).toMatchObject({
      type: 'invoke',
      channel: 'openclawRuntime:start',
    })
    expect(CHANNEL_MAP['openclawRuntime.stop']).toMatchObject({
      type: 'invoke',
      channel: 'openclawRuntime:stop',
    })
    expect(CHANNEL_MAP['securityAudit.run']).toMatchObject({
      type: 'invoke',
      channel: 'securityAudit:run',
    })
    expect(CHANNEL_MAP['securityAudit.getLatest']).toMatchObject({
      type: 'invoke',
      channel: 'securityAudit:getLatest',
    })
    expect(CHANNEL_MAP['securityAudit.acceptRisk']).toMatchObject({
      type: 'invoke',
      channel: 'securityAudit:acceptRisk',
    })
    expect(CHANNEL_MAP['securityAudit.revokeRiskAcceptance']).toMatchObject({
      type: 'invoke',
      channel: 'securityAudit:revokeRiskAcceptance',
    })
  })

  it('excludes native host-control IPC channels', () => {
    const channels = Object.values(CHANNEL_MAP).map(entry => entry.channel)
    expect(channels).not.toContain('__openclaw-host:open-panel')
    expect(channels).not.toContain('__openclaw-host:copy-setup-credential')
  })
})
