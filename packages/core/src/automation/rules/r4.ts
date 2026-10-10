/**
 * W1-12 (#1509) — R4: team invites → placeholders in the team chat
 * (DATA-MODEL §5.16, TECH-SPEC §15.1/§15.2; D-v2-2, D-v2-10).
 *
 * Fires on `people.invitations_sent` (from `workspaces.create` with emails, or
 * the Invite dialog). One execution per email — the idempotency key is
 * `R4:{workspace}:{email}` — so re-running an invite never creates a second
 * placeholder. When the invitee later activates, R2 fires (activation).
 */

import type { DomainEvent } from '../../events/types.ts'
import { invitationsSentOf } from '../events.ts'
import type { DomainRule, RuleStep, RuleTarget } from '../rule.ts'

export interface R4Params {
  /** Role the placeholder is added with (default `member`). */
  role: 'owner' | 'admin' | 'member'
}

export const R4_DEFAULT_PARAMS: R4Params = { role: 'member' }

export function readR4Params(params: Readonly<Record<string, unknown>> = {}): R4Params {
  const role = params.role
  return { role: role === 'owner' || role === 'admin' || role === 'member' ? role : R4_DEFAULT_PARAMS.role }
}

export function invitationCommandId(workspaceId: string, email: string): string {
  return `R4-invite:${workspaceId}:${email.toLowerCase()}`
}

export function r4Key(workspaceId: string, email: string): string {
  return `R4:${workspaceId}:${email.toLowerCase()}`
}

export const R4: DomainRule = {
  id: 'R4',
  triggers: ['people.invitations_sent'],
  scope: 'workspace',

  async targets(_ctx, event) {
    const payload = invitationsSentOf(event)
    const inviter = payload.invitedBy ?? payload.invitations[0]?.principalId
    const targets: RuleTarget[] = []
    for (const invitation of payload.invitations) {
      if (!invitation.email) continue
      targets.push({ subject: inviter ?? 'workspace', token: invitation.email.toLowerCase() })
    }
    return targets
  },

  async enabled(ctx) {
    return (await ctx.settings('R4')).enabled
  },

  async conditions(_ctx, event) {
    const payload = invitationsSentOf(event)
    return payload.invitations.length > 0 ? null : 'unknown_event'
  },

  key(ctx) {
    return r4Key(ctx.workspaceId, ctx.token ?? '')
  },

  async steps(ctx, event) {
    const email = ctx.token
    if (!email) return []
    const invitation = invitationsSentOf(event).invitations.find(entry => entry.email.toLowerCase() === email)
    if (!invitation) return []
    const params = readR4Params(await ctx.params('R4'))
    const chatId = (await ctx.generalChatId()) ?? undefined
    const role = invitation.role ?? params.role

    // W1-11 (#1508) owns `identity.ensure_placeholder`: the handler mints the
    // placeholder principal id itself and, from `chatIds`, owns its membership
    // row and chat memberships. The rule cannot name that id in later steps
    // (the plan is static), so the placeholder / member / team-chat work is
    // carried by this one command instead of separate
    // `people.add_workspace_member` / `im.add_members` steps.
    const steps: RuleStep[] = [
      {
        name: 'ensure-placeholder',
        actor: 'system',
        command: {
          type: 'identity.ensure_placeholder',
          payload: {
            workspaceId: ctx.workspaceId,
            email,
            invitedBy: ctx.subject,
            role,
            ...(chatId ? { chatIds: [chatId] } : {}),
          },
        },
      },
    ]
    steps.push({
      name: 'send-invite-email',
      actor: 'system',
      commandId: invitationCommandId(ctx.workspaceId, email),
      optional: true,
      command: {
        type: 'notify.send_invite_email',
        // `principalId` is omitted: only the handler knows the placeholder id.
        payload: { email, role, workspaceId: ctx.workspaceId },
      },
    })
    return steps
  },
} satisfies DomainRule<DomainEvent>