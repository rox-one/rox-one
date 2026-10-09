import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, Copy, ExternalLink, FilePlus2, FileText, Folder, FolderInput, FolderOpen, Link2, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteSummary } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'
import { revealEntryScrollTop, virtualEntryIndices } from '@/components/app-shell/entity-list-virtualization'
import {
  buildFolderTree,
  countFolderNotes,
  flattenNotesNavigation,
  noteEntryIndexById,
  noteFolder,
  notesNavigationWindow,
  NOTES_ROW_GAP,
  type NotesNavEntry,
  type NotesNavFolderNode,
} from './notes-navigation-virtualization'

interface NoteNavigationActions {
  onOpenNote(noteId: string): void
  onOpenCreateNoteDialog(folder?: string): void
  onOpenRenameFolder(folder: string): void
  onOpenDeleteFolder(folder: string): void
  onOpenMoveDialog(note: NoteSummary): void
  onOpenRenameDialogForNote(note: NoteSummary): void
  onOpenDeleteDialogForNote(note: NoteSummary): void
  onDuplicateNote(note: NoteSummary): void
  onCopyNoteLink(note: NoteSummary): void
  onCopyNotePath(note: NoteSummary): void
  onRevealNote(note: NoteSummary): void
}

interface NotesNavigationSidebarProps extends NoteNavigationActions {
  notes: NoteSummary[]
  activeNoteId: string | null | undefined
  collapsedFolders: Set<string>
  onToggleFolder(folder: string): void
  emptyMessage: string
}

function NoteNavigationItem({ note, depth, activeNoteId, entryIndex, onFocusEntry, ...actions }: NoteNavigationActions & {
  note: NoteSummary
  depth: number
  activeNoteId: NotesNavigationSidebarProps['activeNoteId']
  entryIndex: number
  onFocusEntry: (index: number) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `note:${note.id}`,
    data: { type: 'note', note },
  })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={setNodeRef}
          type="button"
          data-notes-entry-index={entryIndex}
          aria-current={activeNoteId === note.id ? 'page' : undefined}
          data-note-id={note.id}
          onFocus={() => onFocusEntry(entryIndex)}
          onClick={() => actions.onOpenNote(note.id)}
          style={{ paddingLeft: `${10 + depth * 12}px` }}
          className={cn(
            'notes-list-item w-full rounded-[var(--radius-control)] pr-2.5 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring',
            activeNoteId === note.id && 'notes-list-item-active',
            isDragging && 'opacity-50',
          )}
          {...attributes}
          {...listeners}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="icon-caption shrink-0 text-sky-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
          </span>
          {note.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1 pl-5">
              {note.tags.slice(0, 3).map(tag => (
                <span key={tag} className="rounded-[var(--radius-control)] bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
              ))}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={() => actions.onOpenNote(note.id)}>
          <FileText className="icon-caption" />{t('common.open')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenRenameDialogForNote(note)}>
          <Pencil className="icon-caption" />{t('common.rename')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenCreateNoteDialog(noteFolder(note) || undefined)}>
          <FilePlus2 className="icon-caption" />{t('notes.menu.newHere')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onDuplicateNote(note)}>
          <Copy className="icon-caption" />{t('notes.menu.duplicate')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenMoveDialog(note)}>
          <FolderInput className="icon-caption" />{t('notes.menu.moveToFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={() => actions.onCopyNoteLink(note)}>
          <Link2 className="icon-caption" />{t('notes.menu.copyLink')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onCopyNotePath(note)}>
          <FileText className="icon-caption" />{t('notes.menu.copyPath')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onRevealNote(note)}>
          <ExternalLink className="icon-caption" />{t('notes.menu.reveal')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem variant="destructive" onClick={() => actions.onOpenDeleteDialogForNote(note)}>
          <Trash2 className="icon-caption" />{t('common.delete')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function FolderNavigationItem({ node, depth, expanded, entryIndex, onFocusEntry, onToggleFolder, ...actions }: NoteNavigationActions & {
  node: NotesNavFolderNode
  depth: number
  expanded: boolean
  entryIndex: number
  onFocusEntry: (index: number) => void
  onToggleFolder(folder: string): void
}) {
  const { t } = useTranslation()
  const { isOver, setNodeRef } = useDroppable({
    id: `folder:${node.fullPath}`,
    data: { type: 'folder', folder: node.fullPath },
  })
  const FolderIcon = expanded ? FolderOpen : Folder
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={setNodeRef}
          type="button"
          data-notes-entry-index={entryIndex}
          aria-expanded={expanded}
          data-notes-folder={node.fullPath}
          title={node.fullPath}
          onFocus={() => onFocusEntry(entryIndex)}
          onClick={() => onToggleFolder(node.fullPath)}
          className={cn(
            'flex h-7 w-full cursor-pointer items-center gap-1 rounded-[var(--radius-control)] pr-2 text-left text-sm font-medium text-muted-foreground outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring',
            isOver && 'ring-2 ring-primary/40 bg-primary/[0.06]',
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <ChevronRight className={cn('icon-caption shrink-0 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden="true" />
          <FolderIcon className={cn('icon-inline shrink-0', depth === 0 ? 'text-amber-500' : depth === 1 ? 'text-orange-500' : 'text-teal-500')} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground/50 tabular-nums">{countFolderNotes(node)}</span>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={() => actions.onOpenCreateNoteDialog(node.fullPath)}>
          <FilePlus2 className="icon-caption" />{t('notes.menu.newInFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenRenameFolder(node.fullPath)}>
          <Pencil className="icon-caption" />{t('notes.menu.renameFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem variant="destructive" onClick={() => actions.onOpenDeleteFolder(node.fullPath)}>
          <Trash2 className="icon-caption" />{t('notes.menu.deleteFolder')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

/** Locate the scrollable ancestor the sidebar is rendered into. */
function findScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let element = node?.parentElement ?? null
  while (element) {
    const overflowY = getComputedStyle(element).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return element
    element = element.parentElement
  }
  return null
}

export function NotesNavigationSidebar({ notes, emptyMessage, collapsedFolders, onToggleFolder, activeNoteId, ...actions }: NotesNavigationSidebarProps) {
  const tree = React.useMemo(() => buildFolderTree(notes), [notes])
  const hostRef = React.useRef<HTMLDivElement>(null)
  const scrollParentRef = React.useRef<HTMLElement | null>(null)
  const [metrics, setMetrics] = React.useState({ scrollTop: 0, height: 0 })
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [measuredHeights, setMeasuredHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map())

  const flattened = React.useMemo(
    () =>
      flattenNotesNavigation(tree.rootNotes, tree.folders, {
        collapsedFolders,
        getNoteHeight: (note) => {
          const measured = measuredHeights.get(note.id)
          return measured != null && measured > 0 ? measured + NOTES_ROW_GAP : undefined
        },
      }),
    [tree, collapsedFolders, measuredHeights],
  )

  // --- Row measurement (note id → content height) ---
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const observedRef = React.useRef(new Map<Element, string>())
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setMeasuredHeights((previous) => {
        let next: Map<string, number> | null = null
        for (const entry of entries) {
          const id = observedRef.current.get(entry.target)
          if (!id) continue
          const height = Math.ceil(entry.contentRect.height)
          if (height <= 0 || previous.get(id) === height) continue
          next ??= new Map(previous)
          next.set(id, height)
        }
        return next ?? previous
      })
    })
    observerRef.current = observer
    for (const element of observedRef.current.keys()) observer.observe(element)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [])

  const refCallbacks = React.useRef(new Map<string, (element: HTMLDivElement | null) => void>())
  const measureRef = React.useCallback((id: string) => {
    let callback = refCallbacks.current.get(id)
    if (!callback) {
      let current: HTMLDivElement | null = null
      callback = (element: HTMLDivElement | null) => {
        if (current && current !== element) {
          observerRef.current?.unobserve(current)
          observedRef.current.delete(current)
        }
        current = element
        if (element) {
          observedRef.current.set(element, id)
          observerRef.current?.observe(element)
        }
      }
      refCallbacks.current.set(id, callback)
    }
    return callback
  }, [])

  // --- Scroll viewport (the sidebar renders into an ancestor scroll div) ---
  React.useLayoutEffect(() => {
    const parent = findScrollableAncestor(hostRef.current)
    scrollParentRef.current = parent
    if (!parent) return
    const update = () => {
      setMetrics((previous) => {
        const next = { scrollTop: parent.scrollTop, height: parent.clientHeight }
        return previous.scrollTop === next.scrollTop && previous.height === next.height ? previous : next
      })
    }
    update()
    parent.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(parent)
    return () => {
      parent.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [])

  React.useLayoutEffect(() => {
    const host = hostRef.current
    const parent = scrollParentRef.current
    if (!host || !parent) return
    const box = host.getBoundingClientRect()
    const parentBox = parent.getBoundingClientRect()
    const next = box.top - parentBox.top + parent.scrollTop
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [metrics.scrollTop, metrics.height, flattened.totalHeight])

  const keyIndex = React.useMemo(() => noteEntryIndexById(flattened.entries), [flattened.entries])

  const baseWindow = notesNavigationWindow(flattened.entries, listOffsetTop, metrics.scrollTop, metrics.height)
  const visibleIndices = virtualEntryIndices(
    baseWindow,
    flattened.entries.length,
    activeIndex >= 0 ? [activeIndex] : [],
  )

  const scrollEntryIntoView = React.useCallback((entry: NotesNavEntry) => {
    const parent = scrollParentRef.current
    const host = hostRef.current
    if (!parent || !host) return
    const offsetTop = host.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    parent.scrollTop = revealEntryScrollTop(entry, offsetTop, parent.scrollTop, parent.clientHeight)
  }, [])

  // Reveal the active note (external navigation / initial mount). Entries and
// the index map are read through a ref so row measurements during scrolling do
// not re-trigger the reveal.
  const navigationRef = React.useRef({ entries: flattened.entries, keyIndex })
  navigationRef.current = { entries: flattened.entries, keyIndex }
  React.useEffect(() => {
    if (!activeNoteId) return
    const { entries, keyIndex: index } = navigationRef.current
    const entryIndex = index.get(activeNoteId)
    if (entryIndex == null) return
    const entry = entries[entryIndex]
    if (entry) scrollEntryIntoView(entry)
  }, [activeNoteId, scrollEntryIntoView])

  // Roving arrow navigation across the full entry list (not just the window).
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const row = target.closest<HTMLElement>('[data-notes-entry-index]')
    if (!row) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const last = flattened.entries.length - 1
    if (last < 0) return
    const current = Number(row.dataset.notesEntryIndex ?? '0')
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown'
          ? (current + 1) % flattened.entries.length
          : (current - 1 + flattened.entries.length) % flattened.entries.length
    event.preventDefault()
    event.stopPropagation()
    if (next === current) return
    setActiveIndex(next)
    const entry = flattened.entries[next]
    if (entry) scrollEntryIntoView(entry)
    requestAnimationFrame(() => {
      hostRef.current?.querySelector<HTMLElement>(`[data-notes-entry-index="${next}"]`)?.focus()
    })
  }, [flattened.entries, scrollEntryIntoView])

  return (
    <>
      <style>{`
        [data-notes-disclosure]::details-content {
          block-size: 0;
          opacity: 0;
          content-visibility: hidden;
          overflow: hidden;
          interpolate-size: allow-keywords;
          transition: block-size 160ms ease, opacity 160ms ease, content-visibility 160ms allow-discrete;
        }
        /* Reveal controls immediately when opening so arrow navigation can focus them during the height animation. */
        [data-notes-disclosure][open]::details-content {
          block-size: auto;
          opacity: 1;
          content-visibility: visible;
          transition: block-size 160ms ease, opacity 160ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-notes-disclosure]::details-content,
          [data-notes-disclosure][open]::details-content { transition: none; }
        }
        html[data-render-profile="performance"] [data-notes-disclosure]::details-content { transition: none; }
        html[data-render-profile="performance"] [data-notes-disclosure][open]::details-content { transition: none; }
      `}</style>
      {notes.length ? (
        <div ref={hostRef} className="relative" style={{ height: flattened.totalHeight }} onKeyDown={handleKeyDown}>
          {visibleIndices.map((entryIndex) => {
            const entry = flattened.entries[entryIndex]!
            return (
              <div key={entry.key} className="absolute left-0 right-0" style={{ top: entry.offset }}>
                {entry.kind === 'folder' ? (
                  <FolderNavigationItem
                    node={entry.folder}
                    depth={entry.depth}
                    expanded={!collapsedFolders.has(entry.folder.fullPath)}
                    entryIndex={entryIndex}
                    onFocusEntry={setActiveIndex}
                    onToggleFolder={onToggleFolder}
                    {...actions}
                  />
                ) : (
                  <div ref={measureRef(entry.note.id)}>
                    <NoteNavigationItem
                      note={entry.note}
                      depth={entry.depth}
                      activeNoteId={activeNoteId}
                      entryIndex={entryIndex}
                      onFocusEntry={setActiveIndex}
                      {...actions}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : <div className="px-3 py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>}
    </>
  )
}