import type { NativeVoiceOverlayHost } from './voice-overlay-host'
import type { NativeAuthority } from '../authority/native-authority.ts'
import type { NativeJournal } from '../authority/native-journal.ts'
import type { PendingCommandsStore } from '../command-gateway'
import type { CollaborationSyncService } from '../collaboration/sync-service.ts'
import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'
import type { BrowserCredentialHost } from '@rox/shared/browser/browser-credential-host'
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@rox/shared/openclaw'
import type {
  EffectivenessReport,
  LearningServicePorts,
} from '../memory/learning/learning-types'
import type {
  LearningCandidate,
  LearningEvidence,
  LearningExperiment,
  LearningPolicy,
  TaskOutcome,
} from '@rox/shared/memory/learning'

export interface OpenClawSecurityWorkspaceInput {
  readonly workspaceId: string
}

export interface OpenClawSecurityAuditInput extends OpenClawSecurityWorkspaceInput {
  readonly mode: AuditMode
}

export interface RevokeOpenClawSecurityRiskInput extends OpenClawSecurityWorkspaceInput {
  readonly fingerprint: string
}

/**
 * Safe OpenClaw data operations available to the core RPC layer.
 *
 * The host owns the concrete composition. Inputs arrive only after the RPC
 * boundary validates and authorizes them; outputs are canonical safe shared
 * projections. Host-control effects intentionally do not belong here.
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

/**
 * Learning data operations available to the core RPC layer (PRD §15).
 *
 * Extends the frozen `LearningServicePorts` facade
 * (`memory/learning/learning-types.ts`) with the read/action operations the
 * frozen interface does not declare yet: `learning:listEvidence`,
 * `learning:getOutcome`, `learning:getExperiment`,
 * `learning:getSkillEffectiveness`, `learning:getPolicy`,
 * `learning:revalidate`, `learning:recordOutcome`. They are declared here —
 * never in the frozen file — so the composed host service can satisfy both
 * halves; remove an override as soon as the frozen interface carries it.
 */
export interface LearningRpcService extends LearningServicePorts {
  /** Evidence rows for one candidate, or the recent workspace ledger when no candidate is addressed. */
  listEvidence: (workspaceId: string, candidateId?: string) => LearningEvidence[]
  /** One recorded task outcome (PRD §19/§3.5), by id. */
  getOutcome: (workspaceId: string, id: string) => TaskOutcome | null
  /** One A/B experiment (PRD §3.4), by id. */
  getExperiment: (workspaceId: string, id: string) => LearningExperiment | null
  /** Effectiveness report (PRD §18) for a skill slug / lesson rule / policy id. */
  getSkillEffectiveness: (workspaceId: string, targetId: string) => EffectivenessReport | null
  /** Learned orchestration policies (PRD §3.7); `learning:getPolicy`. */
  getPolicies: (workspaceId: string) => LearningPolicy[]
  /** Re-runs deterministic validation for one candidate and returns its updated row. */
  revalidateCandidate: (workspaceId: string, id: string) => Promise<LearningCandidate | null>
  /** Records one task outcome (PRD §3.5); `learning:recordOutcome`. */
  recordOutcome: (workspaceId: string, outcome: TaskOutcome) => void
}


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
  /** Native browser-password grants and OS-protected key custody; absent in headless hosts. */
  browserCredentials?: BrowserCredentialHost
  /** Optional because standalone/headless hosts do not compose a managed OpenClaw runtime. */
  openClawSecurity?: OpenClawSecurityService
  /**
   * Optional because the learning service is host-composed (WP-108) and older
   * hosts predate it; `learning:*` handlers answer UNSUPPORTED_OPERATION until
   * it is present.
   */
  learning?: LearningRpcService
  /** Optional GUI-only overlay; never controlled through an untrusted SET_OVERLAY RPC. */
  voiceOverlay?: NativeVoiceOverlayHost
  commandGateway?: PendingCommandsStore
  /** Server-composed native capability boundary and durable canonical-file data plane. */
  nativeData?: {
    authority: NativeAuthority
    journal: NativeJournal
    sync: CollaborationSyncService
  }
}
