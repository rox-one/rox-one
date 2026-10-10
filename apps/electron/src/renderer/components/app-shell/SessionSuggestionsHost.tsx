import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import type { SessionSuggestion } from '@rox/shared/protocol'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toErrorMessage } from '@/lib/errors'

/** Opens the suggestion dialog for a `suggest` session from anywhere in the shell. */
export const SESSION_SUGGESTIONS_EVENT = 'rox:session-suggestions'

export interface SessionSuggestionsEventDetail {
  sessionId: string
  /**
   * Effective owner account id — the assigned owner, else the session creator.
   * `null`/absent only when the session has no attribution at all, which the
   * server treats as open (everyone may resolve).
   */
  ownerId?: string | null
  /** The viewer's own account id (null when no account is connected), to decide whether accept/dismiss is offered. */
  viewerId?: string | null
}

/** Attribution slice needed to resolve who may resolve a suggestion. */
export interface SessionSuggestionOwnerFields {
  owner?: { id: string }
  creator?: { accountId: string }
}

/**
 * Resolve the account id the server will accept a suggestion-resolve from,
 * mirroring `evaluateSessionWriteAccess` (`session.owner?.id ?? session.creator?.accountId
 * ?? null`, SessionManager.ts): an assigned owner wins, otherwise the creator.
 * `null` means the session is unattributed and the server leaves it open.
 */
export function resolveSuggestionOwnerId(meta: SessionSuggestionOwnerFields): string | null {
  return meta.owner?.id ?? meta.creator?.accountId ?? null
}

/**
 * Whether the dialog offers accept/dismiss to this viewer. The rule is the same
 * one the resolve RPC enforces: unattributed sessions are open to everyone,
 * otherwise only the effective owner passes the write gate.
 */
export function viewerMayResolveSuggestions(ownerId: string | null | undefined, viewerId: string | null | undefined): boolean {
  return !ownerId || ownerId === viewerId
}

export function openSessionSuggestions(detail: SessionSuggestionsEventDetail): void {
  window.dispatchEvent(new CustomEvent<SessionSuggestionsEventDetail>(SESSION_SUGGESTIONS_EVENT, { detail }))
}

function stateKey(state: SessionSuggestion['state']): string {
  return `sessionSuggestions.state.${state}`
}

/**
 * Minimal suggestion surface for a `suggest` session (a2.5): list pending and
 * resolved suggestions, propose a new one, and — for the owner — accept or
 * dismiss. Accepting dispatches exactly one message server-side, so the client
 * only refreshes the list afterward.
 *
 * Lives outside menus so closing the session menu cannot discard the list or the
 * in-progress draft, mirroring SessionSharingHost.
 */
export function SessionSuggestionsHost() {
  const { t } = useTranslation()
  const [target, setTarget] = React.useState<SessionSuggestionsEventDetail | null>(null)
  const [items, setItems] = React.useState<SessionSuggestion[]>([])
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const sessionIdRef = React.useRef<string | null>(null)

  const refresh = React.useCallback(async (sessionId: string) => {
    const listed = await window.electronAPI.listSessionSuggestions(sessionId)
    if (sessionIdRef.current !== sessionId) return
    setItems(listed)
  }, [])

  React.useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<SessionSuggestionsEventDetail>).detail
      if (!detail?.sessionId) return
      sessionIdRef.current = detail.sessionId
      setTarget(detail)
      setDraft('')
      setItems([])
      void refresh(detail.sessionId).catch(error => toast.error(t('sessionSuggestions.failed'), { description: toErrorMessage(error) }))
    }
    window.addEventListener(SESSION_SUGGESTIONS_EVENT, open)
    return () => window.removeEventListener(SESSION_SUGGESTIONS_EVENT, open)
  }, [refresh, t])

  const isOwner = viewerMayResolveSuggestions(target?.ownerId, target?.viewerId)

  const propose = async () => {
    const sessionId = target?.sessionId
    const body = draft.trim()
    if (!sessionId || !body || busy) return
    setBusy(true)
    try {
      await window.electronAPI.addSessionSuggestion(sessionId, body)
      setDraft('')
      await refresh(sessionId)
      toast.success(t('sessionSuggestions.added'))
    } catch (error) {
      toast.error(t('sessionSuggestions.failed'), { description: toErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (suggestion: SessionSuggestion, resolution: 'accepted' | 'dismissed') => {
    const sessionId = target?.sessionId
    if (!sessionId || busy) return
    setBusy(true)
    try {
      await window.electronAPI.resolveSessionSuggestion(sessionId, suggestion.id, resolution)
      await refresh(sessionId)
      toast.success(t(resolution === 'accepted' ? 'sessionSuggestions.accepted' : 'sessionSuggestions.dismissed'))
    } catch (error) {
      toast.error(t('sessionSuggestions.failed'), { description: toErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => { if (!next) setTarget(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sessionSuggestions.title')}</DialogTitle>
          <DialogDescription>{t('sessionSuggestions.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {items.length === 0 && (
            <p className="py-4 text-center text-caption text-muted-foreground">{t('sessionSuggestions.empty')}</p>
          )}
          {items.map(suggestion => (
            <div key={suggestion.id} className="rounded-md border border-border-subtle p-2.5">
              <p className="whitespace-pre-wrap text-sm">{suggestion.body}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-caption text-muted-foreground">
                  {t('sessionSuggestions.proposedBy', { name: suggestion.author.displayName })}
                  {suggestion.state !== 'pending' && ` · ${t(stateKey(suggestion.state))}`}
                </span>
                {suggestion.state === 'pending' && isOwner && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(suggestion, 'accepted')}>
                      <Check className="icon-caption" />
                      {t('sessionSuggestions.accept')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(suggestion, 'dismissed')}>
                      <X className="icon-caption" />
                      {t('sessionSuggestions.dismiss')}
                    </Button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <Textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={t('sessionSuggestions.bodyPlaceholder')}
          rows={3}
        />

        <DialogFooter>
          <Button disabled={busy || draft.trim().length === 0} onClick={() => void propose()}>
            {t('sessionSuggestions.propose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}