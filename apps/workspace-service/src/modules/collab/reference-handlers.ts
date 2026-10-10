/**
 * W1-14 (#1511) — Collaboration queries in the workspace service
 * (TECH-SPEC §11.7, DATA-MODEL §5.17).
 *
 * Two reads the server answers on demand and the client never caches:
 * "Read by" for a message, and "Viewed by" for a doc. Both need rows the
 * command handlers do not have (a chat's member list, a doc's view rows) plus
 * a rule the rows alone do not carry: the DM privacy switch hides the receipt
 * from **both** sides, and a group above 500 members shows none at all.
 */

import { readBy, type ChatKind, type ChatMemberRead, type DocViewRecord, type DocViewer, type ReadBy, type ReadReceiptPrivacy } from '@rox/core/collab'
import { docViewers } from '@rox/core/collab'

/** Where the rows come from (Postgres in service, the record store in tests). */
export interface CollabQueryPort {
  chatMembers(chatId: string): Promise<readonly ChatMemberRead[]>
  /** `user_pref.share_read_receipts` for the listed principals. */
  readReceiptPrivacy(principalIds: readonly string[]): Promise<readonly ReadReceiptPrivacy[]>
  docViews(docId: string): Promise<readonly DocViewRecord[]>
}

export interface ChatReceipts extends ReadBy {
  /** `false` when either side of a DM turned receipts off: emit nothing. */
  emit: boolean
}

export interface CollabQueries {
  /** "Read by" for message `seq` of a chat, capped at 500 members. */
  readBy(chatId: string, seq: number, kind: ChatKind): Promise<ChatReceipts>
  /** "Viewed by" for a doc, newest first. */
  viewers(docId: string): Promise<DocViewer[]>
}

export function createCollabQueries(port: CollabQueryPort): CollabQueries {
  return {
    async readBy(chatId, seq, kind) {
      const members = await port.chatMembers(chatId)
      const receipts = readBy(members, seq)
      if (!receipts.shown) return { ...receipts, emit: false }
      if (kind !== 'dm') return { ...receipts, emit: true }
      const privacy = await port.readReceiptPrivacy(members.map(member => member.principalId))
      // In a DM both sides must share receipts — that is why this cannot be
      // decided from the reader's row alone (§11.7).
      const emit = privacy.length > 0 && privacy.every(entry => entry.shareReadReceipts)
      return { ...receipts, emit }
    },
    async viewers(docId) {
      return docViewers(await port.docViews(docId))
    },
  }
}