/**
 * Paid per-user Daytona sandbox (Issue 29).
 *
 * Live cloud spend is fail-closed while DG-04 is OPEN. Unpaid accounts
 * never provision. Failure never falls back to Cloudflare, Modal, or E2B.
 */

import { GROK_BOT_REUSE_DECISION, mayEmbedGrokBotUi } from './grok-bot-license.ts'

export const DAYTONA_PAID_PROVISION_ENABLED = false
export const DAYTONA_GATE = 'DG04_GATED' as const
export const HARDENED_TEMPLATE_ID = 'rox-bot-sandbox-v1'
export const FORBIDDEN_FALLBACK_PROVIDERS = ['cloudflare', 'modal', 'e2b'] as const

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
}

export type ProvisionError =
  | 'entitlement_required'
  | 'budget_exceeded'
  | typeof DAYTONA_GATE
  | 'incident_shutdown'

export type ProvisionResult =
  | { ok: true; sandbox: DaytonaSandbox }
  | { ok: false; error: ProvisionError; provider: 'daytona' }

export interface OperatorHealth {
  healthy: boolean
  state: SandboxState
  budgetRemainingUsd: number
}

function assertNoFallback(provider: string): void {
  if ((FORBIDDEN_FALLBACK_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`daytona sandbox must not fall back to ${provider}`)
  }
}

export function canProvision(entitlement: PaidEntitlement): ProvisionError | null {
  if (!entitlement.paid) return 'entitlement_required'
  if (entitlement.usedUsd >= entitlement.budgetUsd) return 'budget_exceeded'
  if (!DAYTONA_PAID_PROVISION_ENABLED) return DAYTONA_GATE
  return null
}

export function provisionSandbox(
  entitlement: PaidEntitlement,
  now: number,
  mintId: () => string = () => `sbx_${now.toString(36)}`,
): ProvisionResult {
  assertNoFallback('daytona')
  if (mayEmbedGrokBotUi()) {
    throw new Error('grok-bot raw UI reuse is forbidden')
  }
  const denied = canProvision(entitlement)
  if (denied) {
    return { ok: false, error: denied, provider: 'daytona' }
  }
  const sandbox: DaytonaSandbox = {
    id: mintId(),
    accountId: entitlement.accountId,
    provider: 'daytona',
    templateId: HARDENED_TEMPLATE_ID,
    state: 'ready',
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + entitlement.inactivityTtlMs,
    artifacts: [],
  }
  return { ok: true, sandbox }
}

export function applyInactivity(sandbox: DaytonaSandbox, now: number): DaytonaSandbox {
  if (sandbox.state === 'shutdown') return sandbox
  if (now >= sandbox.expiresAt) {
    return { ...sandbox, state: 'inactive' }
  }
  return sandbox
}

export function incidentShutdown(sandbox: DaytonaSandbox, now: number): DaytonaSandbox {
  return { ...sandbox, state: 'shutdown', lastActiveAt: now }
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
  }
}

export function operatorHealth(sandbox: DaytonaSandbox, entitlement: PaidEntitlement): OperatorHealth {
  return {
    healthy: sandbox.state === 'ready',
    state: sandbox.state,
    budgetRemainingUsd: Math.max(0, entitlement.budgetUsd - entitlement.usedUsd),
  }
}

export function nativeSurfaceId(): string {
  return GROK_BOT_REUSE_DECISION.nativeSurface
}
