import * as React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { canFocusNotesControl } from './focus-state'

export function NotesEditorHeadlineStyles() {
  return (
    <style>{`
      .notes-editor-prose .ProseMirror > h1:first-child {
        font-size: 1.75rem;
        font-weight: 600;
        letter-spacing: -0.025em;
        line-height: 1.2;
        margin-bottom: 1.25rem;
      }
      .notes-editor .ProseMirror {
        color: var(--foreground);
      }
      .notes-authoring-palette,
      [data-testid="notes-comments-rail"] {
        border-color: var(--border-subtle);
      }
      [data-testid="notes-comments-rail"] article,
      [data-testid="notes-comments-compose"] textarea {
        border-color: var(--border-subtle);
        color: var(--foreground);
      }
      mark.notes-comment-hl,
      button.notes-comment-hl {
        background: hsl(48 96% 56% / 0.35);
        border-bottom: 1.5px solid hsl(38 92% 50% / 0.9);
        border-radius: 2px;
        cursor: pointer;
        color: inherit;
      }
    `}</style>
  )
}

export interface NoteComment {
  id: string
  quote: string
  body: string
  createdAt: number
}

function commentsKey(noteId: string): string {
  return `notes:comments:${noteId}`
}

export function loadNoteComments(noteId: string): NoteComment[] {
  try {
    const raw = localStorage.getItem(commentsKey(noteId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as NoteComment[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveNoteComments(noteId: string, comments: NoteComment[]): void {
  try { localStorage.setItem(commentsKey(noteId), JSON.stringify(comments)) } catch { /* Markdown remains canonical if the optional cache is unavailable. */ }
}

function extractHeadings(markdown: string): Array<{ id: string; level: number; text: string }> {
  const headings: Array<{ id: string; level: number; text: string }> = []
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const text = match[2]!.replace(/[#*_`]/g, '').trim()
    if (!text) continue
    headings.push({
      id: `h-${headings.length}-${text.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
      level: match[1]!.length,
      text,
    })
  }
  return headings
}

export function NotesToc({
  markdown,
  onJump,
  foldedIds,
  onToggleFold,
  width,
}: {
  markdown: string
  onJump: (text: string) => void
  foldedIds?: ReadonlySet<string>
  onToggleFold?: (id: string) => void
  width?: number
}) {
  const { t } = useTranslation()
  const headings = React.useMemo(() => extractHeadings(markdown), [markdown])
  return (
    <aside
      className="sticky top-0 flex shrink-0 flex-col self-stretch overflow-y-auto border-r border-border/50 px-3 py-4"
      style={{ width: width ?? 180 }}
      data-testid="notes-toc-rail"
    >
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {t('notes.toc.title')}
      </div>
      {headings.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground/50">
          {t('notes.toc.empty')}
        </p>
      ) : (
        <nav className="flex flex-col gap-0.5">
          {headings.map((heading) => {
            const foldId = heading.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
            const folded = foldedIds?.has(foldId) ?? false
            return (
              <div key={heading.id} className="flex items-center gap-0.5" style={{ paddingLeft: (heading.level - 1) * 10 }}>
                {onToggleFold ? (
                  <button
                    type="button"
                    aria-label={folded ? t('notes.fold.expand') : t('notes.fold.collapse')}
                    className="h-5 w-5 shrink-0 rounded-[4px] text-muted-foreground hover:bg-foreground/[0.06]"
                    onClick={() => onToggleFold(foldId)}
                  >
                    {folded ? '+' : '–'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onJump(heading.text)}
                  className="min-w-0 flex-1 rounded-[4px] px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {heading.text}
                </button>
              </div>
            )
          })}
        </nav>
      )}
    </aside>
  )
}

export function NotesCommentComposer({
  quote,
  body,
  onBodyChange,
  onSubmit,
  onCancel,
  top,
  className,
  focusRequested = false,
  onFocusHandled,
}: {
  quote: string
  body: string
  onBodyChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  top?: number
  className?: string
  focusRequested?: boolean
  onFocusHandled?: () => void
}) {
  const { t } = useTranslation()
  const composeRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (!focusRequested) return
    if (canFocusNotesControl(composeRef.current)) composeRef.current.focus({ preventScroll: true })
    onFocusHandled?.()
  }, [focusRequested, onFocusHandled])
  return (
    <form
      className={cn(
        'w-[240px] max-w-[calc(100%-16px)] rounded-[8px] border border-foreground/30 bg-background p-2 shadow-thin',
        className,
      )}
      data-testid="notes-comments-compose"
      style={top == null ? undefined : { position: 'absolute', top }}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {quote ? (
        <p className="mb-1 truncate px-1 text-[11px] italic text-foreground/80">“{quote}”</p>
      ) : null}
      <textarea
        ref={composeRef}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel?.()
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmit()
          }
        }}
        aria-label={t('notes.comments.title')}
        rows={3}
        placeholder={quote ? t('notes.comments.placeholderOnSelection') : t('notes.comments.placeholder')}
        className={cn(
          'w-full resize-none rounded-[6px] border border-foreground/30 bg-background px-2 py-1.5 text-[12px] outline-none',
          'focus:border-foreground/55',
        )}
      />
      <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">{t('notes.comments.submitHint')}</p>
      <button
        type="submit"
        disabled={!body.trim()}
        className="mt-1.5 h-7 w-full rounded-[5px] bg-foreground/12 text-[11px] font-medium text-foreground hover:bg-foreground/18 disabled:opacity-40"
      >
        {t('notes.comments.add')}
      </button>
    </form>
  )
}

export function NotesCommentTooltip({
  comment,
  top,
  left,
}: {
  comment: NoteComment
  top: number
  left: number
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[240px] rounded-[6px] border border-foreground/25 bg-background px-2.5 py-2 text-[12px] shadow-thin"
      data-testid="notes-comment-tooltip"
      style={{ top, left }}
      role="tooltip"
    >
      {comment.quote ? <p className="mb-1 truncate italic text-foreground/80">“{comment.quote}”</p> : null}
      <p className="leading-relaxed text-foreground">{comment.body}</p>
    </div>
  )
}

export function NotesComments({
  noteId,
  draftQuote,
  onClearDraft,
  markdownComments,
  onCommit,
  onJumpToQuote,
  width,
  composerTop,
  draftBody,
  onDraftBodyChange,
  focusRequested,
  onFocusHandled,
}: {
  noteId: string
  draftQuote: string
  onClearDraft: () => void
  markdownComments?: NoteComment[]
  onCommit?: (comments: NoteComment[]) => void
  onJumpToQuote?: (quote: string) => void
  width?: number
  composerTop?: number
  draftBody?: string
  onDraftBodyChange?: (body: string) => void
  focusRequested?: boolean
  onFocusHandled?: () => void
}) {
  const { t } = useTranslation()
  const [localComments, setComments] = React.useState<NoteComment[]>(() => markdownComments ?? loadNoteComments(noteId))
  const comments = markdownComments ?? localComments
  const [localBody, setLocalBody] = React.useState('')
  const body = draftBody ?? localBody
  const setBody = onDraftBodyChange ?? setLocalBody

  React.useEffect(() => {
    setComments(markdownComments ?? loadNoteComments(noteId))
  }, [markdownComments, noteId])

  React.useEffect(() => setLocalBody(''), [noteId])

  const add = React.useCallback(() => {
    const text = body.trim()
    if (!text) return
    const next: NoteComment[] = [
      ...comments,
      { id: crypto.randomUUID(), quote: draftQuote.trim(), body: text, createdAt: Date.now() },
    ]
    setComments(next)
    if (!markdownComments) saveNoteComments(noteId, next)
    onCommit?.(next)
    setBody('')
    onClearDraft()
  }, [body, comments, draftQuote, markdownComments, noteId, onClearDraft, onCommit, setBody])

  return (
    <aside className="relative flex shrink-0 flex-col border-l border-foreground/25 bg-background" style={{ width: width ?? 220 }} data-testid="notes-comments-rail">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-foreground/20 px-3 text-[10px] font-medium uppercase tracking-wider text-foreground/70">
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t('notes.comments.title')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {comments.length === 0 && !draftQuote ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('notes.comments.empty')}
          </p>
        ) : null}
        {comments.map((comment) => (
          <article key={comment.id} className="mb-3 rounded-[6px] border border-foreground/25 bg-background px-2.5 py-2">
            {comment.quote ? (
              <button
                type="button"
                className="mb-1 block w-full truncate text-left text-[11px] italic text-foreground/80 hover:text-foreground"
                onClick={() => onJumpToQuote?.(comment.quote)}
                aria-label={t('notes.comments.jumpToQuote')}
              >
                “{comment.quote}”
              </button>
            ) : null}
            <p className="text-[12px] leading-relaxed text-foreground">{comment.body}</p>
          </article>
        ))}
      </div>
      {draftQuote ? (
        <NotesCommentComposer
          className="absolute right-2 z-10"
          top={composerTop ?? 48}
          quote={draftQuote}
          body={body}
          onBodyChange={setBody}
          onSubmit={add}
          onCancel={() => { setBody(''); onClearDraft() }}
          focusRequested={focusRequested}
          onFocusHandled={onFocusHandled}
        />
      ) : null}
    </aside>
  )
}

export function NotesCommentHighlights({
  comments,
  hidden,
  contentKey,
  onActivate,
  editorRef,
}: {
  comments: NoteComment[]
  hidden: boolean
  contentKey: string
  editorRef?: React.RefObject<HTMLElement | null>
  onActivate: (comment: NoteComment, rect: DOMRect) => void
}) {
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const [hits, setHits] = React.useState<Array<{ id: string; top: number; left: number; width: number; height: number }>>([])

  React.useLayoutEffect(() => {
    const editor = editorRef?.current ?? overlayRef.current?.closest<HTMLElement>('.notes-editor')
    if (!editor) return
    let frame = 0
    const measure = () => {
      frame = 0
      const root = editor.querySelector('.ProseMirror')
      if (!root || editor.getClientRects().length === 0) { setHits([]); return }
      const editorBox = editor.getBoundingClientRect()
      const next: Array<{ id: string; top: number; left: number; width: number; height: number }> = []
      for (const comment of comments) {
        const quote = comment.quote.trim()
        if (!quote) continue
        const walker = editor.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? ''
          const index = text.indexOf(quote)
          if (index < 0) continue
          const range = editor.ownerDocument.createRange()
          range.setStart(node, index)
          range.setEnd(node, Math.min(text.length, index + quote.length))
          for (const rect of Array.from(range.getClientRects())) {
            next.push({ id: comment.id, top: rect.top - editorBox.top + editor.scrollTop, left: rect.left - editorBox.left + editor.scrollLeft, width: rect.width, height: rect.height })
          }
          break
        }
      }
      setHits(next)
    }
    const invalidate = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(invalidate)
    observer.observe(editor)
    editor.addEventListener('load', invalidate, true)
    invalidate()
    return () => {
      observer.disconnect()
      editor.removeEventListener('load', invalidate, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [comments, contentKey, editorRef])

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[1]" data-testid="notes-comment-highlights">
      {hits.map((hit, index) => {
        const comment = comments.find((item) => item.id === hit.id)
        if (!comment) return null
        return (
          <button
            key={`${hit.id}:${index}`}
            type="button"
            className="notes-comment-hl pointer-events-auto absolute border-0 p-0"
            style={{ top: hit.top, left: hit.left, width: hit.width, height: hit.height }}
            aria-label={comment.body}
            title={hidden ? comment.body : undefined}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (hidden) onActivate(comment, event.currentTarget.getBoundingClientRect())
            }}
          />
        )
      })}
    </div>
  )
}
