import * as React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function NotesEditorHeadlineStyles() {
  return (
    <style>{`
      .notes-editor-prose .ProseMirror > :first-child {
        font-size: 1.75rem;
        font-weight: 600;
        letter-spacing: -0.025em;
        line-height: 1.2;
        margin-bottom: 1.25rem;
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

export function NotesToc({ markdown, onJump }: { markdown: string; onJump: (text: string) => void }) {
  const { t } = useTranslation()
  const headings = React.useMemo(() => extractHeadings(markdown), [markdown])
  return (
    <aside className="sticky top-0 flex w-[180px] shrink-0 flex-col self-stretch overflow-y-auto border-r border-border/50 px-3 py-4">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {t('notes.toc.title')}
      </div>
      {headings.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground/50">
          {t('notes.toc.empty')}
        </p>
      ) : (
        <nav className="flex flex-col gap-0.5">
          {headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              onClick={() => onJump(heading.text)}
              className="rounded-[4px] px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              style={{ paddingLeft: 6 + (heading.level - 1) * 10 }}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}

export function NotesComments({
  noteId,
  draftQuote,
  onClearDraft,
}: {
  noteId: string
  draftQuote: string
  onClearDraft: () => void
}) {
  const { t } = useTranslation()
  const [comments, setComments] = React.useState<NoteComment[]>(() => loadNoteComments(noteId))
  const [body, setBody] = React.useState('')

  React.useEffect(() => {
    setComments(loadNoteComments(noteId))
    setBody('')
  }, [noteId])

  const add = React.useCallback(() => {
    const text = body.trim()
    if (!text) return
    const next: NoteComment[] = [
      ...comments,
      { id: crypto.randomUUID(), quote: draftQuote.trim(), body: text, createdAt: Date.now() },
    ]
    setComments(next)
    saveNoteComments(noteId, next)
    setBody('')
    onClearDraft()
  }, [body, comments, draftQuote, noteId, onClearDraft])

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-l border-border/50">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/50 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t('notes.comments.title')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {comments.length === 0 && !draftQuote ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground/50">
            {t('notes.comments.empty')}
          </p>
        ) : null}
        {comments.map((comment) => (
          <article key={comment.id} className="mb-3 rounded-[6px] border border-border/50 bg-background px-2.5 py-2">
            {comment.quote ? (
              <p className="mb-1 truncate text-[11px] italic text-muted-foreground/70">“{comment.quote}”</p>
            ) : null}
            <p className="text-[12px] leading-relaxed text-foreground/90">{comment.body}</p>
          </article>
        ))}
      </div>
      <form
        className="shrink-0 border-t border-border/50 p-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        {draftQuote ? (
          <p className="mb-1 truncate px-1 text-[11px] italic text-muted-foreground/70">“{draftQuote}”</p>
        ) : null}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          placeholder={draftQuote ? t('notes.comments.placeholderOnSelection') : t('notes.comments.placeholder')}
          className={cn(
            'w-full resize-none rounded-[6px] border border-border/60 bg-background px-2 py-1.5 text-[12px] outline-none',
            'focus:border-foreground/30',
          )}
        />
        <button
          type="submit"
          disabled={!body.trim()}
          className="mt-1.5 h-7 w-full rounded-[5px] bg-foreground/10 text-[11px] font-medium text-foreground/80 hover:bg-foreground/15 disabled:opacity-40"
        >
          {t('notes.comments.add')}
        </button>
      </form>
    </aside>
  )
}
