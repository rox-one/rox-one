/**
 * W1-12 (#1509) — R2: member joins → General chat + personal agent
 * (DATA-MODEL §5.16; D-v2-2 team = workspace with a General chat).
 *
 * Fires on `people.member_added` (`workspace_member.status → active`, incl.
 * placeholder activation). Step 2 shares its command id with R3 step 1, so a
 * member who joins and signs in produces exactly one personal agent.
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { DomainEvent } from '../../events/types.ts'
import { memberAddedOf } from '../events.ts'
import { personalAgentCommandId, type DomainRule, type RuleStep } from '../rule.ts'

export interface R2Params {
  /** Post the system join card in General (default on). */
  announce: boolean
  /** Join-card copy; `{{name}}` is the member's display name. AUTO localises it. */
  joinCardTemplate: string
}

export const R2_DEFAULT_PARAMS: R2Params = {
  announce: true,
  joinCardTemplate: '{{name}} присоединился(ась) к команде в Rox',
}

export function readR2Params(params: Readonly<Record<string, unknown>> = {}): R2Params {
  return {
    announce: typeof params.announce === 'boolean' ? params.announce : R2_DEFAULT_PARAMS.announce,
    joinCardTemplate: typeof params.joinCardTemplate === 'string' && params.joinCardTemplate
      ? params.joinCardTemplate
      : R2_DEFAULT_PARAMS.joinCardTemplate,
  }
}

/** Render the join card (`{{name}}` → the member's display name). */
export function joinCardText(template: string, name: string): string {
  return template.replaceAll('{{name}}', name)
}

export function r2Key(workspaceId: string, principalId: string): string {
  return `R2:${workspaceId}:${principalId}`
}

export const R2: DomainRule = {
  id: 'R2',
  triggers: ['people.member_added'],
  scope: 'workspace',

  async targets(_ctx, event) {
    const payload = memberAddedOf(event)
    return payload ? [{ subject: payload.principalId }] : []
  },

  async enabled(ctx) {
    return (await ctx.settings('R2')).enabled
  },

  async conditions(ctx, event) {
    const payload = memberAddedOf(event)
    if (!payload) return 'unknown_event'
    if (payload.status === 'invited') return 'not_active_member'
    const chatId = payload.generalChatId ?? (await ctx.generalChatId())
    return chatId ? null : 'no_general_chat'
  },

  key(ctx) {
    return r2Key(ctx.workspaceId, ctx.subject)
  },

  async steps(ctx, event) {
    const payload = memberAddedOf(event)
    if (!payload) return []
    const chatId = payload.generalChatId ?? (await ctx.generalChatId())
    if (!chatId) return []
    const params = readR2Params(await ctx.params('R2'))
    const general: EntityRef = { kind: 'channel', id: chatId }
    const member = ctx.subject
    const name = (await ctx.displayName(member)) ?? member
    const agentId = await ctx.personalAgent(member)

    const steps: RuleStep[] = [
      {
        name: 'join-general-chat',
        actor: 'system',
        command: { type: 'im.add_members', payload: { memberIds: [member] }, target: general },
      },
      {
        name: 'provision-agent',
        actor: 'system',
        // Shared with R3 step 1: one agent per member (same command id → duplicate receipt).
        commandId: personalAgentCommandId(ctx.workspaceId, member),
        command: {
          type: 'agents.provision_personal_agent',
          payload: { ownerId: member, ...(agentId ? { id: agentId } : {}) },
          target: { kind: 'person', id: member },
        },
      },
    ]
    if (params.announce) {
      steps.push({
        name: 'announce-join',
        actor: 'system',
        optional: true,
        command: {
          type: 'im.send_message',
          payload: { content: { doc: joinCardText(params.joinCardTemplate, name) }, attribution: 'unprompted' },
          target: general,
        },
      })
    }
    return steps
  },
} satisfies DomainRule<DomainEvent>