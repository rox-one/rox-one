import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  NOTES_RAIL_STORAGE_KEY,
  matchNoteCommands,
  noteBreadcrumbs,
  parseNotesRailLayout,
  serializeNotesRailLayout,
  type NoteCommandItem,
  type NotesRailLayout,
} from './document-ia'

export function useNotesRailLayout(): [NotesRailLayout, (patch: Partial<NotesRailLayout>) => void] {
  const [layout, setLayout] = React.useState<NotesRailLayout>(() =>
    parseNotesRailLayout(typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTES_RAIL_STORAGE_KEY)),
  )

  const update = React.useCallback((patch: Partial<NotesRailLayout>) => {
    setLayout((prev) => {
      const next = parseNotesRailLayout(JSON.stringify({ ...prev, ...patch }))
      try {
        localStorage.setItem(NOTES_RAIL_STORAGE_KEY, serializeNotesRailLayout(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }, [])

  return [layout, update]
}

export function NotesBreadcrumbs({
  noteId,
  title,
  onOpenFolder,
}: {
  noteId: string
  title: string
  onOpenFolder?: (folder?: string) => void
}) {
  const { t } = useTranslation()
  const crumbs = noteBreadcrumbs(noteId, title)
  return (
    <nav className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground" aria-label={t('notes.breadcrumb.label')}>
      {crumbs.map((crumb, index) => (
        <React.Fragment key={crumb.id}>
          {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 opacity-50" /> : null}
          <button
            type="button"
            className={cn(
              'max-w-[9rem] truncate rounded-[4px] px-1 py-0.5 hover:bg-foreground/[0.06] hover:text-foreground',
              index === crumbs.length - 1 && 'font-medium text-foreground',
            )}
            onClick={() => {
              if (crumb.id === 'vault') onOpenFolder?.(undefined)
              else if (crumb.folder) onOpenFolder?.(crumb.folder)
            }}
          >
            {crumb.id === 'vault' ? t('notes.breadcrumb.vault') : crumb.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}

export function NotesRailSash({
  width,
  onWidth,
  invert,
  collapsed,
  onToggle,
  label,
}: {
  width: number
  onWidth: (width: number) => void
  invert?: boolean
  collapsed?: boolean
  onToggle?: () => void
  label: string
}) {
  return (
    <div className="relative z-10 w-0 shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={collapsed}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize bg-transparent hover:bg-foreground/15"
        onDoubleClick={onToggle}
        onPointerDown={(event) => {
          event.preventDefault()
          const origin = event.clientX
          const start = width
          const move = (next: PointerEvent) => {
            const delta = invert ? origin - next.clientX : next.clientX - origin
            onWidth(start + delta)
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
    </div>
  )
}

export function NotesCommandPalette({
  query,
  items,
  onSelect,
  onClose,
}: {
  query: string
  items: readonly NoteCommandItem[]
  onSelect: (item: NoteCommandItem) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const matches = matchNoteCommands(query, items)
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => setIndex(0), [query])
  if (matches.length === 0) return null
  return (
    <div
      className="absolute z-30 w-80 rounded-[8px] border border-border/70 bg-popover p-1 shadow-strong"
      role="listbox"
      aria-label={t('notes.command.title')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setIndex((value) => Math.min(value + 1, matches.length - 1))
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setIndex((value) => Math.max(value - 1, 0))
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const item = matches[index]
          if (item) onSelect(item)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {matches.map((item, itemIndex) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            'flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]',
            itemIndex === index && 'bg-foreground/[0.08]',
          )}
          onClick={() => onSelect(item)}
        >
          <span className="truncate">{item.label}</span>
          <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">{item.insert}</span>
        </button>
      ))}
    </div>
  )
}
