/**
 * Cloud handoff ("В облако") — move a whole chat session into a Daytona
 * sandbox running the Rox session server, then hand the user an
 * id.rox.one-gated browser link. See docs/cloud-handoff-design.md.
 */

export type HandoffPhase =
  | 'resolving_key'
  | 'packaging'
  | 'creating_sandbox'
  | 'uploading'
  | 'starting'
  | 'waiting_ready'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type HandoffFailureCode =
  | 'disabled'
  | 'no_key'
  | 'sign_in_required'
  | 'sso_not_configured'
  | 'web_host_required'
  | 'too_large'
  | 'quota_exceeded'
  | 'provider_error'
  | 'start_timeout'
  | 'cancelled';

export interface HandoffProgress {
  phase: HandoffPhase;
  /** Files uploaded / total files planned (uploading phase). */
  uploaded?: number;
  total?: number;
}

export interface HandoffStatus {
  handoffId: string;
  sessionId: string;
  phase: HandoffPhase;
  startedAt: number;
  updatedAt: number;
  uploaded?: number;
  total?: number;
  /**
   * Present once phase === 'ready'. For signed links this is freshly issued on
   * each status read and never persisted; for a web host it is stable.
   */
  sessionUrl?: string;
  linkMode?: 'signed' | 'web_host';
  /** Set once the user ended the cloud session (sandbox deleted). */
  ended?: boolean;
  sandboxId?: string;
  keySource?: 'user' | 'broker';
  failure?: { code: HandoffFailureCode; message: string };
  excludedCount?: number;
}

export class HandoffError extends Error {
  constructor(
    readonly code: HandoffFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HandoffError';
  }
}

export interface HandoffLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  /** Max concurrently live handoff sandboxes per owner. */
  maxActivePerOwner: number;
  autoStopIntervalMin: number;
  autoDeleteIntervalMin: number;
  readyTimeoutMs: number;
  readyPollMs: number;
  /** Lifetime of a signed session link; re-issued on demand, never stored. */
  linkTtlSec: number;
}

export const DEFAULT_HANDOFF_LIMITS: HandoffLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFiles: 2_000,
  maxActivePerOwner: 2,
  autoStopIntervalMin: 30,
  autoDeleteIntervalMin: 24 * 60,
  readyTimeoutMs: 120_000,
  readyPollMs: 2_000,
  linkTtlSec: 3_600,
};

/** Daytona's documented maximum for signed preview URL expiry (24 h). */
export const MAX_SIGNED_LINK_TTL_SEC = 86_400;

export const HANDOFF_LABEL = 'rox.cloud-handoff';
export const HANDOFF_OWNER_LABEL = 'rox.cloud-handoff.owner';
/** Port the Rox session server listens on inside the sandbox image. */
export const HANDOFF_SERVER_PORT = 9100;
/** Root of the uploaded snapshot inside the sandbox. */
export const HANDOFF_ROOT = '/home/daytona/rox-handoff';
/** Default Daytona snapshot that bundles the headless Rox session server + web UI. */
export const DEFAULT_HANDOFF_SNAPSHOT = 'rox-session-server-v1';
