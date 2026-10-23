/**
 * Notes comment rail backed by notes:*Comment RPCs (sidecar threads).
 * Reuses @rox/ui CommentsThread for replies + reactions; adds resolve and
 * whole-document / selection compose on top of the existing Notes chrome.
 */
import * as React from 'react'
import { CheckCircle2, MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteCommentThread } from '@rox/shared/protocol'
import { CommentsThread, type CommentItem } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { NotesCommentComposer } from './NotesReadingChrome'
import {
  anchorFromQuote,
  isDocumentNoteComment,
  nestNoteCommentThreads,
  resolveNoteCommentAnchors,
} from './note-comments'

const LOCAL_AUTHOR = 'Вы'

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


export function noteThreadsToHighlightComments(comments: readonly NoteCommentThread[]): Array<{
  id: string
  quote: string
  body: string
  createdAt: number
}> {
  return comments
    .filter(comment => !comment.parentId && comment.anchor?.selectedText)
    .map(comment => ({
      id: comment.id,
      quote: comment.anchor!.selectedText,
      body: comment.body,
      createdAt: comment.createdAt,
    }))
}

export function NotesCommentThreads({
  workspaceId,
  noteId,
  noteText,
  draftQuote,
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
  /** Current note body used to build/resolve selection anchors. */
  noteText: string
  draftQuote: string
  onClearDraft: () => void
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
  const body = draftBody ?? localBody
  const setBody = onDraftBodyChange ?? setLocalBody

  const reload = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.electronAPI.listNoteComments(workspaceId, noteId)
      setComments(list)
      onThreadsChange?.(list)
    } catch {
      setError(t('notes.comments.errorUpdate'))
      setComments([])
      onThreadsChange?.([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, noteId, onThreadsChange, t])

  React.useEffect(() => {
    setDocCompose(false)
    setLocalBody('')
    void reload()
  }, [workspaceId, noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolved = React.useMemo(
    () => resolveNoteCommentAnchors(noteText, comments.filter(c => !c.parentId)),
    [noteText, comments],
  )

  const openCount = comments.filter(c => !c.parentId && !c.resolvedAt).length
  const openRoots = React.useMemo(
    () => nestNoteCommentThreads(comments).filter(c => !c.resolvedAt),
    [comments],
  )
  const resolvedRoots = React.useMemo(
    () => nestNoteCommentThreads(comments).filter(c => c.resolvedAt),
    [comments],
  )

  const clearComposer = React.useCallback(() => {
    setBody('')
    onClearDraft()
    setDocCompose(false)
  }, [onClearDraft, setBody])

  const createRoot = React.useCallback(async () => {
    const text = body.trim()
    if (!text) return
    const quote = draftQuote.trim()
    let anchor = quote ? anchorFromQuote(noteText, quote) : null
    if (quote && !anchor) {
      setError(t('notes.comments.errorAttachSelection'))
      return
    }
    setError(null)
    try {
      const created = await window.electronAPI.createNoteComment(workspaceId, {
        noteId,
        body: text,
        anchor,
      })
      const next = [...comments, created]
      setComments(next)
      onThreadsChange?.(next)
      clearComposer()
    } catch {
      setError(t('notes.comments.errorCreate'))
    }
  }, [body, draftQuote, noteText, workspaceId, noteId, comments, clearComposer, onThreadsChange, t])

  const onCreate = React.useCallback(async (text: string, parentId?: string) => {
    try {
      const created = await window.electronAPI.createNoteComment(workspaceId, {
        noteId,
        body: text,
        parentId,
        anchor: null,
      })
      const next = [...comments, created]
      setComments(next)
      onThreadsChange?.(next)
    } catch {
      setError(t('notes.comments.errorCreate'))
    }
  }, [workspaceId, noteId, comments, onThreadsChange, t])

  const onEdit = React.useCallback(async (id: string, nextBody: string) => {
    try {
      const updated = await window.electronAPI.updateNoteComment(workspaceId, {
        noteId,
        commentId: id,
        body: nextBody,
      })
      const next = comments.map(c => c.id === id ? updated : c)
      setComments(next)
      onThreadsChange?.(next)
    } catch {
      setError(t('notes.comments.errorUpdate'))
    }
  }, [workspaceId, noteId, comments, onThreadsChange, t])

  const onDelete = React.useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteNoteComment(workspaceId, noteId, id)
      const next = comments.filter(c => c.id !== id && c.parentId !== id)
      setComments(next)
      onThreadsChange?.(next)
    } catch {
      setError(t('notes.comments.errorDelete'))
    }
  }, [workspaceId, noteId, comments, onThreadsChange, t])

  const onToggleReaction = React.useCallback(async (id: string, emoji: string) => {
    try {
      const updated = await window.electronAPI.updateNoteComment(workspaceId, {
        noteId,
        commentId: id,
        reaction: { emoji },
      })
      const next = comments.map(c => c.id === id ? updated : c)
      setComments(next)
      onThreadsChange?.(next)
    } catch {
      setError(t('notes.comments.errorUpdate'))
    }
  }, [workspaceId, noteId, comments, onThreadsChange, t])

  const setResolved = React.useCallback(async (id: string, resolvedFlag: boolean) => {
    setBusyId(id)
    try {
      const updated = await window.electronAPI.updateNoteComment(workspaceId, {
        noteId,
        commentId: id,
        resolved: resolvedFlag,
      })
      const next = comments.map(c => c.id === id ? updated : c)
      setComments(next)
      onThreadsChange?.(next)
    } catch {
      setError(t('notes.comments.errorStatus'))
    } finally {
      setBusyId(null)
    }
  }, [workspaceId, noteId, comments, onThreadsChange, t])

  const showSelectionComposer = Boolean(draftQuote)
  const showDocComposer = docCompose && !draftQuote

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
                    allowReplies
                    // Root compose lives in NotesCommentComposer; keep reply composers only.
                    renderComposer={() => null}
                    className="gap-2"
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busyId === root.id}
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
                  disabled={busyId === root.id}
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
            className="h-7 w-full rounded-[var(--radius-control)] bg-muted text-xs font-medium text-foreground hover:bg-surface-hover"
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
          onSubmit={() => { void createRoot() }}
          onCancel={clearComposer}
          focusRequested={focusRequested || showDocComposer}
          onFocusHandled={onFocusHandled}
        />
      ) : null}
    </aside>
  )
}
