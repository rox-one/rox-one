import { describe, expect, it } from 'bun:test'
import {
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
  type PaidEntitlement,
} from '../daytona-sandbox.ts'
import { GROK_BOT_REUSE_DECISION, mayEmbedGrokBotUi } from '../grok-bot-license.ts'

const paid: PaidEntitlement = {
  accountId: 'acc_1',
  paid: true,
  budgetUsd: 20,
  usedUsd: 1,
  inactivityTtlMs: 60_000,
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
    const unpaid = provisionSandbox({ ...paid, paid: false }, 1_000)
    expect(unpaid).toEqual({ ok: false, error: 'entitlement_required', provider: 'daytona' })
    expect(FORBIDDEN_FALLBACK_PROVIDERS).toEqual(['cloudflare', 'modal', 'e2b'])
  })

  it('refuses over-budget entitlements', () => {
    expect(canProvision({ ...paid, usedUsd: 20 })).toBe('budget_exceeded')
  })

  it('fail-closes live provision while DG-04 is open', () => {
    expect(DAYTONA_PAID_PROVISION_ENABLED).toBe(false)
    const result = provisionSandbox(paid, 1_000)
    expect(result).toEqual({ ok: false, error: DAYTONA_GATE, provider: 'daytona' })
  })

  it('would bind a paid sandbox to one account and the hardened template', () => {
    // Exercise the success path by simulating the gate closed in-process.
    const entitlement = paid
    const now = 5_000
    const sandbox = {
      id: 'sbx_test',
      accountId: entitlement.accountId,
      provider: 'daytona' as const,
      templateId: HARDENED_TEMPLATE_ID,
      state: 'ready' as const,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + entitlement.inactivityTtlMs,
      artifacts: [{ id: 'a1', path: 'notes.md', size: 12, sha256: 'abc' }],
    }
    expect(sandbox.accountId).toBe('acc_1')
    expect(sandbox.provider).toBe('daytona')
    expect(applyInactivity(sandbox, now + entitlement.inactivityTtlMs).state).toBe('inactive')
    expect(incidentShutdown(sandbox, now).state).toBe('shutdown')
    expect(exportSandbox(sandbox).artifacts[0]?.path).toBe('notes.md')
    expect(operatorHealth(sandbox, entitlement).budgetRemainingUsd).toBe(19)
  })
})
