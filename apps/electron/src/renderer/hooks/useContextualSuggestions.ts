import { useEffect, useId, useRef, useState } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { LoadedSkill, Session } from '../../shared/types'
import {
  headerStatusAtom,
  headerSuggestionAtom,
  publishHeaderStatusAtom,
  reusableProcessesAtom,
  suggestionHistoryAtom,
} from '../atoms/header-status'
import {
  addSkillToDraft,
  canOfferSuggestion,
  rememberSuggestion,
  selectContextualSuggestion,
  SUGGESTION_IDLE_MS,
} from '../lib/contextual-suggestions'
import { headerStatusForWorkspace } from '../lib/header-status'

interface ContextualSuggestionsOptions {
  session: Session | null
  skills: LoadedSkill[]
  draft: string
  active: boolean
  hasPendingRequest: boolean
  onDraftChange: (draft: string) => void
  onOpenWorkflow: () => void
}

function canUseHeaderSuggestion(): boolean {
  return document.visibilityState !== 'hidden'
    && !document.querySelector('[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])')
}

/**
 * The focused chat supplies its live context. Showing a suggestion performs no
 * RPC, file save, send, or focus change. Its buttons use the existing draft/map paths.
 */
export function useContextualSuggestions(options: ContextualSuggestionsOptions): void {
  const { t } = useTranslation()
  const store = useStore()
  const ownerId = useId()
  const processes = useAtomValue(reusableProcessesAtom)
  const headerStatus = useAtomValue(headerStatusAtom).current
  const status = headerStatusForWorkspace(headerStatus, options.session?.workspaceId)
  const process = options.session ? processes[options.session.id] : undefined
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const latest = useRef(options)
  latest.current = options
  // An offered action can be hidden during typing and restored after the pause;
  // dismissing it clears this ref and persisted history prevents another nudge.
  const offeredId = useRef<string | null>(null)
  const sessionId = options.session?.id

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  useEffect(() => {
    offeredId.current = null
  }, [sessionId])

  useEffect(() => {
    const clearOwnedSuggestion = () => {
      if (store.get(headerSuggestionAtom)?.ownerId === ownerId) store.set(headerSuggestionAtom, null)
    }
    clearOwnedSuggestion()
    // Let the short completion status finish before offering a next step.
    if (!visible || !options.active || !options.session || options.session.isProcessing || options.hasPendingRequest || status) return clearOwnedSuggestion

    const timer = window.setTimeout(() => {
      if (!canUseHeaderSuggestion()) return
      const liveOptions = latest.current
      const liveProcess = liveOptions.session ? store.get(reusableProcessesAtom)[liveOptions.session.id] : undefined
      // Metadata matching runs after the typing pause, never on every keystroke.
      const candidate = selectContextualSuggestion({ ...liveOptions, process: liveProcess, now: Date.now() })
      if (!candidate || headerStatusForWorkspace(store.get(headerStatusAtom).current, candidate.workspaceId)) return
      const history = store.get(suggestionHistoryAtom)
      if (offeredId.current !== candidate.id && !canOfferSuggestion(history, candidate.id, Date.now())) return

      if (offeredId.current !== candidate.id) {
        store.set(suggestionHistoryAtom, rememberSuggestion(history, candidate.id, Date.now()))
        offeredId.current = candidate.id
      }
      const acknowledge = () => {
        offeredId.current = null
        clearOwnedSuggestion()
      }
      const withCurrentContext = (action: (current: ContextualSuggestionsOptions) => void) => () => {
        const current = latest.current
        const currentProcess = current.session ? store.get(reusableProcessesAtom)[current.session.id] : undefined
        const stillRelevant = selectContextualSuggestion({ ...current, process: currentProcess, now: Date.now() })
        if (!canUseHeaderSuggestion() || stillRelevant?.id !== candidate.id) {
          clearOwnedSuggestion()
          return
        }
        acknowledge()
        action(current)
      }
      const publishPrepared = (messageKey: string) => {
        store.set(publishHeaderStatusAtom, {
          id: `${candidate.id}:prepared`,
          workspaceId: candidate.workspaceId,
          tone: 'info',
          messageKey,
          createdAt: Date.now(),
        })
      }

      store.set(headerSuggestionAtom, {
        ...candidate,
        ownerId,
        onDismiss: acknowledge,
        actions: candidate.kind === 'save-process' ? [
          {
            labelKey: 'headerStatus.draftSkill',
            onClick: withCurrentContext(current => {
              current.onDraftChange(t('headerStatus.skillDraftPrompt'))
              publishPrepared('headerStatus.skillDraftReady')
            }),
          },
          {
            labelKey: 'headerStatus.openWorkflow',
            onClick: withCurrentContext(current => current.onOpenWorkflow()),
          },
        ] : [
          {
            labelKey: 'headerStatus.useSkill',
            onClick: withCurrentContext(current => {
              // Use the latest draft, preserving every character the user typed.
              current.onDraftChange(addSkillToDraft(current.draft, candidate.skill!.slug))
              publishPrepared('headerStatus.skillAdded')
            }),
          },
        ],
      })
    }, SUGGESTION_IDLE_MS)

    return () => {
      window.clearTimeout(timer)
      clearOwnedSuggestion()
    }
  }, [options.session, options.skills, options.draft, options.active, options.hasPendingRequest, process, sessionId, ownerId, status, store, t, visible])
}
