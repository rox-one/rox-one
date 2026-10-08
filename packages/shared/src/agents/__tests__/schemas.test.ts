/**
 * W1-11 (#1508) — Agent-governance schemas and rows (TECH-SPEC §13, DATA-MODEL
 * §5.12–§5.14). The rows here are the shapes the stores hand back, so the
 * schemas double as a store contract check.
 */

import { describe, expect, it } from 'bun:test'
import { COMMAND_CATALOGUE } from '@rox/core/commands'
import {
  AGENT_PAYLOAD_SCHEMAS,
  agentBindingSchema,
  agentGrantSchema,
  agentScopeSchema,
  approvalPolicySchema,
  approvalRequestSchema,
  decideApprovalSchema,
  pauseAgentSchema,
  rateLimitBucketSchema,
  riskClassSchema,
  standingApprovalSchema,
  provisionPersonalAgentSchema,
  agentInvokeSchema,
} from '../schemas.ts'

const ISO = '2026-10-08T12:00:00.000Z'

describe('vocabularies', () => {
  it('accepts exactly the risk classes and the scopes of DATA-MODEL §5.14', () => {
    for (const risk of ['routine', 'consequential', 'privileged']) expect(riskClassSchema.safeParse(risk).success).toBe(true)
    expect(riskClassSchema.safeParse('dangerous').success).toBe(false)
    for (const scope of ['tasks:create', 'im:send_chat', 'people:invite', '*:delete']) expect(agentScopeSchema.safeParse(scope).success).toBe(true)
    expect(agentScopeSchema.safeParse('tasks:everything').success).toBe(false)
  })
})

describe('governance rows', () => {
  it('validates an agent binding and rejects an unknown status', () => {
    const binding = { agentPrincipalId: 'agent-1', workspaceId: 'w1', ownerPrincipalId: 'owner-1', handle: 'rox', displayName: 'Rox', runtime: 'omp' as const, status: 'active' as const, dmChatId: 'chat-dm' }
    expect(agentBindingSchema.safeParse(binding).success).toBe(true)
    expect(agentBindingSchema.safeParse({ ...binding, status: 'disabled' }).success).toBe(false)
    expect(agentBindingSchema.safeParse({ ...binding, runtime: 'claude' }).success).toBe(false)
    expect(agentBindingSchema.safeParse({ ...binding, displayHandle: 'rox-maria' }).success).toBe(true)
  })

  it('validates a grant with its container / kind selector', () => {
    const grant = {
      agentGrantId: 'g1', workspaceId: 'w1', agentPrincipalId: 'agent-1', scope: 'tasks:create' as const,
      selector: { container: 'task-list:mine', kinds: ['task'] }, grantedBy: 'owner-1', expiresAt: null,
    }
    expect(agentGrantSchema.safeParse(grant).success).toBe(true)
    expect(agentGrantSchema.safeParse({ ...grant, scope: 'nope' }).success).toBe(false)
    expect(agentGrantSchema.safeParse({ ...grant, expiresAt: 'yesterday' }).success).toBe(false)
  })

  it('validates an approval policy with its admin floor', () => {
    const policy = {
      ownerPrincipalId: 'owner-1',
      rules: [{ scope: 'people:invite' as const, riskClass: 'privileged' as const, mode: 'deny' as const }],
      workspaceFloor: { 'people:invite': 'ask' as const },
      revision: 1,
    }
    expect(approvalPolicySchema.safeParse(policy).success).toBe(true)
    expect(approvalPolicySchema.safeParse({ ...policy, rules: [{ scope: 'x', riskClass: 'routine', mode: 'auto' }] }).success).toBe(false)
    expect(approvalPolicySchema.safeParse({ ...policy, rules: [{ scope: 'tasks:create', riskClass: 'routine', mode: 'maybe' }] }).success).toBe(false)
    expect(approvalPolicySchema.safeParse({ ...policy, workspaceFloor: { 'people:invite': 'sometimes' } }).success).toBe(false)
  })

  it('validates an approval request and its remember block', () => {
    const request = {
      approvalRequestId: 'a1', workspaceId: 'w1', agentPrincipalId: 'agent-1', ownerPrincipalId: 'owner-1',
      command: { type: 'im.create_chat' }, riskClass: 'consequential' as const,
      summary: 'agentGovernance.approval.summary.im.create_chat', preview: { commandType: 'im.create_chat' },
      status: 'pending' as const, createdAt: ISO, expiresAt: ISO,
      remember: { standing: true as const, container: 'channel:1', until: ISO },
    }
    expect(approvalRequestSchema.safeParse(request).success).toBe(true)
    expect(approvalRequestSchema.safeParse({ ...request, status: 'cancelled' }).success).toBe(false)
    expect(approvalRequestSchema.safeParse({ ...request, remember: { standing: false } }).success).toBe(false)
  })

  it('validates a standing approval and a rate-limit bucket', () => {
    const standing = { standingApprovalId: 's1', workspaceId: 'w1', agentPrincipalId: 'agent-1', scope: 'im:send_chat' as const, selector: { container: 'channel:1' }, createdBy: 'owner-1', expiresAt: ISO }
    expect(standingApprovalSchema.safeParse(standing).success).toBe(true)
    expect(standingApprovalSchema.safeParse({ ...standing, scope: 'im:*' }).success).toBe(false)
    expect(rateLimitBucketSchema.safeParse({ subject: 'agent:*', scope: '*', perMinute: 60, perHour: 600, perDay: 5000 }).success).toBe(true)
    expect(rateLimitBucketSchema.safeParse({ subject: 'agent:*', scope: '*', perMinute: null, perHour: null, perDay: null }).success).toBe(true)
    expect(rateLimitBucketSchema.safeParse({ subject: 'agent:*', scope: '*', perMinute: 0, perHour: null, perDay: null }).success).toBe(false)
  })
})

describe('command payloads', () => {
  it('provisioning, invocation, decision and pause payloads validate', () => {
    expect(provisionPersonalAgentSchema.safeParse({ workspaceId: 'w1', ownerPrincipalId: 'owner-1', username: 'maria' }).success).toBe(true)
    expect(provisionPersonalAgentSchema.safeParse({ workspaceId: 'w1' }).success).toBe(false)
    expect(agentInvokeSchema.safeParse({ workspaceId: 'w1', agentPrincipalId: 'agent-1', ownerPrincipalId: 'owner-1', instruction: 'создай задачу', provenance: { trigger: 'mention', messageRef: 'channel:1#42' } }).success).toBe(true)
    expect(agentInvokeSchema.safeParse({ workspaceId: 'w1', agentPrincipalId: 'agent-1', ownerPrincipalId: 'owner-1', instruction: 'x', provenance: { trigger: 'guess' } }).success).toBe(false)
    expect(decideApprovalSchema.safeParse({ approvalRequestId: 'a1', decision: 'approve', remember: { standing: true, container: 'channel:1' } }).success).toBe(true)
    expect(decideApprovalSchema.safeParse({ approvalRequestId: 'a1', decision: 'maybe' }).success).toBe(false)
    expect(pauseAgentSchema.safeParse({ agentPrincipalId: 'agent-1', paused: true }).success).toBe(true)
    expect(pauseAgentSchema.safeParse({ agentPrincipalId: 'agent-1' }).success).toBe(false)
  })

  it('every agents command of the catalogue has a schema', () => {
    const catalogueTypes = new Set<string>(COMMAND_CATALOGUE.map(definition => definition.type as string))
    for (const type of Object.keys(AGENT_PAYLOAD_SCHEMAS)) expect(catalogueTypes.has(type), type).toBe(true)
    expect(Object.keys(AGENT_PAYLOAD_SCHEMAS).sort()).toEqual([
      'agents.decide_approval', 'agents.invoke', 'agents.pause', 'agents.provision_personal_agent',
    ])
  })
})