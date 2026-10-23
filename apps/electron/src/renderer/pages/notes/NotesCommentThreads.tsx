/**
 * Notes comment rail backed by notes:*Comment RPCs (sidecar threads).
 * Reuses @rox/ui CommentsThread for replies + reactions; adds resolve and
 * whole-document / selection compose on top of the existing Notes chrome.
 */
import * as React from 'react'
import { CheckCircle2, MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteChangedPayload, NoteCommentThread } from '@rox/shared/protocol'
import { CommentsThread, type CommentItem } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { NotesCommentComposer } from './NotesReadingChrome'
import {
  anchorFromQuote,
  isDocumentNoteComment,
  nestNoteCommentThreads,
  noteThreadsToHighlightComments,
  removeNoteCommentFromList,
  resolveNoteCommentAnchors,
  upsertNoteCommentInList,
} from './note-comments'

export { noteThreadsToHighlightComments }

const LOCAL_AUTHOR = 'Вы'
const CREATE_BUSY = '__create__'

function toCommentItem(comment: NoteCommentThread, viewer = LOCAL_AUTHOR): CommentItem {
  return {
    id: comment.id,
    author: { id: comment.author, name: comment.author },
    createdAt: new Date(comment.createdAt).toISOString(),
    body: comment.body,
    editedAt: comment.updatedAt > comment.createdAt ? new Date(comment.updatedAt).toISOString() : undefined,
    mine: comment.author === viewer,
    reactions: (comment.reactions ?? []).map(reaction => ({
      emoji: reaction.emoji,
      count: reaction.authors.length,
      mine: reaction.authors.includes(viewer),
    })),
    replies: [],
  }
}

function normalizeChangedPayload(payload: NoteChangedPayload | string): NoteChangedPayload {
  return typeof payload === 'string' ? { workspaceId: payload } : payload
}

export function NotesCommentThreads({
  workspaceId,
  noteId,
  noteText,
  getNoteText,
  draftQuote,
  draftAnchor = null,
  onClearDraft,
  width,
  composerTop,
  draftBody,
  onDraftBodyChange,
  focusRequested,
  onFocusHandled,
  onJumpToQuote,
  onThreadsChange,
}: {
  workspaceId: string
  noteId: string
  /** Latest rendered note body (resolve/highlight). */
  noteText: string
  /** Live source for selection anchors — same as overlay (contentRef.current). */
  getNoteText: () => string
  draftQuote: string
  /** Preferred selection offsets into getNoteText() for repeated quotes. */
  draftAnchor?: { start: number; end: number } | null
  /** Clear the unsent draft. Pass scope after a successful create so a navigated-away note still drops its draft. */
  onClearDraft: (scope?: { workspaceId: string; noteId: string }) => void
  width?: number
  composerTop?: number
  draftBody?: string
  onDraftBodyChange?: (body: string) => void
  focusRequested?: boolean
  onFocusHandled?: () => void
  onJumpToQuote?: (quote: string) => void
  onThreadsChange?: (comments: NoteCommentThread[]) => void
}) {
  const { t } = useTranslation()
  const [comments, setComments] = React.useState<NoteCommentThread[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [localBody, setLocalBody] = React.useState('')
  const [docCompose, setDocCompose] = React.useState(false)
  const onThreadsChangeRef = React.useRef(onThreadsChange)
  onThreadsChangeRef.current = onThreadsChange
  const createInFlightRef = React.useRef(false)
  /** Which note owns the create lock — stale finally must match before clearing. */
  const createFlightKeyRef = React.useRef<string | null>(null)
  const reloadGenerationRef = React.useRef(0)
  /** Latest mounted note key — compared after awaits so stale work cannot publish. */
  const activeKeyRef = React.useRef({ workspaceId, noteId })
  activeKeyRef.current = { workspaceId, noteId }
  const body = draftBody ?? localBody
  const setBody = onDraftBodyChange ?? setLocalBody

  const isActiveKey = React.useCallback((key: { workspaceId: string; noteId: string }) => (
    activeKeyRef.current.workspaceId === key.workspaceId
    && activeKeyRef.current.noteId === key.noteId
  ), [])

  const publish = React.useCallback((list: NoteCommentThread[], key: { workspaceId: string; noteId: string }) => {
    if (!isActiveKey(key)) return
    setComments(list)
    onThreadsChangeRef.current?.(list)
  }, [isActiveKey])

  /** Functional local commit that also notifies the parent (highlights) immediately. */
  const publishUpdate = React.useCallback((
    key: { workspaceId: string; noteId: string },
    updater: (prev: readonly NoteCommentThread[]) => NoteCommentThread[],
  ) => {
    if (!isActiveKey(key)) return
    setComments(prev => {
      if (!isActiveKey(key)) return prev
      const next = updater(prev)
      onThreadsChangeRef.current?.(next)
      return next
    })
  }, [isActiveKey])

  const reload = React.useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = Boolean(opts?.quiet)
    const requestKey = { workspaceId, noteId }
    const generation = ++reloadGenerationRef.current
    if (!quiet) {
      setLoading(true)
      setError(null)
    }
    try {
      const list = await window.electronAPI.listNoteComments(requestKey.workspaceId, requestKey.noteId)
      // Drop stale responses after note/workspace switch or overlapping reloads.
      if (generation !== reloadGenerationRef.current) return
      if (!isActiveKey(requestKey)) return
      publish(list, requestKey)
    } catch {
      if (generation !== reloadGenerationRef.current) return
      if (!isActiveKey(requestKey)) return
      setError(t('notes.comments.errorUpdate'))
      // Quiet reloads must not wipe the rail / highlights on a transient failure.
      if (!quiet) publish([], requestKey)
    } finally {
      if (!quiet && generation === reloadGenerationRef.current && isActiveKey(requestKey)) {
        setLoading(false)
      }
    }
  }, [workspaceId, noteId, publish, isActiveKey, t])

  React.useEffect(() => {
    // Invalidate in-flight lists and clear prior note's threads/highlights immediately.
    // Do not reset createInFlightRef here — a stale create's finally must not unlock a newer create,
    // and unlocking on switch would let the previous create's finally clear a lock owned by a later submit.
    reloadGenerationRef.current += 1
    const key = { workspaceId, noteId }
    publish([], key)
    setError(null)
    setDocCompose(false)
    setLocalBody('')
    setBusyId(null)
    void reload()
    return () => {
      // Collapsed rail unmounts this panel — still clear parent highlights.
      reloadGenerationRef.current += 1
      onThreadsChangeRef.current?.([])
    }
  }, [workspaceId, noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onNotesChanged((raw) => {
      const payload = normalizeChangedPayload(raw)
      if (payload.workspaceId !== workspaceId) return
      if (payload.reason !== 'comments') return
      if (payload.noteId && payload.noteId !== noteId) return
      void reload({ quiet: true })
    })
    return unsubscribe
  }, [workspaceId, noteId, reload])

  const resolved = React.useMemo(
    () => resolveNoteCommentAnchors(noteText, comments.filter(c => !c.parentId)),
    [noteText, comments],
  )

  const openCount = comments.filter(c => !c.parentId && !c.resolvedAt).length
  const nestedRoots = React.useMemo(() => nestNoteCommentThreads(comments), [comments])
  const openRoots = React.useMemo(() => nestedRoots.filter(c => !c.resolvedAt), [nestedRoots])
  const resolvedRoots = React.useMemo(() => nestedRoots.filter(c => c.resolvedAt), [nestedRoots])

  const clearComposer = React.useCallback((scope?: { workspaceId: string; noteId: string }) => {
    // Always clear the parent draft for the submitted note (scope), even after navigation.
    onClearDraft(scope)
    if (!scope || isActiveKey(scope)) {
      setBody('')
      setDocCompose(false)
    }
  }, [onClearDraft, setBody, isActiveKey])

  const createRoot = React.useCallback(async () => {
    const text = body.trim()
    if (!text || createInFlightRef.current) return
    const quote = draftQuote.trim()
    // Match overlay: anchor against the live contentRef body, not React state.
    const liveText = getNoteText()
    const anchor = quote ? anchorFromQuote(liveText, quote, draftAnchor) : null
    if (quote && !anchor) {
      setError(t('notes.comments.errorAttachSelection'))
      return
    }
    setError(null)
    const requestKey = { workspaceId, noteId }
    createInFlightRef.current = true
    const flightKey = JSON.stringify([requestKey.workspaceId, requestKey.noteId])
    createFlightKeyRef.current = flightKey
    setBusyId(CREATE_BUSY)
    try {
      const created = await window.electronAPI.createNoteComment(requestKey.workspaceId, {
        noteId: requestKey.noteId,
        body: text,
        anchor,
      })
      // Drop the unsent draft for this note even if the user already switched away —
      // otherwise returning would resubmit a duplicate of the comment just created.
      clearComposer(requestKey)
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => upsertNoteCommentInList(prev, created))
      await reload({ quiet: true })
    } catch {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorCreate'))
    } finally {
      // Only the owner of the lock may release it (stale finally must not unlock a newer create).
      if (createFlightKeyRef.current === flightKey) {
        createFlightKeyRef.current = null
        createInFlightRef.current = false
      }
      if (isActiveKey(requestKey)) setBusyId(null)
    }
  }, [body, draftQuote, draftAnchor, getNoteText, workspaceId, noteId, clearComposer, publishUpdate, reload, isActiveKey, t])

  const onCreate = React.useCallback(async (text: string, parentId?: string) => {
    const requestKey = { workspaceId, noteId }
    try {
      const created = await window.electronAPI.createNoteComment(requestKey.workspaceId, {
        noteId: requestKey.noteId,
        body: text,
        parentId,
        anchor: null,
      })
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => upsertNoteCommentInList(prev, created))
      await reload({ quiet: true })
    } catch (err) {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorCreate'))
      throw err
    }
  }, [workspaceId, noteId, publishUpdate, reload, isActiveKey, t])

  const onEdit = React.useCallback(async (id: string, nextBody: string) => {
    const requestKey = { workspaceId, noteId }
    try {
      const updated = await window.electronAPI.updateNoteComment(requestKey.workspaceId, {
        noteId: requestKey.noteId,
        commentId: id,
        body: nextBody,
      })
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => upsertNoteCommentInList(prev, updated))
      await reload({ quiet: true })
    } catch (err) {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorUpdate'))
      throw err
    }
  }, [workspaceId, noteId, publishUpdate, reload, isActiveKey, t])

  const onDelete = React.useCallback(async (id: string) => {
    const requestKey = { workspaceId, noteId }
    try {
      await window.electronAPI.deleteNoteComment(requestKey.workspaceId, requestKey.noteId, id)
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => removeNoteCommentFromList(prev, id))
      await reload({ quiet: true })
    } catch {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorDelete'))
    }
  }, [workspaceId, noteId, publishUpdate, reload, isActiveKey, t])

  const onToggleReaction = React.useCallback(async (id: string, emoji: string) => {
    const requestKey = { workspaceId, noteId }
    try {
      const updated = await window.electronAPI.updateNoteComment(requestKey.workspaceId, {
        noteId: requestKey.noteId,
        commentId: id,
        reaction: { emoji },
      })
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => upsertNoteCommentInList(prev, updated))
      await reload({ quiet: true })
    } catch {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorUpdate'))
    }
  }, [workspaceId, noteId, publishUpdate, reload, isActiveKey, t])

  const setResolved = React.useCallback(async (id: string, resolvedFlag: boolean) => {
    const requestKey = { workspaceId, noteId }
    setBusyId(id)
    try {
      const updated = await window.electronAPI.updateNoteComment(requestKey.workspaceId, {
        noteId: requestKey.noteId,
        commentId: id,
        resolved: resolvedFlag,
      })
      if (!isActiveKey(requestKey)) return
      publishUpdate(requestKey, prev => upsertNoteCommentInList(prev, updated))
      await reload({ quiet: true })
    } catch {
      if (isActiveKey(requestKey)) setError(t('notes.comments.errorStatus'))
    } finally {
      if (isActiveKey(requestKey)) setBusyId(null)
    }
  }, [workspaceId, noteId, publishUpdate, reload, isActiveKey, t])

  const showSelectionComposer = Boolean(draftQuote)
  const showDocComposer = docCompose && !draftQuote
  const creating = busyId === CREATE_BUSY

  return (
    <aside
      className="notes-side-surface relative flex shrink-0 flex-col"
      style={{ width: width ?? 220 }}
      data-testid="notes-comments-rail"
      data-glass-slot="panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold uppercase caps-label text-muted-foreground">
        <MessageSquarePlus className="icon-caption" aria-hidden />
        {t('notes.comments.title')}
        {openCount > 0 ? (
          <span className="ml-auto normal-case tracking-normal text-muted-foreground">
            {t('notes.comments.openCount', { count: openCount })}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="text-xs text-muted-foreground" role="status">{t('common.loading')}</p>
        ) : null}
        {error ? (
          <p className="mb-2 text-xs text-destructive" role="alert">{error}</p>
        ) : null}

        {!loading && comments.length === 0 && !draftQuote && !docCompose ? (
          <p className="text-xs text-muted-foreground">{t('notes.comments.emptyHint')}</p>
        ) : null}

        {openRoots.length > 0 ? (
          <div className="mb-3 space-y-3">
            {openRoots.map(root => {
              const stale = root.anchor ? resolved[root.id]?.stale : false
              return (
                <article
                  key={root.id}
                  data-testid={`notes-comment-thread-${root.id}`}
                  data-glass-slot="card"
                  className="rounded-[var(--radius-card)] border border-border-subtle bg-muted/40 p-2"
                >
                  {root.anchor?.selectedText ? (
                    <button
                      type="button"
                      className="mb-1 block w-full truncate text-left text-xs italic text-muted-foreground hover:text-foreground"
                      onClick={() => onJumpToQuote?.(root.anchor!.selectedText)}
                      aria-label={t('notes.comments.jumpToQuote')}
                      title={root.anchor.selectedText}
                    >
                      “{root.anchor.selectedText}”
                    </button>
                  ) : isDocumentNoteComment(root) ? (
                    <p className="mb-1 text-xs text-muted-foreground">{t('notes.comments.documentScope')}</p>
                  ) : root.orphan ? (
                    <p className="mb-1 text-xs text-status-warning">{t('notes.comments.staleAnchor')}</p>
                  ) : null}
                  {stale ? (
                    <p className="mb-1 text-xs text-status-warning">{t('notes.comments.staleAnchor')}</p>
                  ) : null}
                  <CommentsThread
                    comments={[toCommentItem(root)].map(item => ({
                      ...item,
                      replies: root.replies.map(reply => toCommentItem(reply)),
                    }))}
                    onCreate={onCreate}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onToggleReaction={onToggleReaction}
                    allowReplies={!root.orphan}
                    // Suppress the per-card root composer (replies still work). Empty fragment or null both suppress.
                    renderComposer={() => <></>}
                    className="gap-2"
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busyId === root.id || creating}
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-xs text-muted-foreground',
                        'hover:bg-surface-hover hover:text-foreground disabled:opacity-40',
                      )}
                      onClick={() => void setResolved(root.id, true)}
                      aria-label={t('notes.comments.resolve')}
                    >
                      <CheckCircle2 className="icon-status" aria-hidden />
                      {t('notes.comments.resolve')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}

        {resolvedRoots.length > 0 ? (
          <div className="mt-2 space-y-2 border-t border-border-subtle pt-2">
            <p className="text-xs font-medium uppercase caps-label text-muted-foreground">
              {t('notes.comments.resolved')}
            </p>
            {resolvedRoots.map(root => (
              <article
                key={root.id}
                className="rounded-[var(--radius-card)] bg-muted/40 px-2 py-1.5 opacity-70"
                data-testid={`notes-comment-resolved-${root.id}`}
              >
                <p className="text-xs text-foreground line-clamp-2">{root.body}</p>
                <button
                  type="button"
                  disabled={busyId === root.id || creating}
                  className="mt-1 inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
                  onClick={() => void setResolved(root.id, false)}
                  aria-label={t('notes.comments.reopen')}
                >
                  <RotateCcw className="icon-status" aria-hidden />
                  {t('notes.comments.reopen')}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      {!showSelectionComposer && !showDocComposer ? (
        <div className="shrink-0 border-t border-border-subtle p-2">
          <button
            type="button"
            disabled={creating}
            className="h-7 w-full rounded-[var(--radius-control)] bg-muted text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-40"
            onClick={() => {
              setDocCompose(true)
              onClearDraft()
            }}
            data-testid="notes-comments-document"
          >
            {t('notes.comments.addDocument')}
          </button>
        </div>
      ) : null}

      {showSelectionComposer || showDocComposer ? (
        <NotesCommentComposer
          className="absolute right-2 z-popover"
          top={composerTop ?? 48}
          quote={draftQuote}
          body={body}
          onBodyChange={setBody}
          creating={creating}
          onSubmit={() => { if (!createInFlightRef.current) void createRoot() }}
          onCancel={() => { if (!createInFlightRef.current) clearComposer() }}
          focusRequested={focusRequested || showDocComposer}
          onFocusHandled={onFocusHandled}
        />
      ) : null}
    </aside>
  )
}
