/** Входящие triage state (done / snoozed ids). Renderer-only; items themselves come from live sources. */
import { atomWithStorage } from 'jotai/utils'
import { atom } from 'jotai'
import { KEYS, get, getKeyString } from '@/lib/local-storage'
import { EMPTY_INBOX_STATE, type InboxState } from '@/pages/inbox/inbox-model'

export const inboxStateAtom = atomWithStorage<InboxState>(
  getKeyString(KEYS.inboxState),
  EMPTY_INBOX_STATE,
  undefined,
  { getOnInit: true },
)

const workspaceStates = new Map<string, typeof inboxStateAtom>()
const unknownActorState = atom<InboxState>(EMPTY_INBOX_STATE)

/** Migrate matching legacy entries without allowing another workspace's pruning to erase them. */
export function inboxStateForWorkspace(workspaceId: string | null, actorKey?: string | null) {
  if (actorKey === null) return unknownActorState
  if (!workspaceId) return inboxStateAtom
  const storageScope = actorKey && actorKey !== 'legacy' ? JSON.stringify([workspaceId, actorKey]) : workspaceId
  let existing = workspaceStates.get(storageScope)
  if (existing) return existing
  let legacy: InboxState = EMPTY_INBOX_STATE
  try {
    const raw = actorKey && actorKey !== 'legacy' ? EMPTY_INBOX_STATE : get<unknown>(KEYS.inboxState, EMPTY_INBOX_STATE)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>
      const timestamps = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) : {}
      legacy = { done: timestamps(record.done), snoozed: timestamps(record.snoozed) }
    }
  } catch { /* SSR and unavailable storage start with an empty queue state. */ }
  existing = atomWithStorage<InboxState>(getKeyString(KEYS.inboxState, storageScope), legacy, undefined, { getOnInit: true })
  workspaceStates.set(storageScope, existing)
  return existing
}

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
