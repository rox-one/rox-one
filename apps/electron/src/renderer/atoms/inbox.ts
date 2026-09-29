/** Входящие triage state (done / snoozed ids). Renderer-only; items themselves come from live sources. */
import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { EMPTY_INBOX_STATE, type InboxState } from '@/pages/inbox/inbox-model'

export const inboxStateAtom = atomWithStorage<InboxState>(
  getKeyString(KEYS.inboxState),
  EMPTY_INBOX_STATE,
  undefined,
  { getOnInit: true },
)
