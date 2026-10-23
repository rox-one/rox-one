/**
 * CommentsThread (W1-08, UI-SPEC §4 "CommentsSection"; TECH-SPEC §3.7).
 *
 * Flat list (Operately) with optional one-level reply threads (Lark docs),
 * per-comment reactions, edit/delete for own comments and a composer.
 * Controlled and transport-free: it emits create/edit/delete/react intents;
 * the host runs `comments.*` / `reactions.*` commands.
 *
 * Bodies render as plain text by default; hosts pass `renderBody` to render
 * Markdown with EntityChip mentions. The composer is a textarea with a
 * `renderComposer` slot so a TipTap-minimal composer can replace it.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, formatInstant } from '../primitives/tokens'
import { PersonAvatar, type PersonOption } from '../person-field/PeopleList'
import { ReactionsBar, type ReactionSummary } from '../reactions/ReactionsBar'

export interface CommentItem {
  id: string
  author: PersonOption
  /** ISO instant. */
  createdAt: string
  body: string
  editedAt?: string
  deleted?: boolean
  /** Viewer authored this comment (enables edit/delete). */
  mine?: boolean
  reactions?: ReactionSummary[]
  replies?: CommentItem[]
}

export interface CommentComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  /** True while an async create/edit is in flight — disables submit. */
  submitting?: boolean
}

export interface CommentsThreadProps {
  comments: readonly CommentItem[]
  onCreate?: (body: string, parentId?: string) => void | Promise<void>
  onEdit?: (id: string, body: string) => void | Promise<void>
  onDelete?: (id: string) => void
  onToggleReaction?: (id: string, emoji: string) => void
  renderBody?: (comment: CommentItem) => React.ReactNode
  renderComposer?: (props: CommentComposerProps) => React.ReactNode
  allowReplies?: boolean
  timeZone?: string
  className?: string
}

function TextComposer({ value, onChange, onSubmit, placeholder, submitLabel, onCancel, cancelLabel, autoFocus, submitting }: CommentComposerProps & { submitLabel: string; onCancel?: () => void; cancelLabel?: string; autoFocus?: boolean }) {
  const busy = Boolean(submitting)
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (busy) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit() }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
        }}
        className={cn('min-h-12 resize-y rounded-sm bg-foreground/[0.04] px-2 py-1.5 text-base placeholder:text-text-muted disabled:opacity-50', FOCUS_RING)}
      />
      <div className="flex justify-end gap-1">
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel} className={cn('h-7 rounded-sm px-2 text-sm text-text-secondary disabled:opacity-50', HOVER_TINT, FOCUS_RING)}>{cancelLabel}</button>
        ) : null}
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={onSubmit}
          className={cn('h-7 rounded-sm bg-accent px-3 text-sm font-medium text-[var(--accent-foreground,white)] disabled:opacity-50', MOTION_FAST, FOCUS_RING)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

export function CommentsThread(props: CommentsThreadProps) {
  const { comments, onCreate, allowReplies = true, className } = props
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const submit = () => {
    const body = draft.trim()
    if (!body || !onCreate || submitting) return
    setSubmitting(true)
    void (async () => {
      try {
        await onCreate(body)
        setDraft('')
      } catch {
        // Keep the draft so the author can retry after a failed create.
      } finally {
        setSubmitting(false)
      }
    })()
  }
  const composerProps: CommentComposerProps = {
    value: draft,
    onChange: setDraft,
    onSubmit: submit,
    placeholder: t('entities.ui.comments.placeholder'),
    submitting,
  }

  return (
    <section aria-label={t('entities.ui.comments.title')} className={cn('flex flex-col gap-3', className)}>
      {comments.length === 0 ? <div className="text-sm text-text-muted">{t('entities.ui.comments.empty')}</div> : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => <CommentRow key={c.id} comment={c} depth={0} allowReplies={allowReplies} thread={props} />)}
        </ul>
      )}
      {onCreate ? (() => {
        // Explicit null / false / empty fragment must suppress the default
        // composer — `??` would revive TextComposer when the slot returns null.
        if (!props.renderComposer) {
          return <TextComposer {...composerProps} submitLabel={t('entities.ui.comments.send')} />
        }
        const slot = props.renderComposer(composerProps)
        return slot === undefined ? <TextComposer {...composerProps} submitLabel={t('entities.ui.comments.send')} /> : slot
      })() : null}
    </section>
  )
}

function CommentRow({ comment, depth, allowReplies, thread }: { comment: CommentItem; depth: number; allowReplies: boolean; thread: CommentsThreadProps }) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [editDraft, setEditDraft] = React.useState(comment.body)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [replying, setReplying] = React.useState(false)
  const [replyDraft, setReplyDraft] = React.useState('')
  const [replySubmitting, setReplySubmitting] = React.useState(false)
  // Host-independent timestamp: format the date and the clock with two
  // separate Intl formatters joined by a literal ', '. A single formatter
  // emits locale glue ("at" on macOS ICU, a comma on Linux CLDR), which makes
  // snapshots differ across hosts.
  const locale = i18n.language || 'ru'
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: thread.timeZone })
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: thread.timeZone })
  const dayLabel = formatInstant(dayFmt, comment.createdAt)
  const timeLabel = formatInstant(timeFmt, comment.createdAt)
  const stamp = dayLabel && timeLabel ? `${dayLabel}, ${timeLabel}` : ''
  const replies = comment.replies ?? []
  const actionClass = cn('h-6 rounded-sm px-1.5 text-xs text-text-muted hover:text-foreground', HOVER_TINT, FOCUS_RING)

  return (
    <li className={cn('flex gap-2', depth > 0 && 'ml-8')} data-comment-id={comment.id}>
      <PersonAvatar person={comment.author} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold">{comment.author.name}</span>
          {stamp ? (
            <time dateTime={comment.createdAt} className="text-text-muted">{stamp}</time>
          ) : null}
          {comment.editedAt && !comment.deleted ? <span className="text-text-muted">· {t('entities.ui.comments.edited')}</span> : null}
        </div>
        {comment.deleted ? (
          <div className="text-base italic text-text-muted">{t('entities.ui.comments.deleted')}</div>
        ) : editing ? (
          <TextComposer
            value={editDraft}
            onChange={setEditDraft}
            autoFocus
            submitting={editSubmitting}
            placeholder={t('entities.ui.comments.placeholder')}
            submitLabel={t('entities.ui.comments.save')}
            cancelLabel={t('entities.ui.comments.cancel')}
            onCancel={() => { if (!editSubmitting) { setEditing(false); setEditDraft(comment.body) } }}
            onSubmit={() => {
              const body = editDraft.trim()
              const edit = thread.onEdit
              if (!body || !edit || editSubmitting) return
              setEditSubmitting(true)
              void (async () => {
                try {
                  await edit(comment.id, body)
                  setEditing(false)
                } catch {
                  // Keep the editor open with the draft on failure.
                } finally {
                  setEditSubmitting(false)
                }
              })()
            }}
          />
        ) : (
          <div className="whitespace-pre-wrap break-words text-base">{thread.renderBody?.(comment) ?? comment.body}</div>
        )}
        {!comment.deleted && !editing ? (
          <div className="flex flex-wrap items-center gap-1">
            {comment.reactions?.length || thread.onToggleReaction ? (
              <ReactionsBar reactions={comment.reactions ?? []} onToggle={thread.onToggleReaction ? (emoji) => thread.onToggleReaction?.(comment.id, emoji) : undefined} />
            ) : null}
            {allowReplies && depth === 0 && thread.onCreate ? (
              <button type="button" onClick={() => setReplying((v) => !v)} className={actionClass}>{t('entities.ui.comments.reply')}</button>
            ) : null}
            {comment.mine && thread.onEdit ? <button type="button" onClick={() => { setEditDraft(comment.body); setEditing(true) }} className={actionClass}>{t('entities.ui.comments.edit')}</button> : null}
            {comment.mine && thread.onDelete ? <button type="button" onClick={() => thread.onDelete?.(comment.id)} className={actionClass}>{t('entities.ui.comments.delete')}</button> : null}
          </div>
        ) : null}
        {replies.length > 0 ? (
          <>
            <div className="text-xs text-text-muted">{t('entities.ui.comments.replies', { count: replies.length })}</div>
            <ul className="flex flex-col gap-2">
              {replies.map((r) => <CommentRow key={r.id} comment={r} depth={depth + 1} allowReplies={false} thread={thread} />)}
            </ul>
          </>
        ) : null}
        {replying ? (
          <TextComposer
            value={replyDraft}
            onChange={setReplyDraft}
            autoFocus
            submitting={replySubmitting}
            placeholder={t('entities.ui.comments.placeholder')}
            submitLabel={t('entities.ui.comments.reply')}
            cancelLabel={t('entities.ui.comments.cancel')}
            onCancel={() => { if (!replySubmitting) { setReplying(false); setReplyDraft('') } }}
            onSubmit={() => {
              const body = replyDraft.trim()
              const create = thread.onCreate
              if (!body || !create || replySubmitting) return
              setReplySubmitting(true)
              void (async () => {
                try {
                  await create(body, comment.id)
                  setReplying(false)
                  setReplyDraft('')
                } catch {
                  // Keep the reply composer open with the draft on failure.
                } finally {
                  setReplySubmitting(false)
                }
              })()
            }}
          />
        ) : null}
      </div>
    </li>
  )
}
