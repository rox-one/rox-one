import { describe, expect, it } from 'bun:test'
import {
  OpsError,
  createAuditLog,
  createKillSwitch,
  type AuditInput,
  type KillRequestInput,
  type KillScope,
} from '../index.ts'

function tickingClock(start = '2026-11-19T10:00:00.000Z', stepMs = 1_000): () => Date {
  let ms = Date.parse(start)
  return () => new Date((ms += stepMs))
}

function auditInput(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    actorId: 'staff_support_1',
    action: 'sandbox.stop',
    targetType: 'sandbox',
    targetId: 'sbx_1',
    reason: 'Customer asked to stop a runaway run',
    ...overrides,
  }
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof OpsError ? error.code : undefined
  }
  return undefined
}

describe('audit log', () => {
  it('rejects an entry without a reason', () => {
    const log = createAuditLog({ now: tickingClock() })
    expect(errorCode(() => log.append(auditInput({ reason: '   ' })))).toBe('invalid_input')
    expect(log.entries).toHaveLength(0)
  })

  it('rejects an entry without an actor', () => {
    const log = createAuditLog({ now: tickingClock() })
    expect(errorCode(() => log.append(auditInput({ actorId: '' })))).toBe('invalid_input')
    expect(log.entries).toHaveLength(0)
  })

  it('rejects a token nested anywhere in details', () => {
    const log = createAuditLog({ now: tickingClock() })
    const code = errorCode(() =>
      log.append(auditInput({ details: { provider: { request: { token: 'dt_live_1' } } } })),
    )
    expect(code).toBe('secret_in_audit')
    expect(log.entries).toHaveLength(0)
  })

  it('rejects a password inside an array in details', () => {
    const log = createAuditLog({ now: tickingClock() })
    const code = errorCode(() =>
      log.append(auditInput({ details: { headers: [{ password: 'hunter2' }] } })),
    )
    expect(code).toBe('secret_in_audit')
  })

  it('verifies the chain across 50 entries', () => {
    const log = createAuditLog({ now: tickingClock() })
    for (let i = 0; i < 50; i += 1) {
      log.append(auditInput({ targetId: `sbx_${i}`, ticket: `SUP-${i}` }))
    }
    expect(log.verifyChain()).toEqual({ ok: true, count: 50 })
  })

  it('breaks the chain at the edited index', () => {
    const log = createAuditLog({ now: tickingClock() })
    for (let i = 0; i < 10; i += 1) {
      log.append(auditInput({ targetId: `sbx_${i}` }))
    }
    log.entries[7]!.reason = 'Rewritten after the fact'
    expect(log.verifyChain()).toEqual({ ok: false, brokenAt: 7 })
  })

  it('filters by action and actor', () => {
    const log = createAuditLog({ now: tickingClock() })
    log.append(auditInput({ actorId: 'staff_a', action: 'sandbox.stop' }))
    log.append(auditInput({ actorId: 'staff_b', action: 'credit.grant' }))
    log.append(auditInput({ actorId: 'staff_a', action: 'credit.grant' }))
    log.append(auditInput({ actorId: 'staff_a', action: 'sandbox.extend' }))

    expect(log.list({ action: 'credit.grant' }).map((entry) => entry.actorId)).toEqual([
      'staff_b',
      'staff_a',
    ])
    expect(log.list({ actorId: 'staff_a' })).toHaveLength(3)
    expect(log.list({ actorId: 'staff_a', action: 'sandbox.extend' })).toHaveLength(1)
    expect(log.list({ targetId: 'sbx_1' })).toHaveLength(4)
  })

  it('keeps entries in time order with the newest when limited', () => {
    const log = createAuditLog({ now: tickingClock() })
    for (let i = 0; i < 6; i += 1) {
      log.append(auditInput({ targetId: `sbx_${i}` }))
    }
    expect(log.list({ limit: 2 }).map((entry) => entry.targetId)).toEqual(['sbx_4', 'sbx_5'])
  })
})

function killInput(scope: KillScope, enabled = true): KillRequestInput {
  return { scope, enabled, reason: 'Provider health checks are failing in this region' }
}

describe('kill switch', () => {
  it('keeps a request pending when approval is required', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    const request = killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    expect(request.state).toBe('pending')
    expect(request.approvedBy).toBeUndefined()
    expect(killSwitch.isBlocked({ provider: 'daytona' })).toBeNull()
  })

  it('rejects approval by the same person', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    const request = killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    expect(errorCode(() => killSwitch.approve(request.id, 'staff_a'))).toBe('second_person_required')
    expect(killSwitch.list()[0]!.state).toBe('pending')
  })

  it('activates when a different person approves', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    const request = killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    const approved = killSwitch.approve(request.id, 'staff_b')
    expect(approved.state).toBe('active')
    expect(approved.approvedBy).toBe('staff_b')
    expect(killSwitch.isBlocked({ provider: 'daytona' })?.id).toBe(request.id)
  })

  it('goes active straight away when approval is not required', () => {
    const killSwitch = createKillSwitch({ now: tickingClock(), requireApproval: false })
    const request = killSwitch.request(killInput({ provider: 'modal' }), 'staff_a')
    expect(request.state).toBe('active')
    expect(killSwitch.isBlocked({ provider: 'modal', region: 'us-east' })?.id).toBe(request.id)
  })

  it('blocks every region of a named provider and no other provider', () => {
    const killSwitch = createKillSwitch({ now: tickingClock(), requireApproval: false })
    killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    expect(killSwitch.isBlocked({ provider: 'daytona', region: 'eu-central' })).not.toBeNull()
    expect(killSwitch.isBlocked({ provider: 'daytona', region: 'us-west' })).not.toBeNull()
    expect(killSwitch.isBlocked({ provider: 'modal', region: 'eu-central' })).toBeNull()
    expect(killSwitch.isBlocked({ provider: 'e2b' })).toBeNull()
  })

  it('matches an exact provider, region and product', () => {
    const killSwitch = createKillSwitch({ now: tickingClock(), requireApproval: false })
    killSwitch.request(
      killInput({ provider: 'modal', region: 'us-east', product: 'cloud-runs' }),
      'staff_a',
    )
    expect(
      killSwitch.isBlocked({ provider: 'modal', region: 'us-east', product: 'cloud-runs' }),
    ).not.toBeNull()
    expect(
      killSwitch.isBlocked({ provider: 'modal', region: 'us-east', product: 'cloud-chat' }),
    ).toBeNull()
    expect(killSwitch.isBlocked({ provider: 'modal', region: 'eu-west', product: 'cloud-runs' })).toBeNull()
  })

  it('blocks everything when the scope is empty', () => {
    const killSwitch = createKillSwitch({ now: tickingClock(), requireApproval: false })
    killSwitch.request(killInput({}), 'staff_a')
    expect(killSwitch.isBlocked({})).not.toBeNull()
    expect(killSwitch.isBlocked({ provider: 'e2b', region: 'ap-south', product: 'cloud-runs' })).not.toBeNull()
  })

  it('stops blocking after the request is disabled', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    const request = killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    killSwitch.approve(request.id, 'staff_b')
    expect(killSwitch.isBlocked({ provider: 'daytona' })).not.toBeNull()

    const disabled = killSwitch.disable(request.id, 'staff_c', 'Provider recovered')
    expect(disabled.state).toBe('disabled')
    expect(killSwitch.isBlocked({ provider: 'daytona' })).toBeNull()
  })

  it('requires a reason and a requester', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    expect(errorCode(() => killSwitch.request(killInput({}), '   '))).toBe('invalid_input')
    expect(
      errorCode(() =>
        killSwitch.request({ scope: { provider: 'daytona' }, enabled: true, reason: '  ' }, 'staff_a'),
      ),
    ).toBe('invalid_input')
    expect(killSwitch.list()).toHaveLength(0)
  })

  it('refuses a second approval of an already active request', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    const request = killSwitch.request(killInput({ provider: 'daytona' }), 'staff_a')
    killSwitch.approve(request.id, 'staff_b')
    expect(errorCode(() => killSwitch.approve(request.id, 'staff_c'))).toBe('invalid_state')
  })

  it('refuses an unknown request id', () => {
    const killSwitch = createKillSwitch({ now: tickingClock() })
    expect(errorCode(() => killSwitch.approve('missing', 'staff_b'))).toBe('not_found')
    expect(errorCode(() => killSwitch.disable('missing', 'staff_b', 'n/a'))).toBe('not_found')
  })
})
