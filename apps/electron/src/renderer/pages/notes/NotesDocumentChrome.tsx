import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { notesRailKeyWidth } from './notes-layout'
import {
  NOTES_RAIL_STORAGE_KEY,
  groupNoteCommands,
  matchNoteCommands,
  noteBreadcrumbs,
  noteCommandGroupKey,
  noteCommandLabelKey,
  parseNotesRailLayout,
  serializeNotesRailLayout,
  type NoteCommandItem,
  type NotesRailLayout,
} from './document-ia'

export function useNotesRailLayout(): [NotesRailLayout, (patch: Partial<NotesRailLayout>) => void] {
  const [layout, setLayout] = React.useState<NotesRailLayout>(() =>
    {
      try { return parseNotesRailLayout(typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTES_RAIL_STORAGE_KEY)) }
      catch { return parseNotesRailLayout(null) }
    },
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
          {index === crumbs.length - 1 ? <span aria-current="page" className="min-w-0 truncate px-1 font-medium text-foreground" title={crumb.label}>{crumb.label}</span> : <button
            type="button"
            className={cn(
              'rox-control max-w-[9rem] truncate px-1 hover:text-foreground',
              index === crumbs.length - 1 && 'font-medium text-foreground',
            )}
            onClick={() => {
              if (crumb.id === 'vault') onOpenFolder?.(undefined)
              else if (crumb.folder) onOpenFolder?.(crumb.folder)
            }}
          >
            {crumb.id === 'vault' ? t('notes.breadcrumb.vault') : crumb.label}
          </button>}
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
  maximumWidth = 480,
}: {
  width: number
  onWidth: (width: number) => void
  invert?: boolean
  collapsed?: boolean
  onToggle?: () => void
  label: string
  maximumWidth?: number
}) {
  const cleanupRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => () => cleanupRef.current?.(), [])
  return (
    <div className="relative z-10 w-0 shrink-0">
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={140}
        aria-valuemax={maximumWidth}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize bg-transparent hover:bg-foreground/15 focus-visible:bg-accent/40 focus-visible:outline-none"
        onDoubleClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onToggle?.(); return }
          const next = notesRailKeyWidth(width, event.key, invert, event.shiftKey)
          if (next != null) { event.preventDefault(); onWidth(Math.min(maximumWidth, next)) }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || collapsed) return
          event.preventDefault()
          cleanupRef.current?.()
          event.currentTarget.focus()
          const origin = event.clientX
          const start = width
          const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return
            const delta = invert ? origin - next.clientX : next.clientX - origin
            onWidth(start + delta)
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', up)
            window.removeEventListener('blur', up)
            window.removeEventListener('keydown', keyDown)
            cleanupRef.current = null
          }
          const keyDown = (key: KeyboardEvent) => {
            if (key.key !== 'Escape') return
            key.preventDefault()
            onWidth(start)
            up()
          }
          cleanupRef.current = up
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
          window.addEventListener('pointercancel', up)
          window.addEventListener('blur', up)
          window.addEventListener('keydown', keyDown)
        }}
      />
    </div>
  )
}

export function NotesCommandPalette({
  query,
  items,
  activeIndex,
  onSelect,
  onClose,
}: {
  query: string
  items: readonly NoteCommandItem[]
  activeIndex?: number
  onSelect: (item: NoteCommandItem) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const matches = matchNoteCommands(query, items)
  const groups = groupNoteCommands(matches)
  const flat = groups.flatMap((group) => group.items)
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => setIndex(0), [query])
  const selected = activeIndex ?? index
  if (flat.length === 0) return null
  let offset = 0
  return (
    <div
      className="notes-authoring-palette absolute z-30 w-80 rounded-[8px] border border-foreground/35 bg-popover p-1 shadow-strong"
      role="listbox"
      aria-label={t('notes.palette.title')}
      data-testid="notes-command-palette"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setIndex((value) => Math.min(value + 1, flat.length - 1))
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setIndex((value) => Math.max(value - 1, 0))
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const item = flat[selected]
          if (item) onSelect(item)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {groups.map((group) => {
        const start = offset
        offset += group.items.length
        return (
          <div key={group.subject} data-testid={`notes-command-group-${group.subject}`}>
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground/70">
              {t(noteCommandGroupKey(group.subject))}
            </div>
            {group.items.map((item, itemIndex) => {
              const flatIndex = start + itemIndex
              const labelKey = noteCommandLabelKey(item)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]',
                    flatIndex === selected && 'bg-foreground/[0.10] text-foreground',
                  )}
                  onClick={() => onSelect(item)}
                >
                  <span className="truncate">{labelKey ? t(labelKey) : item.label}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">{item.insert}</span>
                </button>
              )
            })}
          </div>
        )
      })}
      <div className="border-t border-foreground/20 px-2 py-1 text-[10px] text-foreground/70">
        {t('notes.palette.hint')}
      </div>
    </div>
  )
}
