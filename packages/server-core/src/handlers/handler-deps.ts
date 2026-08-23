import type { AuditMode, AcceptSecurityRiskRequest, OpenClawRuntimeStatus, SecurityAuditSnapshot } from '@craft-agent/shared/openclaw'
import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'

/**
 * Generic handler dependency bag.
 * Concrete hosts specialize these generics to their runtime implementations.
 *
 * TSessionManager defaults to ISessionManager, TOAuthFlowStore
 * defaults to IOAuthFlowStore, TWindowManager defaults to IWindowManager,
 * and TBrowserPaneManager defaults to IBrowserPaneManager so core handlers
 * get typed access without specialization.  Electron narrows all to their
 * concrete implementations.
 */
export interface HandlerDeps<
  TSessionManager extends ISessionManager = ISessionManager,
  TOAuthFlowStore extends IOAuthFlowStore = IOAuthFlowStore,
  TWindowManager extends IWindowManager = IWindowManager,
  TBrowserPaneManager extends IBrowserPaneManager = IBrowserPaneManager,
> {
  sessionManager: TSessionManager
  platform: PlatformServices
  windowManager?: TWindowManager
  browserPaneManager?: TBrowserPaneManager
  oauthFlowStore: TOAuthFlowStore
  messagingRegistry?: IMessagingGatewayRegistry
  openClawSecurity?: OpenClawSecurityService
}

/** Workspace-scoped RPC input shared by every OpenClaw/security-audit channel. */
export interface OpenClawSecurityWorkspaceInput {
  workspaceId: string
}

/** Input of `securityAudit.RUN`. */
export interface OpenClawSecurityAuditInput extends OpenClawSecurityWorkspaceInput {
  mode: AuditMode
}

/** Input of `securityAudit.REVOKE_RISK_ACCEPTANCE`. */
export interface RevokeOpenClawSecurityRiskInput extends OpenClawSecurityWorkspaceInput {
  fingerprint: string
}

/**
 * Unified OpenClaw security facade the host composes from the runtime manager
 * and the security audit service (see electron main `createOpenClawSecurityComposition`).
 * Every method takes a workspace-scoped input object already authorized by the RPC layer.
 */
export interface OpenClawSecurityService {
  getRuntimeStatus(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  installRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  provisionRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  startRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  stopRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  runAudit(input: OpenClawSecurityAuditInput): Promise<SecurityAuditSnapshot>
  getLatestAudit(input: OpenClawSecurityWorkspaceInput): Promise<SecurityAuditSnapshot | null>
  acceptRisk(input: AcceptSecurityRiskRequest): Promise<void>
  revokeRiskAcceptance(input: RevokeOpenClawSecurityRiskInput): Promise<void>
}
