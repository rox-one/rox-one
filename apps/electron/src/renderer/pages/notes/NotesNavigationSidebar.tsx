import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, Copy, ExternalLink, FilePlus2, FileText, Folder, FolderInput, FolderOpen, Link2, Moon, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteSummary } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { WindowedTreeList } from '@/components/ui/entity-list'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'

/** Above this many rows the vault tree switches to windowed rendering. */
export const NOTES_TREE_WINDOW_THRESHOLD = 200
/** Measured vault row height until the ResizeObserver reports the real one. */
export const NOTES_TREE_ROW_ESTIMATE = 44

export interface FolderTreeNode {
  fullPath: string
  name: string
  children: FolderTreeNode[]
  notes: NoteSummary[]
}

function noteFolder(note: NoteSummary): string {
  return note.id.slice(0, Math.max(0, note.id.lastIndexOf('/')))
}

export function buildFolderTree(notes: NoteSummary[]): { rootNotes: NoteSummary[]; folders: FolderTreeNode[] } {
  const rootNotes: NoteSummary[] = []
  const nodeMap = new Map<string, FolderTreeNode>()
  for (const note of notes) {
    const folder = noteFolder(note)
    if (!folder) {
      rootNotes.push(note)
      continue
    }
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const fullPath = segments.slice(0, i).join('/')
      if (!nodeMap.has(fullPath)) {
        nodeMap.set(fullPath, { fullPath, name: segments[i - 1]!, children: [], notes: [] })
      }
    }
    nodeMap.get(folder)!.notes.push(note)
  }
  const folders: FolderTreeNode[] = []
  for (const node of nodeMap.values()) {
    const parentPath = node.fullPath.slice(0, node.fullPath.lastIndexOf('/'))
    if (node.fullPath.includes('/')) nodeMap.get(parentPath)!.children.push(node)
    else folders.push(node)
  }
  function sort(nodes: FolderTreeNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) sort(node.children)
  }
  sort(folders)
  return { rootNotes, folders }
}

function countFolderNotes(node: FolderTreeNode): number {
  return node.notes.length + node.children.reduce((sum, child) => sum + countFolderNotes(child), 0)
}

/** One rendered row of the flattened vault tree. */
export type NotesTreeRow =
  | { kind: 'note'; key: string; note: NoteSummary; depth: number }
  | { kind: 'folder'; key: string; node: FolderTreeNode; depth: number; expanded: boolean }

/**
 * Maps the active note id to the row key used by `WindowedTreeList` (see
 * `getKey={(row) => row.key}` below and the `note:` namespace of
 * `flattenNotesTree`). `WindowedTreeList` resolves a reveal by looking up the
 * entry `row:<scrollToKey>`, so the caller MUST pass the full row key — a raw
 * note id would never match and the off-window reveal would silently no-op.
 */
export function notesScrollToKey(activeNoteId: string | null | undefined): string | null {
  return activeNoteId ? `note:${activeNoteId}` : null
}

/**
 * Flattens the folder tree into render order (root notes, then folders
 * depth-first), omitting the children of collapsed folders. This is the input
 * for both the plain and the windowed rendering path.
 */
export function flattenNotesTree(
  tree: { rootNotes: NoteSummary[]; folders: FolderTreeNode[] },
  collapsedFolders: ReadonlySet<string>,
): NotesTreeRow[] {
  const rows: NotesTreeRow[] = []
  for (const note of tree.rootNotes) {
    rows.push({ kind: 'note', key: notesScrollToKey(note.id)!, note, depth: 0 })
  }
  const walk = (node: FolderTreeNode, depth: number) => {
    const expanded = !collapsedFolders.has(node.fullPath)
    rows.push({ kind: 'folder', key: `folder:${node.fullPath}`, node, depth, expanded })
    if (!expanded) return
    for (const child of node.children) walk(child, depth + 1)
    for (const note of node.notes) {
      rows.push({ kind: 'note', key: notesScrollToKey(note.id)!, note, depth: depth + 2 })
    }
  }
  for (const node of tree.folders) walk(node, 0)
  return rows
}

interface NoteNavigationActions {
  onOpenNote(noteId: string): void
  onOpenCreateNoteDialog(folder?: string): void
  onOpenRenameFolder(folder: string): void
  onOpenDeleteFolder(folder: string): void
  onOpenMoveDialog(note: NoteSummary): void
  onOpenRenameDialogForNote(note: NoteSummary): void
  onOpenDeleteDialogForNote(note: NoteSummary): void
  onDuplicateNote(note: NoteSummary): void
  onCollectToMemory(note: NoteSummary): void
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
  /** Note ids awaiting the next memory dream; null/undefined hides the dream chip. */
  dreamNoteIds?: ReadonlySet<string> | null
  /** Scroll parent used for windowed rendering of very large vaults. */
  viewportRef?: React.RefObject<HTMLDivElement | null>
}

export type NoteDreamState = 'pending' | 'dreamed'

/** Dream chip state for a note; null hides the chip while the dream status is unknown. */
export function noteDreamState(dreamNoteIds: ReadonlySet<string> | null | undefined, noteId: string): NoteDreamState | null {
  if (!dreamNoteIds) return null
  return dreamNoteIds.has(noteId) ? 'pending' : 'dreamed'
}

function NoteNavigationItem({ note, depth, activeNoteId, dreamNoteIds, ...actions }: NoteNavigationActions & {
  note: NoteSummary
  depth: number
  activeNoteId: NotesNavigationSidebarProps['activeNoteId']
  dreamNoteIds?: ReadonlySet<string> | null
}) {
  const { t } = useTranslation()
  const dreamState = noteDreamState(dreamNoteIds, note.id)
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
          aria-current={activeNoteId === note.id ? 'page' : undefined}
          data-note-id={note.id}
          onClick={() => actions.onOpenNote(note.id)}
          style={{ paddingLeft: `${10 + depth * 12}px` }}
          className={cn(
            'notes-list-item mb-0.5 w-full rounded-[var(--radius-control)] pr-2.5 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring',
            activeNoteId === note.id && 'notes-list-item-active',
            isDragging && 'opacity-50',
          )}
          {...attributes}
          {...listeners}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="icon-caption shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
          </span>
          {dreamState ? (
            <span className="mt-1 flex flex-wrap gap-1 pl-5">
              <span
                data-testid="notes-dream-chip"
                data-dream-state={dreamState}
                className={cn(
                  'rounded-[var(--radius-control)] px-1.5 py-0.5 text-caption',
                  dreamState === 'pending' ? 'bg-status-warning/10 text-status-warning' : 'bg-foreground/[0.06] text-muted-foreground',
                )}
              >
                {t(dreamState === 'pending' ? 'notes.sleep.pending' : 'notes.sleep.dreamed')}
              </span>
            </span>
          ) : null}
          {note.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1 pl-5">
              {note.tags.slice(0, 3).map(tag => (
                <span key={tag} className="rounded-[var(--radius-control)] bg-foreground/[0.06] px-1.5 py-0.5 text-caption text-muted-foreground">#{tag}</span>
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
        <StyledContextMenuItem onClick={() => actions.onCollectToMemory(note)}>
          <Moon className="h-3.5 w-3.5" />{t('notes.action.collectToMemory')}
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

/**
 * A folder row of the flattened tree: the expand/collapse disclosure and the
 * drop target live on this button (the old nested `<details>` is gone, so the
 * row is a sibling of its children).
 */
function FolderNavigationItem({ node, depth, expanded, onToggleFolder, ...actions }: NoteNavigationActions & {
  node: FolderTreeNode
  depth: number
  expanded: boolean
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
          aria-expanded={expanded}
          data-notes-folder={node.fullPath}
          title={node.fullPath}
          onClick={() => onToggleFolder(node.fullPath)}
          className={cn(
            'mb-0.5 flex h-7 w-full cursor-pointer items-center gap-1 rounded-[var(--radius-control)] pr-2 text-sm font-medium text-muted-foreground outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring',
            isOver && 'ring-2 ring-primary/40 bg-primary/[0.06]',
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <ChevronRight className={cn('icon-caption shrink-0 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden="true" />
          <FolderIcon className={cn('icon-inline shrink-0', depth === 0 ? 'text-status-warning' : depth === 1 ? 'text-status-info' : 'text-status-success')} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
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

export function NotesNavigationSidebar({ notes, emptyMessage, viewportRef, ...props }: NotesNavigationSidebarProps) {
  const tree = React.useMemo(() => buildFolderTree(notes), [notes])
  const rows = React.useMemo(
    () => flattenNotesTree(tree, props.collapsedFolders),
    [tree, props.collapsedFolders],
  )
  const renderRow = React.useCallback(
    (row: NotesTreeRow) =>
      row.kind === 'folder' ? (
        <FolderNavigationItem
          node={row.node}
          depth={row.depth}
          expanded={row.expanded}
          {...props}
        />
      ) : (
        <NoteNavigationItem note={row.note} depth={row.depth} {...props} />
      ),
    [props],
  )
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
        <WindowedTreeList<NotesTreeRow>
          rows={rows}
          getKey={(row) => row.key}
          renderRow={renderRow}
          rowHeight={NOTES_TREE_ROW_ESTIMATE}
          windowThreshold={NOTES_TREE_WINDOW_THRESHOLD}
          {...(viewportRef ? { viewportRef } : {})}
          scrollToKey={notesScrollToKey(props.activeNoteId)}
        />
      ) : <div className="px-3 py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>}
    </>
  )
}