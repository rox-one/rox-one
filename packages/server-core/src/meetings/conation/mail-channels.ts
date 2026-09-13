/**
 * RMA-I024 / #380 — Mail/Channels. Live send is BLOCKED until AUD #333.
 * Draft/edit/approve/send are separate. Changed recipient requires a new approval.
 * UI must present blocked/unavailable (U1). L4 live send is NOT_RUN.
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

export type MailWritePresentation = {
  readonly appearance: 'blocked'
  readonly live: false
  readonly status: 'blocked'
  readonly evidenceLevel: 'U1'
  readonly l4: 'not_run'
}

/** Live Mail Conation is not a product. Constant false — no fake send. */
export function liveMailEnabled(): false {
  return false
}

/** Live Channel post is not a product. Constant false — no fake post. */
export function liveChannelPostEnabled(): false {
  return false
}

/**
 * Map any write result to blocked UI. Even a verified/live payload must not
 * render as sent — L4 mail is not_run.
 */
export function presentMailWrite(_result?: MeetingOpResult): MailWritePresentation {
  return {
    appearance: 'blocked',
    live: false,
    status: 'blocked',
    evidenceLevel: 'U1',
    l4: 'not_run',
  }
}

export function sendMail(draft: MailDraft, replayKey: string, seen: Set<string>): MeetingOpResult {
  if (!liveMailEnabled()) return blocked('mail-conation-unconfirmed')
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
  if (!liveChannelPostEnabled()) return blocked('channel-conation-unconfirmed')
  const write = confirmWrite({
    moduleId: 'GraphqlSoupChannel',
    operation: 'send',
    authPresent: true,
  })
  if (!write.allowed) return blocked('channel-conation-unconfirmed')
  return denied('not-implemented')
}
