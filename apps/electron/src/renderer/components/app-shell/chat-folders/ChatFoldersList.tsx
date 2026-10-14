import * as React from 'react'
import { formatDistanceToNowStrict, type Locale } from 'date-fns'
import { ChevronRight, Folder, FolderInput, FolderOpen, FolderPlus, Inbox, Pencil, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
  StyledContextMenuSub,
  StyledContextMenuSubContent,
  StyledContextMenuSubTrigger,
} from '@/components/ui/styled-context-menu'
import { useChatFolders } from '@/hooks/useChatFolders'
import { getSessionTitle, shortTimeLocale } from '@/utils/session'
import type { SessionMeta } from '@/atoms/sessions'
import { buildFolderView, CHAT_FOLDER_DRAG_MIME, folderKey, newChatFolderId, readCollapsedFolders } from './chat-folders-model'

export interface ChatFoldersListProps {
  workspaceId: string | undefined
  items: SessionMeta[]
  selectedSessionId?: string | null
  onSessionSelect: (item: SessionMeta) => void
}

type DialogState =
  | { mode: 'create'; moveSessionId?: string }
  | { mode: 'rename'; folderId: string }
  | null

function relativeTime(ts: number | undefined): string {
  if (!ts) return ''
  return formatDistanceToNowStrict(new Date(ts), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
}

/** DeepSeek-Harness-style folder tree for chats ("Ungrouped" bucket last). */
export function ChatFoldersList({ workspaceId, items, selectedSessionId, onSessionSelect }: ChatFoldersListProps) {
  const { t } = useTranslation()
  const { state, mutate, error } = useChatFolders(workspaceId)
  const [query, setQuery] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [dialogName, setDialogName] = React.useState('')
  const [dropTarget, setDropTarget] = React.useState<string | null>(null)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => readCollapsedFolders(storage.get<unknown>(storage.KEYS.chatFoldersCollapsed, [], workspaceId ?? '')),
  )

  React.useEffect(() => {
    setCollapsed(readCollapsedFolders(storage.get<unknown>(storage.KEYS.chatFoldersCollapsed, [], workspaceId ?? '')))
  }, [workspaceId])

  const toggle = React.useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      storage.set(storage.KEYS.chatFoldersCollapsed, [...next], workspaceId ?? '')
      return next
    })
  }, [workspaceId])

  const groups = React.useMemo(
    () => buildFolderView(items, state, query, getSessionTitle),
    [items, state, query],
  )
  const searching = query.trim().length > 0

  const moveTo = React.useCallback((sessionId: string, folderId: string | null) => {
    void mutate({ kind: 'move', sessionIds: [sessionId], folderId })
  }, [mutate])

  const submitDialog = React.useCallback(async () => {
    const name = dialogName.trim()
    if (!dialog || !name) return
    if (dialog.mode === 'create') {
      const id = newChatFolderId()
      const ok = await mutate({ kind: 'create', name, id })
      if (ok && dialog.moveSessionId) await mutate({ kind: 'move', sessionIds: [dialog.moveSessionId], folderId: id })
    } else {
      await mutate({ kind: 'rename', folderId: dialog.folderId, name })
    }
    setDialog(null)
  }, [dialog, dialogName, mutate])

  const openCreate = (moveSessionId?: string) => { setDialogName(''); setDialog({ mode: 'create', moveSessionId }) }

  const onDrop = (e: React.DragEvent, folderId: string | null) => {
    const sid = e.dataTransfer.getData(CHAT_FOLDER_DRAG_MIME)
    setDropTarget(null)
    if (!sid) return
    e.preventDefault()
    moveTo(sid, folderId)
  }
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(CHAT_FOLDER_DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(cur => (cur === key ? null : cur))
    },
    onDrop: (e: React.DragEvent) => onDrop(e, folderId),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-folders-list">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('chatFolders.title')}
        </span>
        <button
          type="button"
          className="rounded-full p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          aria-label={t('chatFolders.search')}
          title={t('chatFolders.search')}
          aria-pressed={searchOpen}
          onClick={() => { setSearchOpen(v => !v); if (searchOpen) setQuery('') }}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded-full p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          aria-label={t('chatFolders.newFolder')}
          title={t('chatFolders.newFolder')}
          onClick={() => openCreate()}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>
      {searchOpen && (
        <div className="relative px-3 pb-1">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }}
            placeholder={t('chatFolders.searchPlaceholder')}
            aria-label={t('chatFolders.search')}
            className="h-7 w-full rounded-full border border-foreground/10 bg-background px-3 pr-7 text-xs outline-none focus:border-accent"
          />
          {query && (
            <button type="button" className="absolute right-5 top-1.5 text-muted-foreground" aria-label={t('chatFolders.clearSearch')} onClick={() => setQuery('')}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {error && <div role="alert" className="px-3 pb-1 text-xs text-destructive">{t('chatFolders.error')}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="tree" aria-label={t('chatFolders.title')}>
        {groups.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('chatFolders.noResults')}</div>
        )}
        {groups.map(group => {
          const key = folderKey(group)
          const isOpen = searching || !collapsed.has(key)
          const label = group.folder ? group.folder.name : t('chatFolders.ungrouped')
          const FolderIcon = group.folder ? (isOpen ? FolderOpen : Folder) : Inbox
          const header = (
            <button
              type="button"
              role="treeitem"
              aria-expanded={isOpen}
              onClick={() => toggle(key)}
              className={cn(
                'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium hover:bg-foreground/5',
                dropTarget === key && 'bg-accent/15 ring-1 ring-accent/40',
              )}
              {...dropProps(key, group.folder?.id ?? null)}
            >
              <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{group.items.length}</span>
            </button>
          )
          return (
            <div key={key} data-folder-key={key}>
              {group.folder ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <StyledContextMenuItem onSelect={() => { setDialogName(group.folder!.name); setDialog({ mode: 'rename', folderId: group.folder!.id }) }}>
                      <Pencil />{t('chatFolders.rename')}
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem variant="destructive" onSelect={() => void mutate({ kind: 'delete', folderId: group.folder!.id })}>
                      <Trash2 />{t('chatFolders.delete')}
                    </StyledContextMenuItem>
                  </StyledContextMenuContent>
                </ContextMenu>
              ) : header}
              {isOpen && (
                <div role="group">
                  {group.items.length === 0 && group.folder && (
                    <div className="py-1 pl-9 pr-2 text-xs text-muted-foreground/70" {...dropProps(key, group.folder.id)}>
                      {t('chatFolders.emptyFolder')}
                    </div>
                  )}
                  {group.items.map(item => {
                    const assigned = state.assignments[item.id]
                    return (
                      <ContextMenu key={item.id}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            role="treeitem"
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData(CHAT_FOLDER_DRAG_MIME, item.id)
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            onClick={() => onSessionSelect(item)}
                            aria-current={selectedSessionId === item.id ? 'page' : undefined}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg py-1.5 pl-9 pr-2 text-left text-[13px] hover:bg-foreground/5',
                              selectedSessionId === item.id && 'bg-foreground/[0.07] font-medium',
                            )}
                            {...dropProps(key, group.folder?.id ?? null)}
                          >
                            <span className="min-w-0 flex-1 truncate">{getSessionTitle(item)}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relativeTime(item.lastMessageAt)}</span>
                          </button>
                        </ContextMenuTrigger>
                        <StyledContextMenuContent>
                          <StyledContextMenuSub>
                            <StyledContextMenuSubTrigger><FolderInput />{t('chatFolders.moveTo')}</StyledContextMenuSubTrigger>
                            <StyledContextMenuSubContent>
                              {state.folders.map(f => (
                                <StyledContextMenuItem key={f.id} disabled={assigned === f.id} onSelect={() => moveTo(item.id, f.id)}>
                                  <Folder />{f.name}
                                </StyledContextMenuItem>
                              ))}
                              {state.folders.length > 0 && <StyledContextMenuSeparator />}
                              <StyledContextMenuItem onSelect={() => openCreate(item.id)}>
                                <FolderPlus />{t('chatFolders.newFolder')}
                              </StyledContextMenuItem>
                            </StyledContextMenuSubContent>
                          </StyledContextMenuSub>
                          {assigned && (
                            <StyledContextMenuItem onSelect={() => moveTo(item.id, null)}>
                              <Inbox />{t('chatFolders.removeFromFolder')}
                            </StyledContextMenuItem>
                          )}
                        </StyledContextMenuContent>
                      </ContextMenu>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <RenameDialog
        open={dialog !== null}
        onOpenChange={open => { if (!open) setDialog(null) }}
        title={dialog?.mode === 'rename' ? t('chatFolders.renameTitle') : t('chatFolders.newFolderTitle')}
        value={dialogName}
        onValueChange={setDialogName}
        onSubmit={() => void submitDialog()}
        placeholder={t('chatFolders.namePlaceholder')}
      />
    </div>
  )
}

