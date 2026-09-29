import * as React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Note reading surface: tone steps instead of borders. Side panels (notes
 * list, СОДЕРЖАНИЕ, КОММЕНТАРИИ) sit one step off the page tone; the content
 * column is the page itself. Title/headings are full-contrast, body text a
 * notch softer, secondary UI muted. Flat — no outlines or white rules.
 */
export function NotesEditorHeadlineStyles() {
  return (
    <style>{`
      .notes-shell {
        background: var(--background);
      }
      .notes-side-surface {
        background: color-mix(in oklab, var(--foreground) 4%, var(--background));
      }
      .notes-content-surface {
        background: var(--background);
      }
      .notes-list-item-active {
        background: color-mix(in oklab, var(--accent) 16%, transparent);
        color: var(--foreground);
      }
      .notes-list-item-active svg {
        color: var(--accent);
      }
      .notes-list-item-active .truncate {
        font-weight: 600;
      }
      .notes-editor .ProseMirror {
        color: color-mix(in oklab, var(--foreground) 84%, transparent);
        font-size: 15px;
        line-height: 1.7;
      }
      .notes-editor-prose .ProseMirror > :first-child {
        color: var(--foreground);
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
        margin-top: 0;
        margin-bottom: 1.5rem;
      }
      .notes-editor-prose .ProseMirror h1,
      .notes-editor-prose .ProseMirror h2,
      .notes-editor-prose .ProseMirror h3 {
        color: var(--foreground);
        letter-spacing: -0.01em;
      }
      .notes-editor-prose .ProseMirror h1:not(:first-child) {
        font-size: 1.6rem;
        font-weight: 700;
        line-height: 1.2;
        margin: 2.25rem 0 0.75rem;
      }
      .notes-editor-prose .ProseMirror h2 {
        font-size: 1.3rem;
        font-weight: 650;
        line-height: 1.25;
        margin: 2rem 0 0.6rem;
      }
      .notes-editor-prose .ProseMirror h3 {
        font-size: 1.08rem;
        font-weight: 600;
        line-height: 1.3;
        margin: 1.5rem 0 0.4rem;
      }
      .notes-editor-prose .ProseMirror p {
        margin: 0 0 0.85em;
      }
      .notes-editor-prose .ProseMirror ul,
      .notes-editor-prose .ProseMirror ol {
        margin: 0.25em 0 1em;
      }
      .notes-editor-prose .ProseMirror li + li {
        margin-top: 0.2em;
      }
      .notes-editor-prose .ProseMirror li::marker {
        color: color-mix(in oklab, var(--foreground) 45%, transparent);
      }
      .notes-editor-prose .ProseMirror blockquote {
        color: color-mix(in oklab, var(--foreground) 70%, transparent);
        background: color-mix(in oklab, var(--foreground) 3.5%, transparent);
        border: 0;
        border-radius: 6px;
        padding: 0.5em 0.9em;
      }
      .notes-editor-prose .ProseMirror hr {
        border: 0;
        height: 1px;
        background: color-mix(in oklab, var(--foreground) 8%, transparent);
        margin: 2rem 0;
      }
      [data-testid="notes-toc-rail"] button:hover,
      [data-testid="notes-comments-rail"] article {
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
  localStorage.setItem(commentsKey(noteId), JSON.stringify(comments))
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
      className="notes-side-surface sticky top-0 flex shrink-0 flex-col self-stretch overflow-y-auto px-3 py-4"
      style={{ width: width ?? 180 }}
      data-testid="notes-toc-rail"
    >
      <div className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">
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
}: {
  quote: string
  body: string
  onBodyChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  top?: number
  className?: string
}) {
  const { t } = useTranslation()
  const composeRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    composeRef.current?.focus()
  }, [quote])
  return (
    <form
      className={cn(
        'w-[240px] rounded-[8px] border border-foreground/[0.08] bg-background p-2 shadow-thin',
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
        rows={3}
        placeholder={quote ? t('notes.comments.placeholderOnSelection') : t('notes.comments.placeholder')}
        className={cn(
          'w-full resize-none rounded-[6px] border border-foreground/[0.08] bg-background px-2 py-1.5 text-[12px] outline-none',
          'focus-visible:border-foreground/40',
        )}
      />
      <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">{t('notes.comments.submitHint')}</p>
      <button
        type="submit"
        disabled={!body.trim()}
        className="mt-1.5 h-7 w-full rounded-[6px] bg-foreground/12 text-[11px] font-medium text-foreground hover:bg-foreground/18 disabled:opacity-40"
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
      className="pointer-events-none absolute z-20 max-w-[240px] rounded-[6px] border border-foreground/[0.08] bg-background px-2.5 py-2 text-[12px] shadow-thin"
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
}: {
  noteId: string
  draftQuote: string
  onClearDraft: () => void
  markdownComments?: NoteComment[]
  onCommit?: (comments: NoteComment[]) => void
  onJumpToQuote?: (quote: string) => void
  width?: number
  composerTop?: number
}) {
  const { t } = useTranslation()
  const [comments, setComments] = React.useState<NoteComment[]>(() => markdownComments ?? loadNoteComments(noteId))
  const [body, setBody] = React.useState('')

  React.useEffect(() => {
    setComments(markdownComments ?? loadNoteComments(noteId))
    setBody('')
  }, [markdownComments, noteId])

  const add = React.useCallback(() => {
    const text = body.trim()
    if (!text) return
    const next: NoteComment[] = [
      ...comments,
      { id: crypto.randomUUID(), quote: draftQuote.trim(), body: text, createdAt: Date.now() },
    ]
    setComments(next)
    saveNoteComments(noteId, next)
    onCommit?.(next)
    setBody('')
    onClearDraft()
  }, [body, comments, draftQuote, noteId, onClearDraft, onCommit])

  return (
    <aside className="notes-side-surface relative flex shrink-0 flex-col" style={{ width: width ?? 220 }} data-testid="notes-comments-rail">
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">
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
          <article key={comment.id} className="mb-2 rounded-[6px] bg-foreground/[0.05] px-2.5 py-2">
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
          onCancel={onClearDraft}
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
}: {
  comments: NoteComment[]
  hidden: boolean
  contentKey: string
  onActivate: (comment: NoteComment, rect: DOMRect) => void
}) {
  const [hits, setHits] = React.useState<Array<{ id: string; top: number; left: number; width: number; height: number }>>([])

  React.useLayoutEffect(() => {
    const root = document.querySelector('.notes-editor .ProseMirror') as HTMLElement | null
    const editor = document.querySelector('.notes-editor') as HTMLElement | null
    if (!root || !editor) {
      setHits([])
      return
    }
    const editorBox = editor.getBoundingClientRect()
    const next: Array<{ id: string; top: number; left: number; width: number; height: number }> = []
    for (const comment of comments) {
      const quote = comment.quote.trim()
      if (!quote) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? ''
        const idx = text.indexOf(quote)
        if (idx < 0) continue
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, Math.min(text.length, idx + quote.length))
        for (const rect of Array.from(range.getClientRects())) {
          next.push({
            id: comment.id,
            top: rect.top - editorBox.top + editor.scrollTop,
            left: rect.left - editorBox.left + editor.scrollLeft,
            width: rect.width,
            height: rect.height,
          })
        }
        break
      }
    }
    setHits(next)
  }, [comments, contentKey])

  if (hits.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" data-testid="notes-comment-highlights">
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
