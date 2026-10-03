/**
 * Quick Entry (⌘N on Задачи): title with Russian/English natural-language
 * dates («завтра», «в пт», «через неделю», «до 15 окт», «в 10:00», «#тег»,
 * «каждый пн»), notes, and a live preview of what was recognised. Enter
 * saves, ⌘Enter saves and opens, Esc closes.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PremiumMenuSelect } from '@rox/ui'
import { parseTaskEntry, type ParsedTaskEntry, type TaskArea, type TaskProject } from '@rox/core/tasks/personal'
import { Overlay } from './parts'
import { formatHotkeyDisplay } from '@/lib/platform'

export interface QuickEntryResult {
  parsed: ParsedTaskEntry
  notes: string
  open: boolean
  projectId: string | null
  areaId: string | null
  checklistItems: string[]
}

export function QuickEntry({
  onClose,
  onSubmit,
  destinationLabel,
  projects,
  areas,
  initialProjectId,
  initialAreaId,
  now,
  initialText = '',
}: {
  onClose: () => void
  onSubmit: (result: QuickEntryResult) => void
  destinationLabel: string
  projects: readonly TaskProject[]
  areas: readonly TaskArea[]
  initialProjectId?: string | null
  initialAreaId?: string | null
  now: number
  initialText?: string
}) {
  const { t, i18n } = useTranslation()
  const [text, setText] = React.useState(initialText)
  const [notes, setNotes] = React.useState('')
  const [projectId, setProjectId] = React.useState(initialProjectId ?? '')
  const [areaId, setAreaId] = React.useState(initialAreaId ?? '')
  const [checklistText, setChecklistText] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { inputRef.current?.focus() }, [])
  const parsed = React.useMemo(() => parseTaskEntry(text, now), [text, now])
  const dateFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }), [i18n.language])
  const timeFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }), [i18n.language])

  const submit = (open: boolean) => {
    if (!parsed.title.trim()) return
    onSubmit({
      parsed,
      notes,
      open,
      projectId: projectId || null,
      areaId: areaId || null,
      checklistItems: checklistText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    })
  }

  const whenLabel = (() => {
    switch (parsed.when) {
      case 'today': return t('tasks.when.today')
      case 'evening': return t('tasks.when.evening')
      case 'anytime': return t('tasks.when.anytime')
      case 'someday': return t('tasks.when.someday')
      case 'date': return parsed.startAt != null ? dateFmt.format(parsed.startAt) + (parsed.evening ? ` · ${t('tasks.when.evening')}` : '') : null
      default: return null
    }
  })()

  const chips: Array<{ key: string; label: string }> = []
  if (whenLabel) chips.push({ key: 'when', label: `${t('tasks.field.when')}: ${whenLabel}` })
  if (parsed.deadlineAt != null) chips.push({ key: 'deadline', label: `${t('tasks.field.deadline')}: ${dateFmt.format(parsed.deadlineAt)}` })
  if (parsed.reminderAt != null) chips.push({ key: 'reminder', label: `${t('tasks.field.reminder')}: ${dateFmt.format(parsed.reminderAt)} ${timeFmt.format(parsed.reminderAt)}` })
  if (parsed.recurrence) chips.push({ key: 'repeat', label: `${t('tasks.field.repeat')}: ${t(`tasks.recurrence.${parsed.recurrence.rule}`)}` })
  for (const tag of parsed.tags) chips.push({ key: `tag-${tag}`, label: `#${tag}` })

  return (
    <Overlay onClose={onClose} label={t('tasks.quickEntry.title')} testId="tasks-quick-entry">
      <form
        className="flex flex-col gap-1 px-4 pb-3 pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit(false)
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit(true)
            }
          }}
          placeholder={t('tasks.quickEntry.placeholder')}
          aria-label={t('tasks.quickEntry.placeholder')}
          data-testid="tasks-quick-entry-input"
          className="h-8 bg-transparent text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-text-muted"
        />
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('tasks.notesPlaceholder')}
          aria-label={t('tasks.notes')}
          rows={3}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit(false)
            }
          }}
          className="resize-none bg-transparent text-[13px] leading-5 outline-none placeholder:text-text-muted"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-text-muted">
            {t('tasks.quickEntry.project')}
            <PremiumMenuSelect
              aria-label={t('tasks.quickEntry.project')}
              className="h-7 w-full max-w-none"
              items={[
                { id: '', label: t('tasks.quickEntry.none') },
                ...projects.map((project) => ({ id: project.id, label: project.name })),
              ]}
              placeholder={t('tasks.quickEntry.none')}
              selectedId={projectId || undefined}
              onSelect={(item) => setProjectId(item.id)}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-text-muted">
            {t('tasks.quickEntry.area')}
            <PremiumMenuSelect
              aria-label={t('tasks.quickEntry.area')}
              className="h-7 w-full max-w-none"
              items={[
                { id: '', label: t('tasks.quickEntry.none') },
                ...areas.map((area) => ({ id: area.id, label: area.name })),
              ]}
              placeholder={t('tasks.quickEntry.none')}
              selectedId={areaId || undefined}
              onSelect={(item) => setAreaId(item.id)}
            />
          </label>
        </div>
        <textarea
          value={checklistText}
          onChange={(event) => setChecklistText(event.target.value)}
          placeholder={t('tasks.quickEntry.checklistItems')}
          aria-label={t('tasks.quickEntry.checklistItems')}
          rows={2}
          className="resize-none rounded-[6px] bg-foreground/[0.03] px-2 py-1 text-[12px] leading-5 outline-none placeholder:text-text-muted"
        />
        <div className="flex min-h-6 flex-wrap items-center gap-1" aria-live="polite" data-testid="tasks-quick-entry-preview">
          {chips.length ? chips.map((chip) => (
            <span key={chip.key} className="inline-flex h-[20px] items-center rounded-[4px] bg-accent/15 px-1.5 text-[11px] font-medium text-foreground">{chip.label}</span>
          )) : <span className="text-[11px] text-text-muted">{t('tasks.quickEntry.hint')}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="min-w-0 flex-1 truncate">{t('tasks.quickEntry.destination', { name: destinationLabel })}</span>
          <span className="shrink-0">{t('tasks.quickEntry.keys', { saveAndOpen: formatHotkeyDisplay('mod+enter') })}</span>
          <button
            type="submit"
            disabled={!parsed.title.trim()}
            data-testid="tasks-quick-entry-save"
            className="h-7 shrink-0 rounded-[6px] bg-accent px-3 text-[12px] font-semibold text-[var(--accent-foreground,white)] disabled:opacity-50"
          >
            {t('tasks.quickEntry.save')}
          </button>
        </div>
      </form>
    </Overlay>
  )
}
