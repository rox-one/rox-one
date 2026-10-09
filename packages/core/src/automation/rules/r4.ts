/**
 * W1-12 (#1509) — R4: team invites → placeholders in the team chat
 * (DATA-MODEL §5.16, TECH-SPEC §15.1/§15.2; D-v2-2, D-v2-10).
 *
 * Fires on `people.invitations_sent` (from `workspaces.create` with emails, or
 * the Invite dialog). One execution per email — the idempotency key is
 * `R4:{workspace}:{email}` — so re-running an invite never creates a second
 * placeholder. When the invitee later activates, R2 fires (activation).
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { DomainEvent } from '../../events/types.ts'
import { invitationsSentOf } from '../events.ts'
import { uuidv5 } from '../ids.ts'
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

/** Deterministic placeholder principal id for one invitation. */
export function placeholderIdFor(workspaceId: string, email: string): string {
  return uuidv5(`placeholder:${workspaceId}:${email.toLowerCase()}`)
}

export function invitationCommandId(workspaceId: string, email: string): string {
  return `R4-invite:${workspaceId}:${email.toLowerCase()}`
}

export function r4Key(workspaceId: string, email: string): string {
  return `R4:${workspaceId}:${email.toLowerCase()}`
}

function emailDisplayName(email: string): string {
  const local = email.slice(0, Math.max(0, email.indexOf('@')))
  return local || email
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
    const placeholderId = invitation.principalId ?? placeholderIdFor(ctx.workspaceId, email)
    const chatId = (await ctx.generalChatId()) ?? undefined

    const steps: RuleStep[] = [
      {
        name: 'ensure-placeholder',
        actor: 'system',
        command: {
          type: 'identity.ensure_placeholder',
          payload: { id: placeholderId, email, displayName: emailDisplayName(email) },
          target: { kind: 'person', id: placeholderId },
        },
      },
      {
        name: 'add-workspace-member',
        actor: 'system',
        command: {
          type: 'people.add_workspace_member',
          payload: { principalId: placeholderId, role: invitation.role ?? params.role, status: 'invited' },
          target: { kind: 'person', id: placeholderId },
        },
      },
    ]
    if (chatId) {
      steps.push({
        name: 'join-team-chat',
        actor: 'system',
        optional: true,
        command: { type: 'im.add_members', payload: { memberIds: [placeholderId] }, target: { kind: 'channel', id: chatId } },
      })
    }
    steps.push({
      name: 'send-invite-email',
      actor: 'system',
      commandId: invitationCommandId(ctx.workspaceId, email),
      optional: true,
      command: {
        type: 'notify.send_invite_email',
        payload: { email, principalId: placeholderId, role: invitation.role ?? params.role, workspaceId: ctx.workspaceId },
        target: { kind: 'person', id: placeholderId },
      },
    })
    return steps
  },
} satisfies DomainRule<DomainEvent>

/** Chat targets of an invitation (D-v2-2: the General chat plus explicit targets). */
export function invitationChatTargets(generalChatId: string | undefined, invitation: { targets?: readonly EntityRef[] }): EntityRef[] {
  const refs = invitation.targets ?? []
  return generalChatId ? [{ kind: 'channel', id: generalChatId }, ...refs] : [...refs]
}