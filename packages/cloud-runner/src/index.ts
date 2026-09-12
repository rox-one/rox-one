/**
 * @craft-agent/cloud-runner — Cloud Runs contract + local provider.
 *
 * See docs/cloud-runs-prd.md. Providers: LocalSubprocessProvider
 * (reference + dev mode); CloudflareComputerProvider (PRD phase G2);
 * NativeRunProvider (craft-rund adapter; selected when cloudRuns.provider=native).
 */
export {
  CloudRunnerError,
  DEFAULT_RUN_LIMITS,
  assertSafeArtifactPath,
  resolveLimits,
} from './types.ts';
export type {
  ArtifactMeta,
  CloudRunProvider,
  CloudRunSubtask,
  RunEvent,
  RunFailureReason,
  RunHandle,
  RunLimits,
  RunSpec,
  RunState,
  RunStatus,
} from './types.ts';
export { LocalSubprocessProvider } from './local-provider.ts';
export { NativeRunProvider } from './native-provider.ts';
export type { NativeRunProviderOptions, NativeRunRpc } from './native-provider.ts';
export { CloudflareComputerProvider } from './cloudflare-provider.ts';
export type { CloudflareProviderOptions } from './cloudflare-provider.ts';
export { ModalProvider } from './modal-provider.ts';
export { buildResearchSpec, DEFAULT_PERSONAS } from './research-pack.ts';
export type { ResearchPackOptions, ResearchPackKind } from './research-pack.ts';
export { conformanceSuite } from './conformance.ts';
export {
  GROK_BOT_REUSE_DECISION,
  GROK_BOT_SOURCE,
  mayEmbedGrokBotUi,
} from './grok-bot-license.ts';
export type { GrokBotReuseDecision } from './grok-bot-license.ts';
export {
  DAYTONA_GATE,
  DAYTONA_PAID_PROVISION_ENABLED,
  FORBIDDEN_FALLBACK_PROVIDERS,
  HARDENED_TEMPLATE_ID,
  applyInactivity,
  canProvision,
  exportSandbox,
  incidentShutdown,
  nativeSurfaceId,
  operatorHealth,
  provisionSandbox,
} from './daytona-sandbox.ts';
export type {
  DaytonaSandbox,
  OperatorHealth,
  PaidEntitlement,
  ProvisionError,
  ProvisionResult,
  SandboxArtifact,
  SandboxState,
} from './daytona-sandbox.ts';
