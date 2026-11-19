/**
 * Paid per-user Daytona sandbox (Issue 29).
 *
 * BYOK mode: the customer pays Daytona on their own account, so the wallet in
 * `entitlement.ts` only ever carries the Rox platform fee. A create reserves
 * that fee for the sandbox lifetime; a stop settles the real amount.
 *
 * Live spend stays fail-closed unless the caller turns the gate on explicitly
 * (`featureEnabled`), and an unpaid account never provisions. Failure never
 * falls back to Cloudflare, Modal, or E2B.
 */

import { CloudRunnerError } from './types.ts';
import { reserve, type MoneyStore } from './entitlement.ts';
import { checkAccountLimits, type AccountLimits } from './limits.ts';
import { GROK_BOT_REUSE_DECISION, mayEmbedGrokBotUi } from './grok-bot-license.ts';

/** The gate default: a caller must opt in, nothing turns paid provisioning on by itself. */
export const DEFAULT_PAID_PROVISION_ENABLED = false;
export const DAYTONA_GATE = 'DG04_GATED' as const;
export const HARDENED_TEMPLATE_ID = 'rox-bot-sandbox-v1';
export const FORBIDDEN_FALLBACK_PROVIDERS = ['cloudflare', 'modal', 'e2b'] as const;

export type SandboxState =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'inactive'
  | 'shutdown'
  | 'failed'

export interface PaidEntitlement {
  accountId: string
  paid: boolean
  budgetUsd: number
  usedUsd: number
  inactivityTtlMs: number
}

export interface SandboxArtifact {
  id: string
  path: string
  size: number
  sha256: string
}

export interface DaytonaSandbox {
  id: string
  accountId: string
  provider: 'daytona'
  templateId: string
  state: SandboxState
  createdAt: number
  lastActiveAt: number
  expiresAt: number
  artifacts: SandboxArtifact[]
  /** Why this provider was picked, for the UI (BYOK: the customer pays directly). */
  routingReason?: string
}

export type ProvisionError =
  | 'entitlement_required'
  | 'budget_exceeded'
  | typeof DAYTONA_GATE
  | 'incident_shutdown'
  | 'concurrency_exceeded'
  | 'sandbox_too_large'

export type ProvisionResult =
  | { ok: true; sandbox: DaytonaSandbox }
  | { ok: false; error: ProvisionError; provider: 'daytona' }

export interface OperatorHealth {
  healthy: boolean
  state: SandboxState
  budgetRemainingUsd: number
}

/** Everything a live paid create needs: the wallet, the ceilings, the clock. */
export interface PaidProvisionRuntime {
  store: MoneyStore
  limits: AccountLimits
  /** Opt-in switch for live spend; omitted = `DEFAULT_PAID_PROVISION_ENABLED`. */
  featureEnabled?: boolean
  now: number
  mintId?: () => string
  /** Rox fee for one sandbox, in integer cents per hour. No default: the caller sets it. */
  rateCentsPerHour: number
}

export interface ProvisionRequest {
  /** Sandbox id and ledger ref; minted from `mintId` when omitted. */
  id?: string
  cpu: number
  /** Sandbox memory; informational, it does not change the platform fee. */
  memoryGb?: number
  ttlMs: number
  /** Sandboxes the account already runs, for the concurrency ceiling. */
  activeCount?: number
}

export interface SandboxEstimateInput {
  ttlMs: number
  rateCentsPerHour: number
}

/**
 * Reserve amount for one sandbox: Rox's fee for the whole lifetime, in whole
 * cents, rounded up. Provider compute prices never enter this arithmetic.
 */
export function estimateSandboxCents({ ttlMs, rateCentsPerHour }: SandboxEstimateInput): number {
  if (!Number.isInteger(rateCentsPerHour) || rateCentsPerHour <= 0) {
    throw new CloudRunnerError(
      `rateCentsPerHour must be a positive integer number of cents, got ${rateCentsPerHour}`,
      'provider_error',
    );
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new CloudRunnerError(`ttlMs must not be negative, got ${ttlMs}`, 'provider_error');
  }
  return Math.ceil((ttlMs / 3_600_000) * rateCentsPerHour - 1e-9);
}

function assertNoFallback(provider: string): void {
  if ((FORBIDDEN_FALLBACK_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`daytona sandbox must not fall back to ${provider}`);
  }
}

/** Pure pre-check: entitlement only. The runtime gate and the wallet come later. */
export function canProvision(entitlement: PaidEntitlement): ProvisionError | null {
  if (!entitlement.paid) return 'entitlement_required';
  if (entitlement.usedUsd >= entitlement.budgetUsd) return 'budget_exceeded';
  return null;
}

export function provisionSandbox(
  entitlement: PaidEntitlement,
  runtime: PaidProvisionRuntime,
  request: ProvisionRequest,
): ProvisionResult {
  assertNoFallback('daytona');
  if (mayEmbedGrokBotUi()) {
    throw new Error('grok-bot raw UI reuse is forbidden');
  }
  const denied = canProvision(entitlement);
  if (denied) {
    return { ok: false, error: denied, provider: 'daytona' };
  }
  if (!(runtime.featureEnabled ?? DEFAULT_PAID_PROVISION_ENABLED)) {
    return { ok: false, error: DAYTONA_GATE, provider: 'daytona' };
  }

  const account = runtime.store.getAccount(entitlement.accountId);
  if (!account) {
    return { ok: false, error: 'entitlement_required', provider: 'daytona' };
  }

  const estimateCents = estimateSandboxCents({
    ttlMs: request.ttlMs,
    rateCentsPerHour: runtime.rateCentsPerHour,
  });
  const limitDenied = checkAccountLimits({
    limits: runtime.limits,
    activeCount: request.activeCount ?? 0,
    requestedCpu: request.cpu,
    monthSpentCents: account.monthSpentCents,
    requestedReserveCents: estimateCents,
  });
  if (limitDenied === 'monthly_cap_exceeded') {
    // The wallet speaks `budget_exceeded`; a monthly ceiling is the same refusal.
    return { ok: false, error: 'budget_exceeded', provider: 'daytona' };
  }
  if (limitDenied) {
    return { ok: false, error: limitDenied, provider: 'daytona' };
  }

  const now = runtime.now;
  const mintId = runtime.mintId ?? (() => `sbx_${now.toString(36)}`);
  const sandboxId = request.id ?? mintId();
  const reservation = reserve(runtime.store, entitlement.accountId, estimateCents, sandboxId, now);
  if (!reservation.ok) {
    return {
      ok: false,
      // An empty wallet is the refusal the caller already knows as budget_exceeded.
      error: reservation.error === 'insufficient_balance' ? 'budget_exceeded' : reservation.error,
      provider: 'daytona',
    };
  }

  const sandbox: DaytonaSandbox = {
    id: sandboxId,
    accountId: entitlement.accountId,
    provider: 'daytona',
    templateId: HARDENED_TEMPLATE_ID,
    state: 'ready',
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + request.ttlMs,
    artifacts: [],
    routingReason: `клиент платит Daytona по своему ключу; в кошельке зарезервировано ${estimateCents} центов`,
  };
  return { ok: true, sandbox };
}

export function applyInactivity(sandbox: DaytonaSandbox, now: number): DaytonaSandbox {
  if (sandbox.state === 'shutdown') return sandbox;
  if (now >= sandbox.expiresAt) {
    return { ...sandbox, state: 'inactive' };
  }
  return sandbox;
}

export function incidentShutdown(sandbox: DaytonaSandbox, now: number): DaytonaSandbox {
  return { ...sandbox, state: 'shutdown', lastActiveAt: now };
}

export function exportSandbox(sandbox: DaytonaSandbox): {
  accountId: string
  sandboxId: string
  templateId: string
  artifacts: SandboxArtifact[]
} {
  return {
    accountId: sandbox.accountId,
    sandboxId: sandbox.id,
    templateId: sandbox.templateId,
    artifacts: sandbox.artifacts,
  };
}

export function operatorHealth(sandbox: DaytonaSandbox, entitlement: PaidEntitlement): OperatorHealth {
  return {
    healthy: sandbox.state === 'ready',
    state: sandbox.state,
    budgetRemainingUsd: Math.max(0, entitlement.budgetUsd - entitlement.usedUsd),
  };
}

export function nativeSurfaceId(): string {
  return GROK_BOT_REUSE_DECISION.nativeSurface
}
