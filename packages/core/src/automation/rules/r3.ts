/**
 * W1-12 (#1509) — R3: new account → agent DM + welcome
 * (DATA-MODEL §5.16, TECH-SPEC §17.2 clean-room adaptation; D-v2-9).
 *
 * Fires on `identity.account_created` (first verified sign-in, or local
 * profile creation). Step 1 shares its command id with R2 step 2, so R3 and R2
 * together create exactly one personal agent. The welcome runs **as the agent
 * principal** through the normal `im.send_message` command (ACL + audit), with
 * `attribution:'unprompted'` and `notify:'mentions_only'` (only the new user is
 * mentioned, so nobody else is notified).
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { DomainEvent } from '../../events/types.ts'
import { accountCreatedOf } from '../events.ts'
import { uuidv5 } from '../ids.ts'
import { personalAgentCommandId, type DomainRule, type RuleStep } from '../rule.ts'

export interface R3Params {
  /** Welcome copy; `{{name}}` and `{{handles}}` are interpolated. D-v2-9: only resolvable handles. */
  welcomeTemplate: string
  /** Handles listed in the welcome (the user's own agent, built-in agents, up to 5 teammates). */
  handles: string[]
  /** Locale used to pick the starter-content pack. */
  locale?: string
}

export const R3_DEFAULT_PARAMS: R3Params = {
  welcomeTemplate:
    'Привет, {{name}}! Я — твой личный агент @rox. Помогу с задачами, заметками и встречами: упомяни @rox в любом чате или документе. Рядом в Rox: {{handles}}.',
  handles: ['@rox'],
}

export function readR3Params(params: Readonly<Record<string, unknown>> = {}): R3Params {
  const handles = params.handles
  return {
    welcomeTemplate: typeof params.welcomeTemplate === 'string' && params.welcomeTemplate ? params.welcomeTemplate : R3_DEFAULT_PARAMS.welcomeTemplate,
    handles: Array.isArray(handles) && handles.every(entry => typeof entry === 'string') ? (handles as string[]) : R3_DEFAULT_PARAMS.handles,
    ...(typeof params.locale === 'string' && params.locale ? { locale: params.locale } : {}),
  }
}

/** Deterministic welcome message id (`uuidv5(principal, 'welcome')`, DATA-MODEL §5.16). */
export function welcomeMessageId(principalId: string): string {
  return uuidv5(`welcome:${principalId}`)
}

export function r3Key(principalId: string): string {
  return `R3:${principalId}`
}

/** Render the welcome body (RU/EN copy lives in the workspace params; AUTO edits it). */
export function welcomeText(params: R3Params, name: string): string {
  return params.welcomeTemplate.replaceAll('{{name}}', name).replaceAll('{{handles}}', params.handles.join(', '))
}

export const R3: DomainRule = {
  id: 'R3',
  triggers: ['identity.account_created'],
  scope: 'workspace',

  async targets(_ctx, event) {
    const payload = accountCreatedOf(event)
    return payload ? [{ subject: payload.principalId }] : []
  },

  async enabled(ctx) {
    return (await ctx.settings('R3')).enabled
  },

  async conditions(ctx, event) {
    const payload = accountCreatedOf(event)
    if (!payload) return 'unknown_event'
    if (payload.verified === false) return 'not_active_member'
    const agentId = await ctx.personalAgent(ctx.subject)
    if (!agentId) return 'no_agent'
    if (!(await ctx.directChatRef(ctx.subject, agentId))) return 'no_agent'
    return null
  },

  key(ctx) {
    return r3Key(ctx.subject)
  },

  async steps(ctx, event) {
    const payload = accountCreatedOf(event)
    if (!payload) return []
    const member = ctx.subject
    const params = readR3Params(await ctx.params('R3'))
    const agentId = await ctx.personalAgent(member)
    const name = (await ctx.displayName(member)) ?? member
    if (!agentId) return []

    const memberRef: EntityRef = { kind: 'person', id: member }
    if (!agentId) throw new Error(`R3 needs the personal agent of ${member}`)
    const dmRef = await ctx.directChatRef(member, agentId)
    if (!dmRef) throw new Error(`R3 needs the agent DM chat of ${member}`)

    return [
      {
        name: 'provision-agent',
        actor: 'system',
        commandId: personalAgentCommandId(ctx.workspaceId, member),
        command: { type: 'agents.provision_personal_agent', payload: { ownerId: member, id: agentId }, target: memberRef },
      },
      {
        name: 'open-agent-dm',
        actor: 'system',
        command: { type: 'im.get_or_create_p2p', payload: { peerId: agentId }, target: memberRef },
      },
      {
        name: 'seed-starter-content',
        actor: 'system',
        optional: true,
        command: {
          type: 'onboarding.seed_starter_content',
          payload: { pack: 'welcome', ...(params.locale ? { locale: params.locale } : {}) },
          target: memberRef,
        },
      },
      {
        name: 'send-welcome',
        actor: { agentOf: member },
        command: {
          type: 'im.send_message',
          payload: {
            id: welcomeMessageId(member),
            content: { doc: welcomeText(params, name), mentions: [memberRef] },
            attribution: 'unprompted',
            notify: 'mentions_only',
          },
          target: dmRef,
        },
      },
    ]
  },
} satisfies DomainRule<DomainEvent>