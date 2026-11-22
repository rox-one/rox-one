/**
 * Vendor-neutral sandbox contract (Rox Cloud, BYOK mode).
 *
 * One sandbox = one machine the customer pays their own provider for
 * (Daytona / Modal / E2B / native). This is deliberately separate from
 * `CloudRunProvider`, which models an agent run (prompt pack → artifacts).
 * A sandbox has no prompts and no subtasks: it is a shell, a filesystem and
 * a lifecycle. Every method takes the sandbox id, so a provider can be
 * stateless.
 *
 * Design rule: no vendor field names, no vendor states. Swapping Daytona for
 * another vendor must touch exactly one adapter file.
 */

import { CloudRunnerError } from './types.ts';

// ============================================================
// Lifecycle
// ============================================================

export type SandboxState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'stopping'
  | 'failed'
  | 'expired';

/** Guest operating system a sandbox boots. */
export type SandboxOs = 'linux' | 'windows' | 'macos';

// ============================================================
// Spec (client → provider)
// ============================================================

export interface SandboxGpu {
  /** Vendor model string, e.g. 'a10' or 'h100'. */
  type: string;
  count: number;
  /** Interruptible capacity: cheaper, may be reclaimed. */
  spot?: boolean;
}

export interface SandboxSpec {
  /**
   * Client-generated idempotency key. Creating twice with the same id MUST
   * return the same sandbox rather than booting a second machine.
   */
  id: string;
  os: SandboxOs;
  /** Base image the provider understands; omitted = provider default. */
  image?: string;
  /** Provider snapshot to restore from; mutually exclusive with `image`. */
  snapshot?: string;
  cpu: number;
  memoryGb: number;
  /** Requested scratch disk in GiB; omitted = provider default. */
  diskGb?: number;
  gpu?: SandboxGpu;
  /**
   * Provider region the machine must run in, e.g. `us` or `us-west-4`.
   * Omitted means the provider picks a region itself.
   */
  region?: string;
  /** Hard lifetime. The sandbox is reclaimed afterwards. */
  ttlSec?: number;
  /** Pause/stop after this much inactivity. */
  idleTimeoutSec?: number;
  env?: Record<string, string>;
  /** Free-form linkage back to the workspace/user that owns the sandbox. */
  metadata?: Record<string, string>;
}

// ============================================================
// Status (provider → client)
// ============================================================

export interface SandboxStatus {
  id: string;
  /** Provider id that actually served the request, e.g. 'daytona'. */
  provider: string;
  state: SandboxState;
  createdAt: number;
  startedAt?: number;
  /** Wall-clock deadline derived from `ttlSec`. */
  expiresAt?: number;
  /** Spend attributed to this sandbox so far, in US dollars. */
  costSoFarUsd?: number;
  /** Why this provider was picked (BYOK routing explanation for the UI). */
  routingReason?: string;
  failureReason?: string;
}

// ============================================================
// Exec / files
// ============================================================

export interface SandboxExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================
// Images
// ============================================================

/**
 * One image a provider can boot: a Daytona snapshot, a Modal image, an E2B
 * template. The resources belong to the image, not to the request — a
 * provider that builds every machine from a snapshot can only offer what its
 * snapshots carry, so the console shows these exact numbers.
 */
export interface ProviderImage {
  /** Provider-side id; also what `SandboxSpec.snapshot` accepts. */
  id: string;
  /** Provider-side name, stable and readable. */
  name: string;
  /** Human label for a picker, e.g. «Linux · 2 CPU · 4 ГБ». */
  label?: string;
  os: SandboxOs;
  cpu: number;
  memoryGb: number;
  diskGb: number;
  gpu?: SandboxGpu;
  /** Provider state, e.g. `active`; absent when the provider does not say. */
  state?: string;
}

// ============================================================
// Provider interface
// ============================================================

export interface SandboxProvider {
  /** Stable provider id used in config: 'daytona' | 'modal' | 'e2b' | 'native'. */
  readonly providerId: string;

  /** Idempotent on `spec.id`: same id returns the same sandbox. */
  create(spec: SandboxSpec): Promise<SandboxStatus>;
  /** Throws `CloudRunnerError` code `not_found` for an unknown id. */
  get(id: string): Promise<SandboxStatus>;
  /** Throws `CloudRunnerError` code `provider_error` when the sandbox cannot exec. */
  exec(id: string, command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  writeFile(id: string, path: string, data: Uint8Array): Promise<void>;
  /** Graceful stop; `get` reports `stopped` afterwards. */
  stop(id: string): Promise<void>;
  /** Delete for good; `get` then raises `not_found`. */
  destroy(id: string): Promise<void>;
  /**
   * Images this credential can boot, for the console's picker. Optional: a
   * provider without a list route simply has no picker, and the catalog's
   * products stand in for it.
   */
  listImages?(): Promise<ProviderImage[]>;
}

/** Raised by adapters when the vendor cannot do what the spec asks. */
export function capabilityUnavailable(providerId: string, feature: string): CloudRunnerError {
  return new CloudRunnerError(
    `provider ${providerId} cannot do ${feature}`,
    'capability_unavailable',
  );
}
