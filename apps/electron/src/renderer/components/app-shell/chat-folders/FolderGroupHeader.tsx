import * as React from 'react'
import { ChevronRight, Folder, FolderOpen, FolderPlus, Inbox, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'

export interface FolderGroupHeaderProps {
  kind: 'folder' | 'ungrouped'
  label: string
  count: number
  isCollapsed: boolean
  isDropTarget: boolean
  /** Show the Ungrouped drop affordance (a chat from a folder is being dragged). */
  isDragging?: boolean
  onToggle?: () => void
  onDragOver: (event: React.DragEvent) => void
  onNewFolder: () => void
  onRename?: () => void
  onDelete?: () => void
  elementRef?: React.Ref<HTMLElement>
  style?: React.CSSProperties
}

/**
 * DeepSeek-Harness-style folder row inside the chat list: chevron, folder
 * icon, name, count. The Ungrouped variant is a section header (not
 * collapsible) that doubles as the "remove from folder" drop target.
 * Plain button semantics (aria-expanded) — the list itself is a listbox.
 */
export function FolderGroupHeader({
  kind, label, count, isCollapsed, isDropTarget, isDragging, onToggle, onDragOver,
  onNewFolder, onRename, onDelete, elementRef, style,
}: FolderGroupHeaderProps) {
  const { t } = useTranslation()
  if (kind === 'ungrouped') {
    return (
      <div
        ref={elementRef as React.Ref<HTMLDivElement>}
        style={style}
        data-folder-header="ungrouped"
        onDragOver={onDragOver}
        className={cn(
          'sticky top-0 z-[var(--z-sticky)] flex items-center gap-1.5 bg-background px-5 py-2',
          isDragging && 'mx-2 rounded-[var(--radius-card)] border border-dashed border-border-subtle',
          isDropTarget && 'border-border-strong bg-surface-hover',
        )}
      >
        <Inbox className="icon-status text-muted-foreground/60" aria-hidden />
        <span className="flex-1 text-caption font-medium uppercase caps-label text-text-secondary">
          {label} <> · <span className="text-muted-foreground/50 numeric">{count}</span></>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onNewFolder}
              aria-label={t('chatFolders.newFolder')}
              className="rounded-full p-1 text-muted-foreground/70 hover:bg-surface-hover hover:text-foreground"
            >
              <FolderPlus className="icon-caption" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('chatFolders.newFolder')}</TooltipContent>
        </Tooltip>
      </div>
    )
  }
  const Icon = isCollapsed ? Folder : FolderOpen
  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <button
          ref={elementRef as React.Ref<HTMLButtonElement>}
          style={style}
          type="button"
          data-folder-header="folder"
          aria-expanded={!isCollapsed}
          onClick={onToggle}
          onDragOver={onDragOver}
          className="group/header sticky top-0 z-[var(--z-sticky)] flex w-full cursor-pointer items-center gap-1.5 bg-background px-5 py-1.5 text-left"
        >
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0.5 left-2 right-2 rounded-[var(--radius-card)] transition-colors duration-[var(--motion-fast)] group-hover/header:bg-surface-hover',
              isDropTarget && 'bg-surface-hover ring-1 ring-border-strong',
            )}
          />
          <ChevronRight
            aria-hidden
            className={cn(
              'relative icon-status text-muted-foreground/60 transition-transform duration-[var(--motion-fast)]',
              !isCollapsed && 'rotate-90',
            )}
          />
          <Icon aria-hidden className="relative icon-caption text-muted-foreground" />
          <span className="relative min-w-0 flex-1 truncate text-body font-medium text-foreground">{label}</span>
          <span className="relative text-caption numeric text-muted-foreground/60">{count}</span>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        {onRename && (
          <StyledContextMenuItem onSelect={onRename}>
            <Pencil />{t('chatFolders.rename')}
          </StyledContextMenuItem>
        )}
        <StyledContextMenuItem onSelect={onNewFolder}>
          <FolderPlus />{t('chatFolders.newFolder')}
        </StyledContextMenuItem>
        {onDelete && (
          <>
            <StyledContextMenuSeparator />
            <StyledContextMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />{t('chatFolders.delete')}
            </StyledContextMenuItem>
          </>
        )}
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
