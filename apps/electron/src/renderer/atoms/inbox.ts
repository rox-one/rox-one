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

export type InboxSignalFilter = 'all' | 'signal' | 'noise'

/** Only presentation preferences persist; query text and selected message IDs stay transient. */
export interface InboxPreferences {
  signalFilter: InboxSignalFilter
  unreadOnly: boolean
}

export const DEFAULT_INBOX_PREFERENCES: InboxPreferences = {
  signalFilter: 'all',
  unreadOnly: false,
}

export const inboxPreferencesAtom = atomWithStorage<InboxPreferences>(
  'inbox-view-preferences-v1',
  DEFAULT_INBOX_PREFERENCES,
  undefined,
  { getOnInit: true },
)
