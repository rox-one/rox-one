/**
 * RMA-I024 / #380 — Mail/Channels. Live send is BLOCKED until AUD #333.
 * Draft/edit/approve/send are separate. Changed recipient requires a new approval.
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, unknownEffect, type MeetingOpResult } from '../types.ts'

export type MailDraft = {
  readonly id: string
  readonly threadId: string
  readonly channelId?: string
  readonly to: readonly string[]
  readonly approvedTo: readonly string[]
  readonly attachments: readonly string[]
  readonly approvedAttachments: readonly string[]
  readonly includesPrivateNote: boolean
  readonly grantExpired?: boolean
}

export function sendMail(draft: MailDraft, replayKey: string, seen: Set<string>): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupEmailThread',
    operation: 'send',
    authPresent: true,
  })
  if (!write.allowed) return blocked('mail-conation-unconfirmed')
  if (draft.grantExpired) return denied('revoked-grant')
  if (draft.includesPrivateNote) return denied('private-attachment')
  if (draft.to.join() !== draft.approvedTo.join()) return denied('changed-recipient')
  if (draft.attachments.join() !== draft.approvedAttachments.join()) return denied('changed-attachment')
  if (seen.has(replayKey)) return { status: 'duplicate', reason: 'duplicate-callback', live: false, evidenceLevel: 'U1' }
  return unknownEffect('send-unknown')
}

export function postChannel(draft: MailDraft): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupChannel',
    operation: 'send',
    authPresent: true,
  })
  if (!write.allowed) return blocked('channel-conation-unconfirmed')
  return denied('not-implemented')
}
