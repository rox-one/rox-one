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
}

export interface CommentsThreadProps {
  comments: readonly CommentItem[]
  onCreate?: (body: string, parentId?: string) => void
  onEdit?: (id: string, body: string) => void
  onDelete?: (id: string) => void
  onToggleReaction?: (id: string, emoji: string) => void
  renderBody?: (comment: CommentItem) => React.ReactNode
  renderComposer?: (props: CommentComposerProps) => React.ReactNode
  allowReplies?: boolean
  timeZone?: string
  className?: string
}

function TextComposer({ value, onChange, onSubmit, placeholder, submitLabel, onCancel, cancelLabel, autoFocus }: CommentComposerProps & { submitLabel: string; onCancel?: () => void; cancelLabel?: string; autoFocus?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit() }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
        }}
        className={cn('min-h-12 resize-y rounded-[6px] bg-foreground/[0.04] px-2 py-1.5 text-[13px] placeholder:text-text-muted', FOCUS_RING)}
      />
      <div className="flex justify-end gap-1">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={cn('h-7 rounded-[6px] px-2 text-[12px] text-text-secondary', HOVER_TINT, FOCUS_RING)}>{cancelLabel}</button>
        ) : null}
        <button
          type="button"
          disabled={!value.trim()}
          onClick={onSubmit}
          className={cn('h-7 rounded-[6px] bg-accent px-3 text-[12px] font-medium text-[var(--accent-foreground,white)] disabled:opacity-50', MOTION_FAST, FOCUS_RING)}
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
  const submit = () => {
    const body = draft.trim()
    if (!body || !onCreate) return
    onCreate(body)
    setDraft('')
  }
  const composerProps: CommentComposerProps = { value: draft, onChange: setDraft, onSubmit: submit, placeholder: t('entities.ui.comments.placeholder') }

  return (
    <section aria-label={t('entities.ui.comments.title')} className={cn('flex flex-col gap-3', className)}>
      {comments.length === 0 ? <div className="text-[12px] text-text-muted">{t('entities.ui.comments.empty')}</div> : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => <CommentRow key={c.id} comment={c} depth={0} allowReplies={allowReplies} thread={props} />)}
        </ul>
      )}
      {onCreate ? (props.renderComposer?.(composerProps) ?? <TextComposer {...composerProps} submitLabel={t('entities.ui.comments.send')} />) : null}
    </section>
  )
}

function CommentRow({ comment, depth, allowReplies, thread }: { comment: CommentItem; depth: number; allowReplies: boolean; thread: CommentsThreadProps }) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [editDraft, setEditDraft] = React.useState(comment.body)
  const [replying, setReplying] = React.useState(false)
  const [replyDraft, setReplyDraft] = React.useState('')
  const timeFmt = new Intl.DateTimeFormat(i18n.language || 'ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: thread.timeZone })
  const replies = comment.replies ?? []
  const actionClass = cn('h-6 rounded-[6px] px-1.5 text-[11px] text-text-muted hover:text-foreground', HOVER_TINT, FOCUS_RING)

  return (
    <li className={cn('flex gap-2', depth > 0 && 'ml-8')} data-comment-id={comment.id}>
      <PersonAvatar person={comment.author} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="font-semibold">{comment.author.name}</span>
          {formatInstant(timeFmt, comment.createdAt) ? (
            <time dateTime={comment.createdAt} className="text-text-muted">{formatInstant(timeFmt, comment.createdAt)}</time>
          ) : null}
          {comment.editedAt && !comment.deleted ? <span className="text-text-muted">· {t('entities.ui.comments.edited')}</span> : null}
        </div>
        {comment.deleted ? (
          <div className="text-[13px] italic text-text-muted">{t('entities.ui.comments.deleted')}</div>
        ) : editing ? (
          <TextComposer
            value={editDraft}
            onChange={setEditDraft}
            autoFocus
            placeholder={t('entities.ui.comments.placeholder')}
            submitLabel={t('entities.ui.comments.save')}
            cancelLabel={t('entities.ui.comments.cancel')}
            onCancel={() => { setEditing(false); setEditDraft(comment.body) }}
            onSubmit={() => { const body = editDraft.trim(); if (body) { thread.onEdit?.(comment.id, body); setEditing(false) } }}
          />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13px]">{thread.renderBody?.(comment) ?? comment.body}</div>
        )}
        {!comment.deleted && !editing ? (
          <div className="flex flex-wrap items-center gap-1">
            {comment.reactions?.length || thread.onToggleReaction ? (
              <ReactionsBar reactions={comment.reactions ?? []} onToggle={thread.onToggleReaction ? (emoji) => thread.onToggleReaction?.(comment.id, emoji) : undefined} />
            ) : null}
            {allowReplies && depth === 0 && thread.onCreate ? (
              <button type="button" onClick={() => setReplying((v) => !v)} className={actionClass}>{t('entities.ui.comments.reply')}</button>
            ) : null}
            {comment.mine && thread.onEdit ? <button type="button" onClick={() => setEditing(true)} className={actionClass}>{t('entities.ui.comments.edit')}</button> : null}
            {comment.mine && thread.onDelete ? <button type="button" onClick={() => thread.onDelete?.(comment.id)} className={actionClass}>{t('entities.ui.comments.delete')}</button> : null}
          </div>
        ) : null}
        {replies.length > 0 ? (
          <>
            <div className="text-[11px] text-text-muted">{t('entities.ui.comments.replies', { count: replies.length })}</div>
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
            placeholder={t('entities.ui.comments.placeholder')}
            submitLabel={t('entities.ui.comments.reply')}
            cancelLabel={t('entities.ui.comments.cancel')}
            onCancel={() => { setReplying(false); setReplyDraft('') }}
            onSubmit={() => { const body = replyDraft.trim(); if (body) { thread.onCreate?.(body, comment.id); setReplying(false); setReplyDraft('') } }}
          />
        ) : null}
      </div>
    </li>
  )
}
