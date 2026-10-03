import * as React from 'react'
import { AlertTriangle, LoaderCircle, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { PersonalTaskCreationError } from '../../lib/personal-tasks-sync'
import './quick-task-input.css'

/** The Home inbox shortcut: one awaited submit path, with local focus styling. */
export function QuickTaskInput({ onCreate, disabled = false }: {
  onCreate: (title: string, previousAttempt?: PersonalTask) => Promise<PersonalTask>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState('')
  const [added, setAdded] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [keyboardFocus, setKeyboardFocus] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const pointerFocus = React.useRef(false)
  const composing = React.useRef(false)
  const submitting = React.useRef(false)
  const retryTask = React.useRef<PersonalTask>()
  const messageId = React.useId()
  const helpId = React.useId()
  const hasTitle = Boolean(draft.trim())

  React.useEffect(() => {
    if (!added) return
    const timer = window.setTimeout(() => setAdded(null), 2500)
    return () => window.clearTimeout(timer)
  }, [added])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = draft.trim()
    if (disabled || submitting.current || composing.current || !title) return
    // Ref closes the same-tick Enter/click race before React renders pending.
    submitting.current = true
    setPending(true)
    setFailed(false)
    setAdded(null)
    try {
      await onCreate(title, retryTask.current)
      retryTask.current = undefined
      setDraft('')
      setAdded(title)
    } catch (error) {
      if (error instanceof PersonalTaskCreationError) retryTask.current = error.task
      console.warn('[home] quick add task failed', error)
      setFailed(true)
    } finally {
      submitting.current = false
      setPending(false)
      input.current?.focus()
    }
  }

  return (
    <>
      <form
        className="rox-home-quick-task flex items-center gap-1 rounded-[6px] px-1.5"
        onSubmit={submit}
        data-home-quick-add=""
        data-error={failed || undefined}
        data-disabled={disabled || undefined}
        data-pending={pending || undefined}
        data-keyboard-focus={keyboardFocus || undefined}
        aria-disabled={disabled || undefined}
        aria-busy={pending || undefined}
        onPointerDown={() => {
          pointerFocus.current = true
          setKeyboardFocus(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            pointerFocus.current = false
            setKeyboardFocus(true)
          }
          if (event.key === 'Escape') setHelpOpen(false)
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            pointerFocus.current = false
            setKeyboardFocus(false)
            setHelpOpen(false)
          }
        }}
      >
        <span className="rox-home-quick-task-marker" aria-hidden="true" />
        {failed
          ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
          : pending
            ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            : <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <input
          ref={input}
          value={draft}
          disabled={disabled}
          readOnly={pending}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setKeyboardFocus(!pointerFocus.current)}
          onKeyDown={(event) => {
            // IME Enter confirms the composition; it must not create a task.
            if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
              event.preventDefault()
            }
          }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          placeholder={t('workbench.home.taskTracker.quickAdd')}
          aria-label={t('workbench.home.taskTracker.quickAdd')}
          aria-invalid={failed || undefined}
          aria-describedby={`${messageId} ${helpId}`}
          className="rox-home-quick-task-input h-7 min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={disabled || pending || !hasTitle}
          className="rox-home-quick-task-add flex h-6 shrink-0 items-center whitespace-nowrap rounded-[6px] px-2 text-[12px] font-bold text-foreground"
          data-empty={!hasTitle || undefined}
          onFocus={() => { if (!pointerFocus.current) setKeyboardFocus(true) }}
        >
          {t(pending ? 'workbench.home.taskTracker.adding' : 'workbench.home.taskTracker.add')}
        </button>
        <span className="rox-home-quick-task-help-wrap shrink-0" data-open={helpOpen || undefined}>
          <button
            type="button"
            disabled={disabled}
            className="rox-home-quick-task-help h-6 w-6 rounded-[6px] text-[12px] text-muted-foreground"
            aria-label={t('workbench.home.taskTracker.quickAddHelpLabel')}
            aria-describedby={helpId}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((open) => !open)}
            onFocus={() => { if (!pointerFocus.current) setKeyboardFocus(true) }}
          >
            <span aria-hidden="true">?</span>
          </button>
          <span id={helpId} role="tooltip" className="rox-home-quick-task-help-text">
            {t('workbench.home.taskTracker.quickAddHelp')}
          </span>
        </span>
      </form>
      <p id={messageId} className={`h-4 truncate text-[11px] leading-4 ${failed ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">
        {failed ? t('workbench.home.taskTracker.addFailed') : pending ? t('workbench.home.taskTracker.quickAddPending') : added ? t('workbench.home.taskTracker.added', { title: added }) : ''}
      </p>
    </>
  )
}
