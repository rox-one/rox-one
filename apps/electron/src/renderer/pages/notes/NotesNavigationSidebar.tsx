import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, Copy, ExternalLink, FilePlus2, FileText, Folder, FolderInput, FolderOpen, Link2, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteSummary } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'

interface FolderTreeNode {
  fullPath: string
  name: string
  children: FolderTreeNode[]
  notes: NoteSummary[]
}

function noteFolder(note: NoteSummary): string {
  return note.id.slice(0, Math.max(0, note.id.lastIndexOf('/')))
}

function buildFolderTree(notes: NoteSummary[]): { rootNotes: NoteSummary[]; folders: FolderTreeNode[] } {
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

function NoteNavigationItem({ note, depth, activeNoteId, ...actions }: NoteNavigationActions & {
  note: NoteSummary
  depth: number
  activeNoteId: NotesNavigationSidebarProps['activeNoteId']
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
          aria-current={activeNoteId === note.id ? 'page' : undefined}
          data-note-id={note.id}
          onClick={() => actions.onOpenNote(note.id)}
          style={{ paddingLeft: `${10 + depth * 12}px`, contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
          className={cn(
            'notes-list-item mb-0.5 w-full rounded-[6px] pr-2.5 py-1.5 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-1 focus-visible:ring-ring',
            activeNoteId === note.id && 'notes-list-item-active',
            isDragging && 'opacity-50',
          )}
          {...attributes}
          {...listeners}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
          </span>
          {note.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1 pl-5">
              {note.tags.slice(0, 3).map(tag => (
                <span key={tag} className="rounded-[4px] bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
              ))}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={() => actions.onOpenNote(note.id)}>
          <FileText className="h-3.5 w-3.5" />{t('common.open')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenRenameDialogForNote(note)}>
          <Pencil className="h-3.5 w-3.5" />{t('common.rename')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenCreateNoteDialog(noteFolder(note) || undefined)}>
          <FilePlus2 className="h-3.5 w-3.5" />{t('notes.menu.newHere')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onDuplicateNote(note)}>
          <Copy className="h-3.5 w-3.5" />{t('notes.menu.duplicate')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenMoveDialog(note)}>
          <FolderInput className="h-3.5 w-3.5" />{t('notes.menu.moveToFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={() => actions.onCopyNoteLink(note)}>
          <Link2 className="h-3.5 w-3.5" />{t('notes.menu.copyLink')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onCopyNotePath(note)}>
          <FileText className="h-3.5 w-3.5" />{t('notes.menu.copyPath')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onRevealNote(note)}>
          <ExternalLink className="h-3.5 w-3.5" />{t('notes.menu.reveal')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem variant="destructive" onClick={() => actions.onOpenDeleteDialogForNote(note)}>
          <Trash2 className="h-3.5 w-3.5" />{t('common.delete')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function FolderNavigationItem({ node, depth, activeNoteId, collapsedFolders, onToggleFolder, ...actions }: Omit<NotesNavigationSidebarProps, 'notes' | 'emptyMessage'> & {
  node: FolderTreeNode
  depth: number
}) {
  const { t } = useTranslation()
  const expanded = !collapsedFolders.has(node.fullPath)
  const contentId = React.useId()
  const { isOver, setNodeRef } = useDroppable({
    id: `folder:${node.fullPath}`,
    data: { type: 'folder', folder: node.fullPath },
  })
  const FolderIcon = expanded ? FolderOpen : Folder
  return (
    <ContextMenu>
      <details
        open={expanded}
        data-notes-folder={node.fullPath}
        data-notes-disclosure
        onToggle={(event) => {
          if (event.target === event.currentTarget && event.currentTarget.open !== expanded) onToggleFolder(node.fullPath)
        }}
      >
        <ContextMenuTrigger asChild>
          <summary
            ref={setNodeRef}
            aria-expanded={expanded}
            aria-controls={contentId}
            title={node.fullPath}
            onClick={(event) => {
              event.preventDefault()
              onToggleFolder(node.fullPath)
            }}
            className={cn(
              'mb-0.5 flex h-7 cursor-pointer list-none items-center gap-1 rounded-[6px] pr-2 text-sm font-medium text-muted-foreground outline-none hover:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
              isOver && 'ring-2 ring-primary/40 bg-primary/[0.06]',
            )}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden="true" />
            <FolderIcon className={cn('h-4 w-4 shrink-0', depth === 0 ? 'text-amber-500' : depth === 1 ? 'text-orange-500' : 'text-teal-500')} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <span className="text-xs text-muted-foreground/50 tabular-nums">{countFolderNotes(node)}</span>
          </summary>
        </ContextMenuTrigger>
        <div id={contentId}>
          {node.children.map(child => (
            <FolderNavigationItem key={child.fullPath} node={child} depth={depth + 1} activeNoteId={activeNoteId}
              collapsedFolders={collapsedFolders} onToggleFolder={onToggleFolder} {...actions} />
          ))}
          {node.notes.map(note => (
            <NoteNavigationItem key={note.id} note={note} depth={depth + 2} activeNoteId={activeNoteId} {...actions} />
          ))}
        </div>
      </details>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={() => actions.onOpenCreateNoteDialog(node.fullPath)}>
          <FilePlus2 className="h-3.5 w-3.5" />{t('notes.menu.newInFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={() => actions.onOpenRenameFolder(node.fullPath)}>
          <Pencil className="h-3.5 w-3.5" />{t('notes.menu.renameFolder')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem variant="destructive" onClick={() => actions.onOpenDeleteFolder(node.fullPath)}>
          <Trash2 className="h-3.5 w-3.5" />{t('notes.menu.deleteFolder')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

export function NotesNavigationSidebar({ notes, emptyMessage, ...props }: NotesNavigationSidebarProps) {
  const tree = React.useMemo(() => buildFolderTree(notes), [notes])
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
      `}</style>
      {notes.length ? (
        <>
          {tree.rootNotes.map(note => <NoteNavigationItem key={note.id} note={note} depth={0} {...props} />)}
          {tree.folders.map(node => <FolderNavigationItem key={node.fullPath} node={node} depth={0} {...props} />)}
        </>
      ) : <div className="px-3 py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>}
    </>
  )
}
