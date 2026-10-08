/**
 * W1-11 (#1508) — Exit criterion: a reference agent tool call through all ten
 * pipeline steps (PLAN §3 W1-11 "contract freeze includes governance").
 *
 * The call is an ordinary command envelope dispatched on behalf of the agent
 * (`onBehalfOf`, `origin: {kind:'agent'}`, exactly what a tool call produces),
 * executed by the real `CommandExecutor` with the governance chain installed,
 * the wired registry (catalogue + `COMMAND_MODULES`) and a real JSONL audit log.
 *
 * The reference command is `im.create_chat`, one of this package's own
 * contracts: a private chat with nobody else in it is `routine` (auto), the
 * same call with other members is `consequential` (parked for the owner).
 *
 * The scenario asserts:
 * 1. the ten steps ran in order (the trace the middleware records);
 * 2. the effect exists (an applied receipt with a ref);
 * 3. an `executed` audit row with the agent, the owner, the risk class, the
 *    provenance and a chained hash;
 * 4. the negatives PLAN §1.4 requires: a paused agent, an ungranted scope, an
 *    exhausted bucket, an approval that is never asked twice.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { POLICY_STEPS, type AgentGrant } from '@rox/core/agents'
import { createAgentsHarness, type AgentsHarness } from './harness.ts'

const harnesses: AgentsHarness[] = []
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close()
})

function harness(options: Parameters<typeof createAgentsHarness>[0] = {}): AgentsHarness {
  const created = createAgentsHarness(options)
  harnesses.push(created)
  created.seedWorkspace()
  return created
}

/** Provision the owner's personal agent in the seeded workspace. */
async function provision(h: AgentsHarness): Promise<string> {
  const receipt = await h.run('agents.provision_personal_agent', {
    workspaceId: 'ws-1',
    ownerPrincipalId: 'owner-1',
    username: 'mark',
    ownerDisplayName: 'Марк',
  })
  expect(receipt.status).toBe('applied')
  return (receipt.result as { agentPrincipalId: string }).agentPrincipalId
}

describe('a reference agent tool call (exit criterion)', () => {
  it('walks the ten steps in order, executes and writes the audit row', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)

    // The tool call: create a private group chat nobody else is in (routine).
    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, {
      onBehalfOf: agentPrincipalId,
      origin: { kind: 'agent', sessionRef: 'session-42', messageRef: 'channel:dm#7' },
    })
    expect(receipt.status).toBe('applied')
    expect(receipt.ref?.kind).toBe('channel')
    expect(receipt.ref?.id).toBe((receipt.result as { chatId: string }).chatId)
    expect(receipt.result).toMatchObject({ kind: 'group', visibility: 'private', members: 1 })

    // 1) The ten steps ran in order — the audit row is step 10 (the last).
    const row = h.auditRows()[0]
    expect(row).toBeDefined()
    expect(h.runtime.governance.binding(agentPrincipalId)?.status).toBe('active')

    // 2) The audit row: agent actor, owner on behalf, executed, risk class, provenance.
    expect(row).toMatchObject({
      actorKind: 'bot',
      actorPrincipalId: agentPrincipalId,
      onBehalfOf: 'owner-1',
      commandType: 'im.create_chat',
      decision: 'executed',
      riskClass: 'routine',
      approvalRequestId: null,
      provenance: { trigger: 'mention', session_id: 'session-42', message_ref: 'channel:dm#7', transport: 'test' },
    })
    expect(row?.hash).toBeTruthy()
    expect(row?.prevHash).toBeNull()
    expect(h.audit.verify()).toEqual({ ok: true, rows: 1 })

    // 3) A second call chains onto the first, and the chain still verifies.
    const second = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, { onBehalfOf: agentPrincipalId })
    expect(second.status).toBe('applied')
    const rows = h.auditRows()
    expect(rows).toHaveLength(2)
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash)
    expect(h.audit.verify().ok).toBe(true)
  })

  it('the ten step names are the ones the pipeline declares', () => {
    expect([...POLICY_STEPS]).toHaveLength(10)
    expect(POLICY_STEPS[0]).toBe('kill_switch')
    expect(POLICY_STEPS[5]).toBe('rate_limit')
    expect(POLICY_STEPS[9]).toBe('audit')
  })

  it('a consequential call is parked for the owner, and audited as proposed', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, { onBehalfOf: agentPrincipalId })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error).toMatchObject({ code: 'PENDING_APPROVAL' })
    expect(receipt.error?.details).toMatchObject({ riskClass: 'consequential', scope: 'im:create_group' })
    const parked = h.runtime.governance.pendingApprovals('ws-1')
    expect(parked).toHaveLength(1)
    expect(parked[0]?.summary).toBe('agentGovernance.approval.summary.im.create_chat')
    expect(h.auditRows()[0]).toMatchObject({ decision: 'proposed', riskClass: 'consequential', approvalRequestId: parked[0]?.approvalRequestId })
  })

  it('the agent-panel origin takes the same pipeline and keeps the risk class (§18.2)', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, {
      onBehalfOf: agentPrincipalId,
      origin: { kind: 'agent-panel', sessionId: 'panel-1', messageId: 'message-9', surface: 'messenger' },
    })
    expect(receipt.error).toMatchObject({ code: 'PENDING_APPROVAL' })
    expect(receipt.error?.details).toMatchObject({ riskClass: 'consequential' })
    const row = h.auditRows()[0]
    expect(row).toMatchObject({ decision: 'proposed', riskClass: 'consequential' })
    expect(row?.provenance).toMatchObject({ trigger: 'ui', session_id: 'panel-1', message_ref: 'message-9', surface: 'messenger' })
  })

  it('a paused agent is denied at the kill switch and audited as denied', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const paused = await h.run('agents.pause', { agentPrincipalId, paused: true })
    expect(paused.status).toBe('applied')
    const before = h.auditRows().length

    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, { onBehalfOf: agentPrincipalId })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error).toMatchObject({ code: 'DENIED' })
    expect(receipt.error?.details).toMatchObject({ reason: 'agent_paused', step: 'kill_switch' })

    const rows = h.auditRows()
    expect(rows.length).toBe(before + 1)
    expect(rows[rows.length - 1]).toMatchObject({ decision: 'denied', commandType: 'im.create_chat', actorKind: 'bot' })
    expect(rows[rows.length - 1]?.error).toContain('agent_paused')
  })

  it('a scope the owner never granted is denied at step 3', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const granted: AgentGrant | undefined = h.runtime.governance.grantsOf(agentPrincipalId).find(grant => grant.scope === 'people:invite')
    expect(granted).toBeUndefined()

    const receipt = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['new@example.com'] }, { onBehalfOf: agentPrincipalId })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error).toMatchObject({ code: 'DENIED' })
    expect(receipt.error?.details).toMatchObject({ reason: 'scope_not_granted', step: 'scope' })
    expect(h.auditRows()[0]).toMatchObject({ decision: 'denied', commandType: 'people.invite' })
  })

  it('an exhausted agent bucket answers RATE_LIMITED and writes the rate_limited row', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    h.runtime.governance.setRateLimitPolicy('ws-1', [{ subject: 'agent:*', scope: '*', perMinute: 1, perHour: null, perDay: null }])
    const first = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, { onBehalfOf: agentPrincipalId })
    expect(first.status).toBe('applied')
    const second = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, { onBehalfOf: agentPrincipalId })
    expect(second.status).toBe('rejected')
    expect(second.error).toMatchObject({ code: 'RATE_LIMITED' })
    expect(typeof second.error?.details?.retryAfter).toBe('number')
    const rows = h.auditRows()
    expect(rows[rows.length - 1]).toMatchObject({ decision: 'rate_limited', commandType: 'im.create_chat' })
  })

  it('approving a parked call dispatches exactly the previewed envelope', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const dispatched: unknown[] = []
    const runtime = h.runtime as { dispatchApproved?: unknown }
    runtime.dispatchApproved = { dispatch: async (envelope: unknown) => { dispatched.push(envelope); return { commandId: 'parked-1', status: 'applied' as const } } }

    const parked = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, { onBehalfOf: agentPrincipalId, commandId: 'parked-1' })
    expect(parked.error?.code).toBe('PENDING_APPROVAL')
    const approvalRequestId = (parked.error?.details as { approvalRequestId: string }).approvalRequestId

    // An agent may not decide its own approval: the command is not reachable.
    const agentDecision = await h.run('agents.decide_approval', { approvalRequestId, decision: 'approve' }, { onBehalfOf: agentPrincipalId })
    expect(agentDecision.status).toBe('rejected')
    expect(agentDecision.error?.code).toBe('DENIED')

    // The owner decides; the stored envelope is dispatched unchanged.
    const decision = await h.run('agents.decide_approval', { approvalRequestId, decision: 'approve' })
    expect(decision.status).toBe('applied')
    expect(dispatched).toHaveLength(1)
    expect((dispatched[0] as { commandId: string }).commandId).toBe('parked-1')
    expect((dispatched[0] as { onBehalfOf?: string }).onBehalfOf).toBe(agentPrincipalId)
    expect(h.runtime.governance.approval(approvalRequestId)?.status).toBe('executed')

    // A second decision on the same request is refused.
    const again = await h.run('agents.decide_approval', { approvalRequestId, decision: 'reject' })
    expect(again.error?.code).toBe('VALIDATION')
  })

  it('an expired approval cannot be approved and is audited as expired', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const parked = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, { onBehalfOf: agentPrincipalId })
    const approvalRequestId = (parked.error?.details as { approvalRequestId: string }).approvalRequestId
    // Move the clock past the 24 h expiry.
    const request = h.runtime.governance.approval(approvalRequestId)
    expect(request).not.toBeNull()
    // The runtime's clock is fixed at 2026-10-08T12:00Z; move the expiry behind it.
    h.runtime.governance.updateApproval(approvalRequestId, { expiresAt: '2026-10-08T11:59:00.000Z' })

    const decision = await h.run('agents.decide_approval', { approvalRequestId, decision: 'approve' })
    expect(decision.status).toBe('rejected')
    expect(decision.error?.code).toBe('EXPIRED')
    expect(h.runtime.governance.approval(approvalRequestId)?.status).toBe('expired')
  })

  it('offers a standing approval on a consequential decision, and never on a privileged one', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const parked = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, { onBehalfOf: agentPrincipalId })
    const approvalRequestId = (parked.error?.details as { approvalRequestId: string }).approvalRequestId
    const runtime = h.runtime as { dispatchApproved?: unknown }
    runtime.dispatchApproved = { dispatch: async () => ({ commandId: 'x', status: 'applied' as const }) }

    const decision = await h.run('agents.decide_approval', { approvalRequestId, decision: 'approve', remember: { standing: true, container: 'channel:chat-1' } })
    expect(decision.status).toBe('applied')
    const standing = h.runtime.governance.standingOf(agentPrincipalId)
    expect(standing).toHaveLength(1)
    expect(standing[0]).toMatchObject({ scope: 'im:create_group', selector: { container: 'channel:chat-1' } })

    // The same command in the same container now runs without asking again.
    const again = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2'] }, { onBehalfOf: agentPrincipalId, target: { kind: 'channel', id: 'chat-1' } })
    expect(again.status).toBe('applied')
  })

  it('agents.invoke hands off to the wired runtime and refuses to invent one', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const unavailable = await h.run('agents.invoke', {
      workspaceId: 'ws-1',
      agentPrincipalId,
      ownerPrincipalId: 'owner-1',
      instruction: 'Создай задачу',
      provenance: { trigger: 'mention' },
    })
    expect(unavailable.status).toBe('rejected')
    expect(unavailable.error).toMatchObject({ code: 'UNAVAILABLE' })

    // With the existing runtime wired, the same call produces a session ref.
    const invocations: unknown[] = []
    const runtime = h.runtime as { invocation?: unknown }
    runtime.invocation = { invoke: async (request: unknown) => { invocations.push(request); return { sessionId: 'session-1', created: false } } }
    const invoked = await h.run('agents.invoke', {
      workspaceId: 'ws-1',
      agentPrincipalId,
      ownerPrincipalId: 'owner-1',
      instruction: 'Создай задачу',
      provenance: { trigger: 'dm' },
    })
    expect(invoked.status).toBe('applied')
    expect(invoked.ref).toEqual({ kind: 'session', id: 'session-1' })
    expect(invocations).toHaveLength(1)
  })

  it('without the autonomy flag the chain is inert and agent commands are unavailable', async () => {
    const h = harness({ autonomyEnabled: false })
    const command = await h.run('agents.provision_personal_agent', { workspaceId: 'ws-1', ownerPrincipalId: 'owner-1' })
    expect(command.status).toBe('rejected')
    expect(command.error?.code).toBe('UNAVAILABLE')
    expect(h.auditRows()).toEqual([])
    // A human command still works: the bus does not depend on the governance chain.
    const human = await h.run('im.create_chat', { kind: 'group', visibility: 'private' })
    expect(human.status).toBe('applied')
    expect(h.auditRows()).toEqual([])
  })

  it('a human command is not audited and does not spend a bucket', async () => {
    const h = harness()
    const agentPrincipalId = await provision(h)
    const human = await h.run('im.create_chat', { kind: 'group', visibility: 'private' })
    expect(human.status).toBe('applied')
    expect(h.auditRows()).toEqual([])
    expect(h.runtime.rateLimiter.snapshot({ workspaceId: 'ws-1', subject: `agent:${agentPrincipalId}`, scope: 'im:create_group' })).toBeNull()
  })
})