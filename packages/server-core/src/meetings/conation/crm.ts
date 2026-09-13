/**
 * RMA-I025 / #381 leftover — CRM. DisplayName is not a unique key.
 * Live mutations stay BLOCKED until AUD #333. SoupCompany ≠ contact/deal
 * mutation. Live CRM mutate/send stay blocked (evidence U1; L4 NOT_RUN).
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, type MeetingOpResult } from '../types.ts'

export type CrmTarget = {
  readonly accountId: string
  readonly remoteType: 'company' | 'contact' | 'deal'
  readonly remoteId: string
  readonly displayName: string
}

export function resolveCrmTarget(
  candidates: readonly CrmTarget[],
  wanted: { readonly accountId: string; readonly remoteType: CrmTarget['remoteType']; readonly remoteId: string },
): CrmTarget | undefined {
  return candidates.find(
    (row) =>
      row.accountId === wanted.accountId
      && row.remoteType === wanted.remoteType
      && row.remoteId === wanted.remoteId,
  )
}

export function proposeCrmEdit(
  target: CrmTarget | undefined,
  options: {
    readonly dealCapability: boolean
    readonly relatedSourceDenied?: boolean
    readonly baseRevision: string
    readonly currentRevision: string
  },
): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupCrmCompany',
    operation: 'edit',
    authPresent: true,
  })
  if (!write.allowed) return blocked('crm-conation-unconfirmed')
  if (!target) return denied('unresolved-target')
  if (options.relatedSourceDenied) return denied('related-source-denied')
  if (target.remoteType === 'deal' && !options.dealCapability) return blocked('missing-deal-capability')
  if (options.baseRevision !== options.currentRevision) {
    return { status: 'conflict', reason: 'concurrent-update', live: false, evidenceLevel: 'U1' }
  }
  return blocked('crm-edit-not-live')
}

export function sendCrm(_target: CrmTarget): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupCrmCompany',
    operation: 'send',
    authPresent: true,
  })
  if (!write.allowed) return blocked('crm-conation-unconfirmed')
  return blocked('crm-send-not-live')
}
