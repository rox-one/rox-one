/**
 * W1-11 (#1508) — Governance middleware: the ten pipeline steps, in order,
 * around the terminal execute (TECH-SPEC §13.2, PLAN §3 W1-11 exit criterion).
 *
 * The chain is composed exactly as a host installs it
 * (`createAgentGovernanceChain`), with a fake terminal standing in for the
 * executor's transactional `execute` stage, so the assertions are about the
 * middleware contract: the trace, the receipts of stalled decisions, the audit
 * row at the terminal decision, and the pass-through for human commands.
 */

import { describe, expect, it } from 'bun:test'
import { CommandRegistry, type CommandDefinition } from '../registry.ts'
import { composeCommandMiddleware, type CommandPipelineContext } from '../pipeline.ts'
import { createCommandEnvelope } from '../envelope.ts'
import { LOCAL_OWNER_AUTHORIZER } from '../authorizer.ts'
import { registerCommandCatalogue } from '../catalogue/index.ts'
import { createAgentGovernanceChain } from '../middleware/index.ts'
import {
  GOVERNANCE_TRACE_STATE,
  GOVERNANCE_AUDIT_STATE,
  type AuditMiddlewareDeps,
  type PolicyGovernanceDeps,
} from '../middleware/index.ts'
import { AGENT_SCOPES, DELETE_SCOPE } from '../../agents/risk.ts'
import {
  AGGREGATE_SCOPE,
  approvalPolicyForPermissionMode,
  type AgentBinding,
  type AgentGrant,
  type ApprovalRequest,
  type RateLimitSpend,
  type StandingApproval,
} from '../../agents/governance.ts'
import { POLICY_STEPS } from '../../agents/policy.ts'
import type { AuditRowInput } from '../../agents/audit.ts'
import type { CommandReceipt } from '../receipt.ts'

const WORKSPACE = 'ws-1'
const OWNER = 'owner-1'
const AGENT = 'agent-1'

const registry = new CommandRegistry()
registerCommandCatalogue(registry)

function definitionOf(type: string): CommandDefinition<unknown> {
  const definition = registry.get(type)
  if (!definition) throw new Error(`Unknown command: ${type}`)
  return definition
}

interface Options {
  status?: AgentBinding['status']
  standing?: readonly StandingApproval[]
  rateLimit?: (spend: RateLimitSpend) => { allowed: true } | { allowed: false; window: 'minute' | 'hour' | 'day'; retryAfter: number; bucketScope?: string }
  enabled?: boolean
  permissionMode?: 'ask' | 'safe' | 'allow-all'
}

interface Rig {
  run(payload: unknown, options?: { human?: boolean; origin?: unknown }): Promise<CommandReceipt>
  ctx: () => CommandPipelineContext | null
  parked: ApprovalRequest[]
  audit: AuditRowInput[]
  spent: RateLimitSpend[]
}

function rig(type: string, options: Options = {}): Rig {
  const parked: ApprovalRequest[] = []
  const audit: AuditRowInput[] = []
  const spent: RateLimitSpend[] = []
  let context: CommandPipelineContext | null = null
  const grants: AgentGrant[] = [...new Set([...AGENT_SCOPES, DELETE_SCOPE])].map((scope, index) => ({
    agentGrantId: `grant-${index}`,
    workspaceId: WORKSPACE,
    agentPrincipalId: AGENT,
    scope,
    selector: {},
    grantedBy: OWNER,
  }))
  const binding: AgentBinding = {
    agentPrincipalId: AGENT, workspaceId: WORKSPACE, ownerPrincipalId: OWNER, handle: 'rox', displayName: 'Rox', runtime: 'omp',
    status: options.status ?? 'active',
  }
  const ports: PolicyGovernanceDeps['ports'] = {
    async agentBinding() { return binding },
    async pauseAllAgents() { return false },
    async grants() { return grants },
    authorizer: LOCAL_OWNER_AUTHORIZER,
    async approvalPolicy() { return approvalPolicyForPermissionMode(OWNER, options.permissionMode ?? 'ask') },
    async standingApprovals() { return options.standing ?? [] },
    rateLimit: async spend => {
      spent.push(spend)
      return options.rateLimit ? options.rateLimit(spend) : { allowed: true }
    },
    async park(request) { parked.push(request) },
  }
  const policy: PolicyGovernanceDeps = {
    isEnabled: () => options.enabled !== false,
    now: () => new Date('2026-10-08T12:00:00.000Z'),
    ports,
    permissionMode: () => options.permissionMode ?? 'ask',
    actionContext: () => ({}),
  }
  const auditDeps: AuditMiddlewareDeps = {
    isEnabled: () => options.enabled !== false,
    now: () => new Date('2026-10-08T12:00:00.000Z'),
    writer: {
      async append(row) {
        audit.push(row)
        return { prevHash: null, hash: 'hash-1' }
      },
    },
    requestHash: () => 'request-hash-1',
    transport: () => 'ws-rpc',
    newAuditId: () => 'audit-1',
  }
  const chain = createAgentGovernanceChain({ policy, audit: auditDeps })
  const terminal = async (ctx: CommandPipelineContext): Promise<CommandReceipt> => {
    context = ctx
    ctx.state.set('terminal.calls', Number(ctx.state.get('terminal.calls') ?? 0) + 1)
    return { commandId: ctx.envelope.commandId, status: 'applied', ref: { kind: 'task', id: 'task-1' }, revision: 3 }
  }
  const run = composeCommandMiddleware(chain, terminal)
  return {
    parked,
    audit,
    spent,
    ctx: () => context,
    run: async (payload, runOptions = {}) => {
      const definition = definitionOf(type)
      const envelope = createCommandEnvelope(definition.type, payload, {
        ...(runOptions.human ? {} : { onBehalfOf: AGENT }),
        ...(runOptions.origin ? { origin: runOptions.origin as never } : {}),
      })
      const ctx: CommandPipelineContext = {
        envelope,
        definition,
        payload,
        workspaceId: WORKSPACE,
        actor: runOptions.human ? { principalId: OWNER, kind: 'user' } : { principalId: OWNER, kind: 'user' },
        authority: 'workspace',
        state: new Map(),
      }
      const receipt = await run(ctx)
      context = ctx
      return receipt
    },
  }
}

function traceOf(ctx: CommandPipelineContext | null): unknown {
  return ctx?.state.get(GOVERNANCE_TRACE_STATE)
}

describe('the governance chain walks the ten steps in order', () => {
  it('an auto (routine) agent command executes and leaves the full trace', async () => {
    const r = rig('tasks.create')
    const receipt = await r.run({ name: 'Write the spec' })
    expect(receipt).toMatchObject({ status: 'applied', ref: { kind: 'task', id: 'task-1' } })
    expect(traceOf(r.ctx())).toEqual([...POLICY_STEPS])
    expect(r.parked).toEqual([])
    expect(r.audit).toHaveLength(1)
    expect(r.audit[0]).toMatchObject({
      actorKind: 'bot',
      actorPrincipalId: AGENT,
      onBehalfOf: OWNER,
      commandType: 'tasks.create',
      decision: 'executed',
      riskClass: 'routine',
      requestHash: 'request-hash-1',
      provenance: { transport: 'ws-rpc' },
    })
    expect(r.ctx()?.state.get(GOVERNANCE_AUDIT_STATE)).toMatchObject({ hash: 'hash-1' })
  })

  it('a consequential command parks as PENDING_APPROVAL with the request id and risk class', async () => {
    const r = rig('im.create_chat')
    const receipt = await r.run({ kind: 'group', visibility: 'private', members: [{ id: 'p2' }] })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error).toMatchObject({ code: 'PENDING_APPROVAL' })
    expect(receipt.error?.details).toMatchObject({ riskClass: 'consequential', scope: 'im:create_group', expiresAt: '2026-10-09T12:00:00.000Z' })
    expect(r.parked).toHaveLength(1)
    expect(r.parked[0]?.command).toMatchObject({ type: 'im.create_chat' })
    // Step 9 parks the command; step 10 still writes the `proposed` row.
    expect(traceOf(r.ctx())).toEqual([...POLICY_STEPS])
    expect(r.audit[0]).toMatchObject({ decision: 'proposed', approvalRequestId: r.parked[0]?.approvalRequestId })
  })

  it('a matching standing approval turns the same command into an execution, without parking', async () => {
    const r = rig('im.create_chat', {
      standing: [{
        standingApprovalId: 's1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'im:create_group', selector: {},
        createdBy: OWNER, expiresAt: '2026-11-08T12:00:00.000Z',
      }],
    })
    const receipt = await r.run({ kind: 'group', visibility: 'private', members: [{ id: 'p2' }] })
    expect(receipt.status).toBe('applied')
    expect(r.parked).toEqual([])
    expect(traceOf(r.ctx())).toEqual([...POLICY_STEPS])
    expect(r.audit[0]?.decision).toBe('executed')
  })

  it('a privileged command with the same standing approval still parks (§13.3)', async () => {
    const r = rig('people.invite', {
      standing: [{
        standingApprovalId: 's1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'people:invite', selector: {},
        createdBy: OWNER, expiresAt: '2026-11-08T12:00:00.000Z',
      }],
    })
    const receipt = await r.run({ emails: ['a@example.com'] })
    expect(receipt.error?.code).toBe('PENDING_APPROVAL')
    expect(receipt.error?.details).toMatchObject({ riskClass: 'privileged' })
    expect(r.audit[0]?.decision).toBe('proposed')
  })

  it('a paused agent is denied and audited as denied', async () => {
    const r = rig('tasks.create', { status: 'paused' })
    const receipt = await r.run({ name: 'x' })
    expect(receipt.error).toMatchObject({ code: 'DENIED' })
    expect(receipt.error?.details).toMatchObject({ reason: 'agent_paused', step: 'kill_switch' })
    // The pipeline stopped at step 1; only the audit step ran after it.
    expect(traceOf(r.ctx())).toEqual(['audit'])
    // The row carries the denial reason, so the audit is self-contained.
    expect(r.audit[0]).toMatchObject({ decision: 'denied', riskClass: 'routine' })
    expect(r.audit[0]?.error).toBe('DENIED: Agent policy denied the command (agent_paused)')
  })

  it('an exhausted bucket answers RATE_LIMITED with retryAfter and stops before the gate', async () => {
    const r = rig('im.send_message', {
      // One spend per command; the limiter reports which bucket refused.
      rateLimit: () => ({ allowed: false, window: 'hour', retryAfter: 90, bucketScope: AGGREGATE_SCOPE }),
    })
    const receipt = await r.run({ chatRef: 'channel:1', text: 'hi' })
    expect(receipt.error).toMatchObject({ code: 'RATE_LIMITED' })
    expect(receipt.error?.details).toMatchObject({ retryAfter: 90, window: 'hour', bucketScope: AGGREGATE_SCOPE })
    expect(traceOf(r.ctx())).toEqual([...POLICY_STEPS].slice(0, 6).concat('audit'))
    expect(r.audit[0]?.decision).toBe('rate_limited')
    expect(r.spent.map(spend => spend.scope)).toEqual(['im:send_chat'])
  })

  it('a failed terminal receipt is audited as failed, keeping receipt details', async () => {
    const r = rig('tasks.create')
    const definition = definitionOf('tasks.create')
    const ctx: CommandPipelineContext = {
      envelope: createCommandEnvelope(definition.type, {}, { onBehalfOf: AGENT }),
      definition,
      payload: {},
      workspaceId: WORKSPACE,
      actor: { principalId: OWNER, kind: 'user' },
      authority: 'workspace',
      state: new Map(),
    }
    const chain = createAgentGovernanceChain({
      policy: {
        isEnabled: () => true,
        now: () => new Date('2026-10-08T12:00:00.000Z'),
        ports: {
          async agentBinding() { return { agentPrincipalId: AGENT, workspaceId: WORKSPACE, ownerPrincipalId: OWNER, handle: 'rox', displayName: 'Rox', runtime: 'omp', status: 'active' } },
          async pauseAllAgents() { return false },
          async grants() { return [{ agentGrantId: 'g', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'tasks:create', selector: {}, grantedBy: OWNER }] },
          authorizer: LOCAL_OWNER_AUTHORIZER,
          async approvalPolicy() { return approvalPolicyForPermissionMode(OWNER, 'ask') },
          async standingApprovals() { return [] },
          rateLimit: async () => ({ allowed: true }),
          async park() {},
        },
        permissionMode: () => 'ask',
        actionContext: () => ({}),
      },
      audit: {
        isEnabled: () => true,
        now: () => new Date('2026-10-08T12:00:00.000Z'),
        writer: { async append(row) { r.audit.push(row); return { prevHash: null, hash: 'h' } } },
        requestHash: () => 'rh',
      },
    })
    const run = composeCommandMiddleware(chain, async () => ({ commandId: ctx.envelope.commandId, status: 'rejected', error: { code: 'FORBIDDEN', message: 'nope' } }))
    const receipt = await run(ctx)
    expect(receipt.status).toBe('rejected')
    expect(r.audit[0]).toMatchObject({ decision: 'failed', error: 'FORBIDDEN: nope' })
  })
})

describe('pass-through and inert behaviour', () => {
  it('a human command runs the terminal without touching a port and without an audit row', async () => {
    const r = rig('tasks.create')
    const receipt = await r.run({ name: 'mine' }, { human: true })
    expect(receipt.status).toBe('applied')
    expect(r.spent).toEqual([])
    expect(r.parked).toEqual([])
    expect(r.audit).toEqual([])
    expect(traceOf(r.ctx())).toBeUndefined()
  })

  it('with the flag off the whole chain is inert even for an agent command', async () => {
    const r = rig('im.create_chat', { enabled: false })
    const receipt = await r.run({ kind: 'group', visibility: 'private', members: [{ id: 'p2' }] })
    expect(receipt.status).toBe('applied')
    expect(r.parked).toEqual([])
    expect(r.audit).toEqual([])
    expect(r.spent).toEqual([])
    expect(traceOf(r.ctx())).toBeUndefined()
  })

  it('an agent-panel origin keeps the full pipeline and records the UI trigger', async () => {
    const r = rig('im.create_chat')
    const receipt = await r.run(
      { kind: 'group', visibility: 'private', members: [{ id: 'p2' }] },
      { origin: { kind: 'agent-panel', sessionId: 'session-1', messageId: 'message-1', surface: 'messenger' } },
    )
    expect(receipt.error?.code).toBe('PENDING_APPROVAL')
    expect(r.audit[0]?.provenance).toMatchObject({ trigger: 'ui', session_id: 'session-1', message_ref: 'message-1', surface: 'messenger' })
    // §18.2: the origin does not change the risk class or the decision.
    expect(r.audit[0]?.riskClass).toBe('consequential')
    const plain = rig('im.create_chat')
    const plainReceipt = await plain.run({ kind: 'group', visibility: 'private', members: [{ id: 'p2' }] })
    expect(plainReceipt.error?.details).toMatchObject({ riskClass: receipt.error?.details?.riskClass as string })
  })

  it('the chain names are stable and unique', () => {
    const r = rig('tasks.create')
    const names = createAgentGovernanceChain({
      policy: { isEnabled: () => true, now: () => new Date(), ports: null as never, permissionMode: () => 'ask', actionContext: () => ({}) },
      audit: { isEnabled: () => true, now: () => new Date(), writer: { async append() { return { prevHash: null, hash: '' } } }, requestHash: () => '' },
    }).map(middleware => middleware.name)
    expect(names).toEqual(['agent-audit', 'agent-policy', 'agent-rate-limit', 'agent-approval-gate'])
    expect(new Set(names).size).toBe(names.length)
    expect(r.ctx()).toBeNull()
  })
})