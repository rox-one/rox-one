import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Session } from '../../shared/types'
import { dismissHeaderStatus, pushHeaderStatus, type HeaderStatus, type HeaderStatusAction, type HeaderStatusState } from '../lib/header-status'
import {
  isSuccessfulCompletion,
  latestCompletedTurn,
  reusableProcessFromCompletion,
  type CompletionSignal,
  type ContextualSuggestion,
  type ReusableProcess,
  type SuggestionHistory,
} from '../lib/contextual-suggestions'

export const headerStatusAtom = atom<HeaderStatusState>({ current: null, seen: {} })
export const publishHeaderStatusAtom = atom(null, (get, set, status: HeaderStatus) => {
  set(headerStatusAtom, pushHeaderStatus(get(headerStatusAtom), status))
})
export const dismissHeaderStatusAtom = atom(null, (get, set, id: string) => {
  set(headerStatusAtom, dismissHeaderStatus(get(headerStatusAtom), id))
})

export interface HeaderSuggestion extends ContextualSuggestion {
  ownerId: string
  actions: HeaderStatusAction[]
  onDismiss: () => void
}

export const headerSuggestionAtom = atom<HeaderSuggestion | null>(null)
export const reusableProcessesAtom = atom<Record<string, ReusableProcess>>({})

// Only IDs and timestamps persist: no transcript, draft, or skill content.
export const suggestionHistoryAtom = atomWithStorage<SuggestionHistory>(
  'rox-contextual-suggestions-v1',
  { seen: {}, lastShownAt: 0 },
  undefined,
  { getOnInit: true },
)

/** Called from the existing completion gate, after the session has been updated. */
export const recordSuccessfulCompletionAtom = atom(null, (get, set, input: {
  session: Session
  event: CompletionSignal
  title: string
  notifyInHeader: boolean
  now: number
}) => {
  const { session, event, title, notifyInHeader, now } = input
  if (!isSuccessfulCompletion(event)) return
  const turn = latestCompletedTurn(session)
  if (!turn) return
  const process = reusableProcessFromCompletion(session, event, now)
  if (process) {
    const current = get(reusableProcessesAtom)
    // Replayed completion events must not refresh the age of an old suggestion.
    if (current[session.id]?.id !== process.id) {
      const recent = Object.entries(current).slice(-39)
      set(reusableProcessesAtom, { ...Object.fromEntries(recent), [session.id]: process })
    }
  }
  if (notifyInHeader) {
    set(publishHeaderStatusAtom, {
      id: `complete:${session.workspaceId}:${session.id}:${turn.final.id}`,
      workspaceId: session.workspaceId,
      tone: 'success',
      messageKey: 'headerStatus.completed',
      values: { name: title },
      createdAt: now,
    })
  }
})
