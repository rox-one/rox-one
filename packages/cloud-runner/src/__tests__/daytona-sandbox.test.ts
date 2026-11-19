import { describe, expect, it } from 'bun:test'
import {
  DAYTONA_GATE,
  DEFAULT_PAID_PROVISION_ENABLED,
  FORBIDDEN_FALLBACK_PROVIDERS,
  HARDENED_TEMPLATE_ID,
  applyInactivity,
  canProvision,
  exportSandbox,
  incidentShutdown,
  nativeSurfaceId,
  operatorHealth,
  provisionSandbox,
  type PaidEntitlement,
  type PaidProvisionRuntime,
  type ProvisionRequest,
} from '../daytona-sandbox.ts'
import { createMemoryMoneyStore } from '../entitlement.ts'
import { GROK_BOT_REUSE_DECISION, mayEmbedGrokBotUi } from '../grok-bot-license.ts'

const paid: PaidEntitlement = {
  accountId: 'acc_1',
  paid: true,
  budgetUsd: 20,
  usedUsd: 1,
  inactivityTtlMs: 60_000,
}

const REQUEST: ProvisionRequest = { id: 'sbx_test', cpu: 1, memoryGb: 1, ttlMs: 60_000 }

function runtime(overrides: Partial<PaidProvisionRuntime> = {}): PaidProvisionRuntime {
  const store = createMemoryMoneyStore()
  store.saveAccount({
    id: 'acc_1',
    paid: true,
    balanceCents: 100_000,
    reservedCents: 0,
    monthlyCapCents: 0,
    monthSpentCents: 0,
  })
  return {
    store,
    limits: { maxConcurrentSandboxes: 0, maxCpuPerSandbox: 0, maxMonthlyCents: 0 },
    featureEnabled: true,
    now: 1_000,
    mintId: () => 'sbx_test',
    rateCentsPerHour: 60,
    ...overrides,
  }
}

describe('grok-bot license review', () => {
  it('rejects embedding the reconstructed grok-bot UI', () => {
    expect(GROK_BOT_REUSE_DECISION.reuse).toBe('rejected')
    expect(mayEmbedGrokBotUi()).toBe(false)
    expect(nativeSurfaceId()).toBe('rox-sandbox-tab')
  })
})

describe('paid Daytona sandbox', () => {
  it('refuses unpaid accounts and never names a fallback provider', () => {
    const unpaid = provisionSandbox({ ...paid, paid: false }, runtime(), REQUEST)
    expect(unpaid).toEqual({ ok: false, error: 'entitlement_required', provider: 'daytona' })
    expect(FORBIDDEN_FALLBACK_PROVIDERS).toEqual(['cloudflare', 'modal', 'e2b'])
  })

  it('refuses over-budget entitlements', () => {
    expect(canProvision({ ...paid, usedUsd: 20 })).toBe('budget_exceeded')
  })

  it('fail-closes live provision while DG-04 is open', () => {
    expect(DEFAULT_PAID_PROVISION_ENABLED).toBe(false)
    const result = provisionSandbox(paid, runtime({ featureEnabled: undefined }), REQUEST)
    expect(result).toEqual({ ok: false, error: DAYTONA_GATE, provider: 'daytona' })
  })

  it('would bind a paid sandbox to one account and the hardened template', () => {
    const entitlement = paid
    const rt = runtime()
    const provisioned = provisionSandbox(entitlement, rt, REQUEST)
    if (!provisioned.ok) throw new Error(provisioned.error)
    const now = rt.now
    const sandbox = {
      ...provisioned.sandbox,
      artifacts: [{ id: 'a1', path: 'notes.md', size: 12, sha256: 'abc' }],
    }
    expect(provisioned.sandbox.templateId).toBe(HARDENED_TEMPLATE_ID)
    expect(provisioned.sandbox.expiresAt).toBe(now + REQUEST.ttlMs)
    expect(provisioned.sandbox.routingReason).toBeTruthy()
    expect(rt.store.findReservation('acc_1', 'sbx_test')).toBe(1)
    expect(sandbox.accountId).toBe('acc_1')
    expect(sandbox.provider).toBe('daytona')
    expect(applyInactivity(sandbox, now + entitlement.inactivityTtlMs).state).toBe('inactive')
    expect(incidentShutdown(sandbox, now).state).toBe('shutdown')
    expect(exportSandbox(sandbox).artifacts[0]?.path).toBe('notes.md')
    expect(operatorHealth(sandbox, entitlement).budgetRemainingUsd).toBe(19)
  })
})
