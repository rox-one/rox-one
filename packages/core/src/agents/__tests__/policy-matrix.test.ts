/**
 * W1-11 (#1508) — Generated policy matrix (PLAN §3 W1-11: "policy matrix
 * (generated: scope × risk × mode × standing × floor)").
 *
 * Every row runs the real catalogue definition (its verb, its `riskClass`) and
 * the real `scopeForCommand` mapping through `evaluatePolicy` with in-memory
 * ports, so the expected decision is derived from TECH-SPEC §13.2 rather than
 * from a table kept in the test.
 *
 * The negative cases PLAN §1.4 requires are in the second block: a paused
 * agent, a scope mismatch, an exhausted bucket, an expired standing approval
 * and the privileged + standing combination that must never auto-execute.
 */

import { describe, expect, it } from 'bun:test'
import { CommandRegistry, type CommandDefinition, type RiskClass } from '../../commands/registry.ts'
import { COMMAND_CATALOGUE, registerCommandCatalogue } from '../../commands/catalogue/index.ts'
import { createCommandEnvelope } from '../../commands/envelope.ts'
import { LOCAL_OWNER_AUTHORIZER } from '../../commands/authorizer.ts'
import type { Authorizer } from '../../commands/authorizer.ts'
import {
  AGENT_PERMISSION_MODES,
  APPROVAL_MODES,
  POLICY_MODES_BY_PERMISSION_MODE,
  RULE_ALL_SUBJECT,
  AGGREGATE_SCOPE,
  approvalPolicyForPermissionMode,
  agentRateLimitSubject,
  type AgentBinding,
  type AgentGrant,
  type AgentPermissionMode,
  type AgentScope,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalPolicyRule,
  type ApprovalRequest,
  type RateLimitDecision,
  type RateLimitSpend,
  strictestApprovalMode,
  type StandingApproval,
  type WorkspaceFloor,
} from '../governance.ts'
import {
  POLICY_STEPS,
  evaluatePolicy,
  type PolicyPorts,
  type PolicyRequest,
  type RateLimitPort,
} from '../policy.ts'
import { AGENT_SCOPES, COMMAND_RISK, COMMAND_SCOPES, DELETE_SCOPE, RISK_CLASSES, riskClassFor, scopeForCommand } from '../risk.ts'

const WORKSPACE = 'ws-1'
const OWNER = 'owner-1'
const AGENT = 'agent-1'

const registry = new CommandRegistry()
registerCommandCatalogue(registry)

function definitionOf(type: string): CommandDefinition<unknown> {
  const definition = registry.get(type)
  if (!definition) throw new Error(`Unknown command in catalogue: ${type}`)
  return definition
}

/** Real catalogue commands, one per (scope, risk) pair the spec defines. */
const MATRIX_COMMANDS = [
  'tasks.create',
  'tasks.update',
  'tasks.update_assignees',
  'tasks.delete',
  'drive.create_folder',
  'docs.create_document',
  'docs.set_public_sharing',
  'im.send_message',
  'im.create_chat',
  'im.set_visibility',
  'calendar.create_event',
  'vc.start_meeting',
  'goals.create_check_in',
  'goals.delete',
  'people.invite',
  'agents.pause',
  'agents.decide_approval',
] as const

/** Payloads that exercise both branches of the payload-dependent classifiers. */
const RISK_PAYLOADS: readonly unknown[] = [
  {},
  { assignees: [{ id: 'p2' }] },
  { visibility: 'public' },
  { visibility: 'private' },
  { members: [{ id: 'p2' }] },
  { attendees: [{ id: 'p2' }] },
  { participants: [{ id: 'p2' }] },
  undefined,
]

interface HarnessOptions {
  status?: AgentBinding['status']
  pauseAll?: boolean
  grants?: readonly AgentGrant[]
  authorize?: Authorizer
  policy?: ApprovalPolicy
  standing?: readonly StandingApproval[]
  rateLimit?: (spend: RateLimitSpend) => RateLimitDecision
}

interface Harness {
  ports: PolicyPorts & RateLimitPort
  parked: ApprovalRequest[]
}

function harness(options: HarnessOptions = {}): Harness {
  const parked: ApprovalRequest[] = []
  const binding: AgentBinding = {
    agentPrincipalId: AGENT,
    workspaceId: WORKSPACE,
    ownerPrincipalId: OWNER,
    handle: 'rox',
    displayName: 'Rox',
    runtime: 'omp',
    status: options.status ?? 'active',
  }
  const grants: AgentGrant[] = [...(options.grants ?? allScopeGrants())]
  return {
    parked,
    ports: {
      async agentBinding() { return binding },
      async pauseAllAgents() { return options.pauseAll === true },
      async grants() { return grants },
      authorizer: options.authorize ?? LOCAL_OWNER_AUTHORIZER,
      async approvalPolicy() { return options.policy ?? approvalPolicyForPermissionMode(OWNER, 'ask') },
      async standingApprovals() { return options.standing ?? [] },
      rateLimit: async spend => (options.rateLimit ? options.rateLimit(spend) : { allowed: true }),
      async park(request) { parked.push(request) },
    },
  }
}

/**
 * One grant per scope of DATA-MODEL §5.14, so step 3 passes unless a row says
 * otherwise. `im:send_owner_dm` is in the list because `im.send_message`
 * resolves to it when the caller flags the owner's DM.
 */
function allScopeGrants(): AgentGrant[] {
  const scopes: AgentScope[] = [...new Set([...AGENT_SCOPES, ...Object.values(COMMAND_SCOPES)])]
  if (!scopes.includes(DELETE_SCOPE)) scopes.push(DELETE_SCOPE)
  return scopes.map((scope, index) => ({
    agentGrantId: `grant-${index}`,
    workspaceId: WORKSPACE,
    agentPrincipalId: AGENT,
    scope,
    selector: {},
    grantedBy: OWNER,
  }))
}

function request(type: string, payload: unknown, permissionMode: AgentPermissionMode = 'ask'): PolicyRequest {
  const definition = definitionOf(type)
  return {
    workspaceId: WORKSPACE,
    envelope: createCommandEnvelope(definition.type, payload, { onBehalfOf: AGENT }),
    payload,
    definition,
    actor: { principalId: OWNER, kind: 'user' },
    permissionMode,
  }
}

/** The scope the command requires, or `null` when it is not agent-reachable at all. */
function scopeOf(type: string): AgentScope | null {
  return scopeForCommand(type, { verb: definitionOf(type).verb })
}

function riskOf(type: string, payload: unknown): RiskClass {
  return definitionOf(type).riskClass(payload, { workspaceId: WORKSPACE, actor: { principalId: OWNER, kind: 'user' } })
}

/**
 * `auto` unless the owner's mode or the floor says otherwise (§13.2 step 7):
 * the scope+risk rule first, then the permission-mode default, then the admin
 * floor, which can only ever make the decision stricter.
 */
function expectedMode(permissionMode: AgentPermissionMode, risk: RiskClass, floor: ApprovalMode): ApprovalMode {
  const base = POLICY_MODES_BY_PERMISSION_MODE[permissionMode][risk]
  return strictestApprovalMode(base, floor)
}

describe('policy matrix: scope × risk × mode × standing × floor', () => {
  for (const type of MATRIX_COMMANDS) {
    for (const payload of RISK_PAYLOADS) {
      const resolvedScope = scopeOf(type)
      if (!resolvedScope) {
        // Not agent-reachable: the pipeline must stop at step 3 whatever the
        // owner's mode, floor or standing approvals say.
        for (const permissionMode of AGENT_PERMISSION_MODES) {
          for (const floor of APPROVAL_MODES) {
            it(`${type} scope=none risk=${riskOf(type, payload)} mode=${permissionMode} floor=${floor} is not agent-reachable`, async () => {
              const base = approvalPolicyForPermissionMode(OWNER, permissionMode)
              const h = harness({ policy: { ...base, workspaceFloor: {} }, standing: [] })
              const result = await evaluatePolicy(request(type, payload, permissionMode), h.ports)
              expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'not_agent_reachable', step: 'scope' })
              expect(result.trace).toEqual(['kill_switch', 'authn', 'scope'])
              expect(h.parked.length).toBe(0)
            })
          }
        }
        continue
      }
      const scope: AgentScope = resolvedScope
      const risk = riskOf(type, payload)
      for (const permissionMode of AGENT_PERMISSION_MODES) {
        for (const floor of APPROVAL_MODES) {
          for (const standing of ['none', 'matching', 'expired'] as const) {
            const label = `${type} scope=${scope} risk=${risk} mode=${permissionMode} floor=${floor} standing=${standing}`
            it(label, async () => {
              const base = approvalPolicyForPermissionMode(OWNER, permissionMode)
              const policy: ApprovalPolicy = { ...base, workspaceFloor: { [scope]: floor } as WorkspaceFloor }
              const now = new Date('2026-10-08T12:00:00.000Z')
              const standingRows: StandingApproval[] = standing === 'none' ? [] : [{
                standingApprovalId: 'standing-1',
                workspaceId: WORKSPACE,
                agentPrincipalId: AGENT,
                scope,
                selector: {},
                createdBy: OWNER,
                expiresAt: standing === 'expired' ? '2026-10-07T12:00:00.000Z' : '2026-11-07T12:00:00.000Z',
              }]
              const h = harness({ policy, standing: standingRows })
              const result = await evaluatePolicy({ ...request(type, payload, permissionMode), now }, h.ports)
              const decision = result.decision

              const mode = expectedMode(permissionMode, risk, floor)
              const liveStanding = standing === 'matching'
              if (floor === 'deny') {
                expect(decision.outcome, label).toBe('deny')
                return
              }
              if (mode === 'ask' && liveStanding && risk !== 'privileged') {
                // §13.3: a standing approval turns `ask` into `auto`… except for privileged.
                expect(decision.outcome, label).toBe('auto')
                expect(h.parked.length, label).toBe(0)
                expect(result.trace, label).toEqual([...POLICY_STEPS].slice(0, 9))
                return
              }
              if (mode === 'ask') {
                expect(decision.outcome, label).toBe('ask')
                expect(h.parked.length, label).toBe(1)
                expect(h.parked[0]?.riskClass, label).toBe(risk)
                expect(h.parked[0]?.status, label).toBe('pending')
                // The parked request carries the full envelope (§13.3).
                expect(h.parked[0]?.command, label).toMatchObject({ onBehalfOf: AGENT })
                if (decision.outcome !== 'ask') throw new Error(label)
                expect(decision.approvalRequest.approvalRequestId).toBe(h.parked[0]?.approvalRequestId ?? '')
                return
              }
              expect(decision.outcome, label).toBe('auto')
              expect(h.parked.length, label).toBe(0)
              // The whole ten-step trace, minus the audit step the middleware appends.
              expect(result.trace, label).toEqual([...POLICY_STEPS].slice(0, 9))
            })
          }
        }
      }
    }
  }

  it('the matrix covers every risk class and the scopes the spec names', () => {
    const seen = new Set<string>()
    for (const type of MATRIX_COMMANDS) {
      for (const payload of RISK_PAYLOADS) seen.add(`${scopeOf(type) ?? 'none'}|${riskOf(type, payload)}`)
    }
    const risks = new Set([...seen].map(key => key.split('|')[1]))
    expect([...risks].sort()).toEqual([...RISK_CLASSES].sort())
    for (const scope of ['tasks:create', 'tasks:assign_others', 'docs:share', 'im:send_chat', 'im:create_group', 'people:invite', 'vc:start', '*:delete']) {
      expect([...seen].some(key => key.startsWith(`${scope}|`)), scope).toBe(true)
    }
    // The catalogue's own table is what the matrix reads; keep them tied together.
    expect(Object.keys(COMMAND_RISK).length).toBeGreaterThan(150)
    expect(riskClassFor('people.invite', 'contacts', 'share')({}, { workspaceId: WORKSPACE, actor: { principalId: OWNER, kind: 'user' } })).toBe('privileged')
  })
})

describe('policy negatives (PLAN §1.4)', () => {
  it('a paused agent is denied at the kill switch', async () => {
    const h = harness({ status: 'paused' })
    const result = await evaluatePolicy(request('tasks.create', {}), h.ports)
    expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'agent_paused', step: 'kill_switch' })
    expect(result.trace).toEqual([])
  })

  it('a revoked agent is denied, and so is a workspace-wide pause', async () => {
    const revoked = await evaluatePolicy(request('tasks.create', {}), harness({ status: 'revoked' }).ports)
    expect(revoked.decision).toMatchObject({ outcome: 'deny', reason: 'agent_revoked' })
    const paused = await evaluatePolicy(request('tasks.create', {}), harness({ pauseAll: true }).ports)
    expect(paused.decision).toMatchObject({ outcome: 'deny', reason: 'all_agents_paused' })
  })

  it('a command outside the agent scopes is denied at step 3', async () => {
    const h = harness({ grants: [{ agentGrantId: 'g1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'tasks:create', selector: {}, grantedBy: OWNER }] })
    const result = await evaluatePolicy(request('people.invite', { emails: ['a@example.com'] }), h.ports)
    expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'scope_not_granted', step: 'scope' })
    expect(result.trace).toEqual(['kill_switch', 'authn', 'scope'])
  })

  it('a grant with a container selector does not cover another container', async () => {
    const h = harness({
      grants: [{ agentGrantId: 'g1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'tasks:create', selector: { container: 'task-list:mine' }, grantedBy: OWNER }],
    })
    const mine = await evaluatePolicy({ ...request('tasks.create', {}), container: 'task-list:mine' }, h.ports)
    expect(mine.decision.outcome).toBe('auto')
    const other = await evaluatePolicy({ ...request('tasks.create', {}), container: 'task-list:other' }, h.ports)
    expect(other.decision).toMatchObject({ outcome: 'deny', reason: 'scope_not_granted' })
  })

  it('an ACL denial stops the pipeline after step 4', async () => {
    const denyAll: Authorizer = { async can() { return false } }
    const result = await evaluatePolicy(request('tasks.create', {}), harness({ authorize: denyAll }).ports)
    expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'acl_denied', step: 'acl' })
    expect(result.trace).toEqual(['kill_switch', 'authn', 'scope', 'acl'])
  })

  it('an exhaustive bucket returns RATE_LIMITED with retryAfter, before any approval', async () => {
    const h = harness({
      rateLimit: spend => spend.scope === AGGREGATE_SCOPE
        ? { allowed: false, window: 'hour', retryAfter: 42 }
        : { allowed: true },
    })
    const result = await evaluatePolicy(request('im.send_message', { chatKind: 'p2p' }), h.ports)
    expect(result.decision).toMatchObject({ outcome: 'rate_limited', bucketScope: AGGREGATE_SCOPE, window: 'hour', retryAfter: 42 })
    expect(result.trace).toEqual(['kill_switch', 'authn', 'scope', 'acl', 'risk_class', 'rate_limit'])
    expect(h.parked.length).toBe(0)
  })

  it('the aggregate bucket is spent after the scope bucket, and both keys are per agent', async () => {
    const spent: RateLimitSpend[] = []
    const h = harness({ rateLimit: spend => { spent.push(spend); return { allowed: true } } })
    await evaluatePolicy({ ...request('im.send_message', { chatKind: 'p2p' }), ownerDm: true }, h.ports)
    expect(spent.map(spend => spend.scope)).toEqual(['im:send_owner_dm', AGGREGATE_SCOPE])
    expect(spent[0]?.subject).toBe(agentRateLimitSubject(AGENT))
    expect(spent[0]?.subject).not.toBe(RULE_ALL_SUBJECT)
  })

  it('an expired standing approval does not turn ask into auto', async () => {
    const scope = scopeOf('im.send_message') as AgentScope
    const h = harness({
      standing: [{
        standingApprovalId: 's1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope, selector: {}, createdBy: OWNER,
        expiresAt: '2026-01-01T00:00:00.000Z',
      }],
    })
    const result = await evaluatePolicy({ ...request('im.send_message', { chatKind: 'group' }), now: new Date('2026-10-08T12:00:00.000Z') }, h.ports)
    expect(result.decision.outcome).toBe('ask')
  })

  it('privileged + a matching standing approval still asks, never auto (§13.3)', async () => {
    const scope = scopeOf('people.invite') as AgentScope
    const h = harness({
      standing: [{
        standingApprovalId: 's1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope, selector: {}, createdBy: OWNER,
        expiresAt: '2026-12-01T00:00:00.000Z',
      }],
    })
    const result = await evaluatePolicy(request('people.invite', { emails: ['a@example.com'] }), h.ports)
    expect(result.decision).toMatchObject({ outcome: 'ask', riskClass: 'privileged' })
    expect(h.parked.length).toBe(1)
  })

  it('an approval-request decision is not agent-reachable, so an agent never decides its own approvals', async () => {
    const scope = scopeOf('agents.decide_approval')
    expect(scope).toBeNull()
    const h = harness({
      standing: [{
        standingApprovalId: 's1', workspaceId: WORKSPACE, agentPrincipalId: AGENT, scope: 'people:invite', selector: {}, createdBy: OWNER,
        expiresAt: '2026-12-01T00:00:00.000Z',
      }],
    })
    const result = await evaluatePolicy(request('agents.decide_approval', { approvalRequestId: 'a1' }), h.ports)
    expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'not_agent_reachable' })
  })

  it('an actor that is not the agent owner fails authN', async () => {
    const h = harness({ grants: allScopeGrants() })
    const envelope = createCommandEnvelope('tasks.create', {}, { onBehalfOf: AGENT })
    const result = await evaluatePolicy({
      workspaceId: WORKSPACE,
      envelope,
      payload: {},
      definition: definitionOf('tasks.create'),
      actor: { principalId: 'someone-else', kind: 'user' },
      permissionMode: 'ask',
    }, h.ports)
    expect(result.decision).toMatchObject({ outcome: 'deny', reason: 'authn_failed', step: 'authn' })
  })

  it('a rule subject policy keeps its own mode rows apart from the agent defaults', () => {
    const policy: ApprovalPolicyRule[] = [...approvalPolicyForPermissionMode(OWNER, 'ask').rules]
    expect(policy.every(rule => rule.scope === DELETE_SCOPE)).toBe(true)
    expect(APPROVAL_MODES).toEqual(['auto', 'ask', 'deny'])
  })

  it('the catalogue stays the single source of risk classes for the matrix', () => {
    const missing = COMMAND_CATALOGUE.filter(definition => typeof definition.riskClass !== 'function').map(definition => definition.type)
    expect(missing).toEqual([])
  })
})