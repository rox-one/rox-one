/**
 * Quick composer surface — the standalone window loaded with
 * `?surface=quick-composer` (no app shell). Captures one thought and saves it
 * into the existing note or personal-task pipelines:
 *
 * - note → `electronAPI.createNote` (+ `saveNote` for the full body)
 * - task → `createPersonalTaskConfirmed` (the same awaited path the Tasks
 *   screen and the Home quick-add use)
 *
 * ⏎ saves and closes, Shift+⏎ inserts a newline, Esc closes.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, NotebookPen, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'
import { setPersonalTaskScope } from '@/lib/personal-tasks'
import { nativeIntegrations } from '@/platform/native-integrations'

type ComposeMode = 'note' | 'task'

function closeSurface(): void {
  const api = nativeIntegrations()
  if (api.quickComposer?.close) {
    void api.quickComposer.close()
    return
  }
  window.close()
}

/** First non-empty line becomes the note title; the full text becomes its body. */
function noteTitleFrom(text: string): string {
  const line = text.split('\n').map((value) => value.trim()).find((value) => value.length > 0)
  return (line ?? '').slice(0, 120)
}

export function QuickComposerSurface() {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<ComposeMode>('note')
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // The composer window may or may not be assigned a workspace by main; fall
  // back to the first available workspace so capture still works.
  React.useEffect(() => {
    let active = true
    void (async () => {
      try {
        const assigned = await window.electronAPI.getWindowWorkspace()
        if (assigned) {
          if (active) setWorkspaceId(assigned)
          return
        }
      } catch { /* fall through to the workspace list */ }
      try {
        const workspaces = await window.electronAPI.getWorkspaces()
        if (active) setWorkspaceId(workspaces[0]?.id ?? null)
      } catch { /* stays null → save reports failure */ }
    })()
    return () => { active = false }
  }, [])

  const createNote = React.useCallback(async (workspace: string, body: string) => {
    const title = noteTitleFrom(body) || t('notes.untitled')
    const note = await window.electronAPI.createNote(workspace, title)
    if (body.trim() && body.trim() !== title) {
      await window.electronAPI.saveNote(workspace, note.id, body, note.revision)
    }
  }, [t])

  const createTask = React.useCallback(async (workspace: string | null, body: string) => {
    const identity = await window.electronAPI.getOrgIdentity()
    setPersonalTaskScope({
      authority: identity.authority,
      userId: identity.userId,
      issuer: identity.issuer,
      workspaceId: workspace,
    })
    const [title, ...rest] = body.split('\n')
    await createPersonalTaskConfirmed({ title: title.trim(), notes: rest.join('\n').trim(), list: 'inbox' })
  }, [])

  const submit = React.useCallback(async () => {
    if (busy) return
    const body = text.trim()
    if (!body) {
      setError(t('quickComposer.emptyError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'task') {
        await createTask(workspaceId, body)
      } else if (workspaceId) {
        await createNote(workspaceId, body)
      } else {
        throw new Error('workspace unavailable')
      }
      setDone(true)
      window.setTimeout(closeSurface, 220)
    } catch (cause) {
      console.warn('[quick-composer] save failed', cause)
      setError(t('quickComposer.saveFailed'))
      setBusy(false)
    }
  }, [busy, createNote, createTask, mode, t, text, workspaceId])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSurface()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Dropping files from Finder imports them through the notes asset pipeline;
  // only note mode has a note to attach into.
  const handleDrop = React.useCallback(async (event: React.DragEvent) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0 || mode !== 'note' || !workspaceId || busy) return
    setBusy(true)
    setError(null)
    try {
      const snippets: string[] = []
      for (const file of files) {
        const path = window.electronAPI.getFilePath(file)
        if (!path) continue
        const attachment = await window.electronAPI.readUserAttachment(path)
        if (!attachment) continue
        const result = await window.electronAPI.importNoteAsset(workspaceId, attachment)
        snippets.push(result.markdown)
      }
      if (snippets.length > 0) {
        setText((prev) => (prev.trim() ? `${prev}\n${snippets.join('\n')}` : snippets.join('\n')))
      }
    } catch (cause) {
      console.warn('[quick-composer] drop import failed', cause)
      setError(t('quickComposer.dropFailed'))
    } finally {
      setBusy(false)
    }
  }, [busy, mode, t, workspaceId])

  const modes: Array<{ value: ComposeMode; label: string; icon: React.ReactNode }> = [
    { value: 'note', label: t('quickComposer.modeNote'), icon: <NotebookPen className="icon-caption" /> },
    { value: 'task', label: t('quickComposer.modeTask'), icon: <CircleCheck className="icon-caption" /> },
  ]

  return (
    <div className="flex min-h-screen w-full items-start justify-center bg-transparent p-3" data-surface="quick-composer">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('quickComposer.title')}
        data-testid="quick-composer-surface"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={(event) => void handleDrop(event)}
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border/50 bg-background/85 shadow-strong backdrop-blur-xl"
      >
        <div className="flex items-center gap-1 border-b border-border/40 px-3 py-2">
          <div role="radiogroup" aria-label={t('quickComposer.modeLabel')} className="inline-flex gap-0.5 rounded-[var(--radius-control)] bg-surface-input p-0.5">
            {modes.map((option) => {
              const selected = option.value === mode
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy}
                  onClick={() => setMode(option.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-body transition-colors duration-[var(--motion-fast)]',
                    selected ? 'bg-surface-elevated shadow-minimal' : 'hover:bg-surface-hover',
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          disabled={busy}
          onChange={(event) => { setText(event.target.value); if (error) setError(null) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void submit()
          }}
          rows={4}
          placeholder={mode === 'task' ? t('quickComposer.taskPlaceholder') : t('quickComposer.notePlaceholder')}
          aria-label={mode === 'task' ? t('quickComposer.taskPlaceholder') : t('quickComposer.notePlaceholder')}
          data-testid="quick-composer-input"
          className="min-h-[96px] resize-none bg-transparent px-3 py-2.5 text-reading text-foreground outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
          <span className={cn('min-w-0 flex-1 truncate text-caption', error ? 'text-destructive' : 'text-muted-foreground')} role={error ? 'alert' : undefined}>
            {error
              ?? (done
                ? t(mode === 'task' ? 'quickComposer.taskSaved' : 'quickComposer.noteSaved')
                : t('quickComposer.hint'))}
          </span>
          <button
            type="button"
            disabled={busy || done || text.trim().length === 0}
            onClick={() => void submit()}
            data-testid="quick-composer-save"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-body font-medium text-[var(--accent-foreground,white)] disabled:opacity-50"
          >
            {busy && <LoaderCircle className="icon-caption animate-spin" />}
            {t(mode === 'task' ? 'quickComposer.saveTask' : 'quickComposer.saveNote')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuickComposerSurface