import * as React from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, FilePlus2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Link2, Paperclip, Pencil, Plus, Search, SquarePen, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { activeSessionIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { TiptapMarkdownEditor, type TiptapEditorHandle } from '@craft-agent/ui'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { applyPropertyPatch, previewPropertyPatch, previewPropertyDictionary, projectFrontmatter, retainSource, retainedSourceHash, type MarkdownCommitCommand, type PropertyDictionaryPreview, type PropertyValue } from '@craft-agent/core/docs'
import type { ContentFailure, ContentResolution } from '@craft-agent/server-core/docs/descriptor-resolver'
import type { BlockTreeResult, NativeMarkerMappingPreview } from '@craft-agent/server-core/docs/block-tree-service'
import { applyMarkerMapping as applyBlockMarkerMapping, retainedText, retainSource as retainBlockSource } from '@craft-agent/core/docs'
import { contentHash as blockContentHash } from '@craft-agent/core/rox2'
import { parseNoteBlockAddress, resolveNoteBlockId } from '@craft-agent/core/mindmap/derive-note.ts'
import type { FileAttachment, NoteAsset, NoteChangedPayload, NoteDocument, NoteIndexHealth, NoteMutationOptions, NoteRenameImpact, NoteSummary } from '../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { RightSessionShell } from '@/components/session-workbench/RightSessionShell'
import {
  bindRightSessionContext,
  describeRightSessionOpen,
  revisionByEntityId,
} from '@/components/session-workbench/right-session-shell'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  contentHash,
  isClaimableLive,
  soupDocumentActResult,
  soupDocumentListResult,
  soupDocumentReadResult,
  type Rox2Context,
} from '@craft-agent/core/rox2'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NotesImportButton } from '@/components/notes/NotesImportButton'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'
import { NoteInspector } from './notes/NoteInspector'
import type { NoteTask } from './notes/NoteInspector'
import { NotesAIMenu } from './notes/NotesAIMenu'
import type { AIActionMode } from './notes/NotesAIMenu'
import { NotesDialogs } from './notes/NotesDialogs'
import {
  defaultNoteEntityCapabilities,
  EntityViewTabs,
  useEntityView,
} from '@/components/app-shell/EntityViewTabs'
import { MindMapHost } from '@/mindmap/MindMapHost'
import { deriveNoteMindMap, type MindMapGraph } from '@craft-agent/core/mindmap'
import { NotesCommentComposer, NotesCommentHighlights, NotesCommentTooltip, NotesComments, NotesEditorHeadlineStyles, NotesToc } from './notes/NotesReadingChrome'
import {
  NotesBreadcrumbs,
  NotesCommandPalette,
  NotesRailSash,
  useNotesRailLayout,
} from './notes/NotesDocumentChrome'
import { NotesViewHost } from './notes/NotesViewHost'
import { convertNote, dailyNoteDestination, parseNotePropertyValue } from './notes/note-views'
import {
  loadPersonalTaskStore,
  persistPersonalTaskStore,
} from '@/lib/personal-tasks'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import {
  applyPersistentFolds,
  defaultNoteCommands,
  extractComments,
  matchNoteCommands,
  noteColumnKeyboardAction,
  noteCommentKeyboardAction,
  notePaletteKeyAction,
  notesFoldStorageKey,
  parsePersistedFolds,
  peopleAndEntitiesFromInsights,
  resizeColumnsAt,
  sanitizePastedMarkdown,
  serializePersistedFolds,
  snippetForColumnCommand,
  THREE_COLUMN_SNIPPET,
  TWO_COLUMN_SNIPPET,
  upsertMarkdownComment,
} from './notes/document-ia'
import { selectionComposerOffset } from './notes/comment-highlights'
import { NOTES_AI_MODEL, NOTES_AI_PROMPTS_STORAGE_KEY, parseNotesAiPrompts, resolveNotesAiInstruction } from './notes/note-ai'
import { NOTES_SURFACE_ID, bindNativeNote } from './notes-rox2-surface'
import {
  aliasesFromProperties,
  applyEntityMerge,
  applyLinkSuggestion,
  buildVaultInsights,
  insertFootnote,
  undoEntityMerge,
  updateFootnoteDefinition,
} from '@craft-agent/shared/knowledge/vault-insights'
import { EMPTY_NOTE_INSIGHTS } from './notes/VaultInsightsPanel'
import { EMPTY_NOTE_INDEX_HEALTH } from './notes/VaultIndexHealthPanel'
import {
  findNoteByWikiTarget,
  matchWikiLinkCandidates,
  parseWikiCreateTarget,
  wikiMatchSubtitle,
} from './notes/wiki-autocomplete'
import { createNativeNotesSyncController } from '../lib/native-notes-sync'
import { isNativeNoteDocument, writeNoteThroughAuthority } from '../lib/notes-write-authority'

interface NotesPageProps {
  selectedNoteId: string | null
}


function noteRevisionKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}\0${noteId}`
}
function noteRelativeLabel(note: NoteSummary): string {
  return note.relativePath.replace(/\.md$/i, '')
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function normalizeNoteTarget(value: string): string {
  return stripMdExtension(value.trim()).toLowerCase()
}

function findNoteByTarget(notes: NoteSummary[], target: string): NoteSummary | null {
  return findNoteByWikiTarget(notes, target)
}

function filterNotes(notes: NoteSummary[], query: string, tag: string | null): NoteSummary[] {
  const q = query.trim().toLowerCase()
  return notes.filter(note => {
    if (tag && !note.tags.includes(tag)) return false
    if (!q) return true
    return note.title.toLowerCase().includes(q)
      || note.relativePath.toLowerCase().includes(q)
      || note.tags.some(noteTag => noteTag.toLowerCase().includes(q))
  })
}

function normalizeChangedPayload(payload: NoteChangedPayload | string): NoteChangedPayload {
  return typeof payload === 'string' ? { workspaceId: payload } : payload
}

function todayDateString(): string {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function shiftDateString(value: string, deltaDays: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + deltaDays)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseDailyNoteDate(noteId?: string): string | null {
  const match = noteId?.match(/^daily\/(\d{4}-\d{2}-\d{2})$/)
  return match?.[1] ?? null
}

function splitFrontmatter(value: string): { frontmatter: string; body: string } {
  const match = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) return { frontmatter: '', body: value }
  const frontmatter = match[0].replace(/\s*$/, '\n\n')
  return { frontmatter, body: value.slice(match[0].length).replace(/^\r?\n/, '') }
}

function mergeFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body
  return `${frontmatter}${body.replace(/^\r?\n/, '')}`
}

function findRichWikiQuery(editor: TiptapEditorHandle | null): string | null {
  if (!editor) return null
  const from = editor.state.selection.from
  const textBefore = editor.state.doc.textBetween(Math.max(0, from - 140), from, '\n', '\n')
  const match = textBefore.match(/\[\[([^\]\n]*)$/)
  return match ? match[1] : null
}

function findRichWikiQueryRange(editor: TiptapEditorHandle | null): { from: number; to: number } | null {
  if (!editor) return null
  const to = editor.state.selection.from
  const textBefore = editor.state.doc.textBetween(Math.max(0, to - 140), to, '\n', '\n')
  const match = textBefore.match(/\[\[([^\]\n]*)$/)
  if (!match) return null
  return { from: to - match[0].length, to }
}

function findRichCommandQuery(editor: TiptapEditorHandle | null): string | null {
  if (!editor) return null
  const from = editor.state.selection.from
  const textBefore = editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
  const match = textBefore.match(/([!@][^\s\n]*)$/)
  return match ? match[1] : null
}

function findRichWikiLinkAtCursor(editor: TiptapEditorHandle | null): string | null {
  if (!editor) return null
  const cursor = editor.state.selection.from
  const before = editor.state.doc.textBetween(Math.max(0, cursor - 200), cursor, '\n', '\n')
  const after = editor.state.doc.textBetween(cursor, Math.min(editor.state.doc.content.size, cursor + 200), '\n', '\n')
  const open = before.lastIndexOf('[[')
  const close = after.indexOf(']]')
  if (open === -1 || close === -1) return null
  const raw = `${before.slice(open + 2)}${after.slice(0, close)}`
  return raw.split('|')[0]?.split('#')[0]?.trim() || null
}

function classifyAttachment(file: File): FileAttachment['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('text/')) return 'text'
  if (/word|excel|powerpoint|officedocument/i.test(file.type)) return 'office'
  return 'unknown'
}

async function fileToAttachment(file: File): Promise<FileAttachment> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    type: classifyAttachment(file),
    path: window.electronAPI.getFilePath(file) ?? '',
    name: file.name || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    base64: btoa(binary),
    size: file.size,
  }
}

function noteFolder(note: NoteSummary): string {
  const parts = note.id.split('/')
  parts.pop()
  return parts.join('/')
}

function extractTasks(note: NoteDocument | NoteSummary, content: string): NoteTask[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/)
    if (!match) return []
    return [{
      noteId: note.id,
      noteTitle: note.title,
      line: index + 1,
      text: match[2].trim(),
      checked: match[1].toLowerCase() === 'x',
    }]
  })
}

function updateMarkdownTitle(content: string, title: string): string {
  const escaped = title.replace(/"/g, '\\"')
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(content)) {
    if (/^---\r?\n[\s\S]*?\r?\ntitle\s*:/m.test(content)) {
      return content.replace(/(^---\r?\n[\s\S]*?\r?\ntitle\s*:\s*).+$/m, `$1"${escaped}"`)
    }
    return content.replace(/^---\r?\n/, `---\ntitle: "${escaped}"\n`)
  }
  return content
}

// ── Folder tree types & builder ──────────────────────────────────────────────

interface FolderTreeNode {
  /** Full path from vault root, e.g. "1-Daily/2026/05" */
  fullPath: string
  /** Display segment, e.g. "05" */
  name: string
  children: FolderTreeNode[]
  notes: NoteSummary[]
}

function buildFolderTree(notes: NoteSummary[]): { rootNotes: NoteSummary[]; folders: FolderTreeNode[] } {
  const rootNotes: NoteSummary[] = []
  // Map from fullPath → node
  const nodeMap = new Map<string, FolderTreeNode>()

  function getOrCreate(fullPath: string): FolderTreeNode {
    if (nodeMap.has(fullPath)) return nodeMap.get(fullPath)!
    const segments = fullPath.split('/')
    const name = segments[segments.length - 1] ?? fullPath
    const node: FolderTreeNode = { fullPath, name, children: [], notes: [] }
    nodeMap.set(fullPath, node)
    return node
  }

  for (const note of notes) {
    const folder = noteFolder(note)
    if (!folder) {
      rootNotes.push(note)
      continue
    }
    // Ensure all ancestor nodes exist
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      getOrCreate(segments.slice(0, i).join('/'))
    }
    getOrCreate(folder).notes.push(note)
  }

  // Wire parent→child relationships
  const topLevel: FolderTreeNode[] = []
  for (const [fullPath, node] of nodeMap) {
    const segments = fullPath.split('/')
    if (segments.length === 1) {
      topLevel.push(node)
    } else {
      const parentPath = segments.slice(0, -1).join('/')
      const parent = nodeMap.get(parentPath)
      if (parent && !parent.children.includes(node)) {
        parent.children.push(node)
      }
    }
  }

  const sortNodes = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) sortNodes(node.children)
  }
  sortNodes(topLevel)
  topLevel.sort((a, b) => a.name.localeCompare(b.name))

  return { rootNotes, folders: topLevel }
}

function DroppableFolderHeader({
  folder,
  children,
}: {
  folder: string
  children: (isOver: boolean) => React.ReactNode
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder:${folder}`,
    data: { type: 'folder', folder },
  })
  return <div ref={setNodeRef}>{children(isOver)}</div>
}

function DraggableNoteItem({
  note,
  children,
}: {
  note: NoteSummary
  children: (isDragging: boolean, dragListeners: React.HTMLAttributes<HTMLElement>) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `note:${note.id}`,
    data: { type: 'note', note },
  })
  return (
    <div ref={setNodeRef} {...attributes}>
      {children(isDragging, listeners ?? {})}
    </div>
  )
}

// ── FolderTreeItem ────────────────────────────────────────────────────────────
// Renders one folder node recursively. depth controls indent level (0 = top).

interface FolderTreeItemProps {
  node: FolderTreeNode
  depth: number
  activeNoteId: string | null | undefined
  collapsedFolders: Set<string>
  onToggleFolder(folder: string): void
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

function FolderTreeItem({
  node,
  depth,
  activeNoteId,
  collapsedFolders,
  onToggleFolder,
  onOpenNote,
  onOpenCreateNoteDialog,
  onOpenRenameFolder,
  onOpenDeleteFolder,
  onOpenMoveDialog,
  onOpenRenameDialogForNote,
  onOpenDeleteDialogForNote,
  onDuplicateNote,
  onCopyNoteLink,
  onCopyNotePath,
  onRevealNote,
}: FolderTreeItemProps) {
  const { t } = useTranslation()
  const isCollapsed = collapsedFolders.has(node.fullPath)
  const indent = depth * 12

  return (
    <div>
      <DroppableFolderHeader folder={node.fullPath}>
        {(isOver) => (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  'mb-0.5 flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-2 text-sm font-medium text-muted-foreground hover:bg-foreground/[0.04]',
                  isOver && 'ring-2 ring-primary/40 bg-primary/[0.06]'
                )}
                style={{ paddingLeft: `${8 + indent}px` }}
                onClick={() => onToggleFolder(node.fullPath)}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                {isCollapsed
                  ? <Folder className="h-4 w-4 shrink-0" />
                  : <FolderOpen className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate" title={node.fullPath}>
                  {node.name}
                </span>
                <span className="text-xs text-muted-foreground/50 tabular-nums">
                  {countFolderNotes(node)}
                </span>
              </div>
            </ContextMenuTrigger>
            <StyledContextMenuContent>
              <StyledContextMenuItem onClick={() => onOpenCreateNoteDialog(node.fullPath)}>
                <FilePlus2 className="h-3.5 w-3.5" />
                {t('notes.menu.newInFolder')}
              </StyledContextMenuItem>
              <StyledContextMenuItem onClick={() => onOpenRenameFolder(node.fullPath)}>
                <Pencil className="h-3.5 w-3.5" />
                {t('notes.menu.renameFolder')}
              </StyledContextMenuItem>
              <StyledContextMenuSeparator />
              <StyledContextMenuItem variant="destructive" onClick={() => onOpenDeleteFolder(node.fullPath)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('notes.menu.deleteFolder')}
              </StyledContextMenuItem>
            </StyledContextMenuContent>
          </ContextMenu>
        )}
      </DroppableFolderHeader>

      {!isCollapsed && (
        <>
          {/* Child sub-folders first */}
          {node.children.map(child => (
            <FolderTreeItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeNoteId={activeNoteId}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onOpenNote={onOpenNote}
              onOpenCreateNoteDialog={onOpenCreateNoteDialog}
              onOpenRenameFolder={onOpenRenameFolder}
              onOpenDeleteFolder={onOpenDeleteFolder}
              onOpenMoveDialog={onOpenMoveDialog}
              onOpenRenameDialogForNote={onOpenRenameDialogForNote}
              onOpenDeleteDialogForNote={onOpenDeleteDialogForNote}
              onDuplicateNote={onDuplicateNote}
              onCopyNoteLink={onCopyNoteLink}
              onCopyNotePath={onCopyNotePath}
              onRevealNote={onRevealNote}
            />
          ))}

          {/* Notes directly inside this folder */}
          {node.notes.map(note => (
            <DraggableNoteItem key={note.id} note={note}>
              {(isDragging, dragListeners) => (
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => onOpenNote(note.id)}
                      style={{
                        paddingLeft: `${14 + indent + 12}px`,
                        contentVisibility: 'auto',
                        containIntrinsicSize: '0 44px',
                      }}
                      className={cn(
                        'notes-list-item mb-0.5 w-full rounded-[6px] pr-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                        activeNoteId === note.id && 'notes-list-item-active',
                        isDragging && 'opacity-50'
                      )}
                      {...dragListeners}
                    >
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <div className="min-w-0 flex-1 truncate text-sm">{note.title}</div>
                      </div>
                      {note.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1" style={{ paddingLeft: '20px' }}>
                          {note.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="rounded-[4px] bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <StyledContextMenuItem onClick={() => onOpenNote(note.id)}>
                      <FileText className="h-3.5 w-3.5" />
                      {t('common.open')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenRenameDialogForNote(note)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t('common.rename')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenCreateNoteDialog(noteFolder(note) || undefined)}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                      {t('notes.menu.newHere')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onDuplicateNote(note)}>
                      <Copy className="h-3.5 w-3.5" />
                      {t('notes.menu.duplicate')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenMoveDialog(note)}>
                      <FolderInput className="h-3.5 w-3.5" />
                      {t('notes.menu.moveToFolder')}
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem onClick={() => onCopyNoteLink(note)}>
                      <Link2 className="h-3.5 w-3.5" />
                      {t('notes.menu.copyLink')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onCopyNotePath(note)}>
                      <FileText className="h-3.5 w-3.5" />
                      {t('notes.menu.copyPath')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onRevealNote(note)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('notes.menu.reveal')}
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem variant="destructive" onClick={() => onOpenDeleteDialogForNote(note)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('common.delete')}
                    </StyledContextMenuItem>
                  </StyledContextMenuContent>
                </ContextMenu>
              )}
            </DraggableNoteItem>
          ))}
        </>
      )}
    </div>
  )
}

function countFolderNotes(node: FolderTreeNode): number {
  return node.notes.length + node.children.reduce((sum, c) => sum + countFolderNotes(c), 0)
}

export default function NotesPage({ selectedNoteId }: NotesPageProps) {
  const { t } = useTranslation()
  const navigationRevision = React.useContext(NavigationContext)?.navigationRevision
  const {
    activeWorkspaceId,
    onCreateSession,
    onOpenFile,
    onSendMessage,
    onInputChange,
    getDraft,
    labels = [],
    sessionStatuses = [],
    projects = [],
  } = useAppShellContext()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const activeProjectId = activeSessionId ? sessionMetaMap.get(activeSessionId)?.projectId : undefined
  const activeProjectSlug = projects.find((p) => p.id === activeProjectId)?.slug
  const [rightSessionContext, setRightSessionContext] = React.useState<Rox2Context | null>(null)
  const [sideSessionPrompt, setSideSessionPrompt] = React.useState('')
  const [sideNoteChip, setSideNoteChip] = React.useState<{ title: string; path: string } | null>(null)
  const [rightSessionFocusToken, setRightSessionFocusToken] = React.useState(0)
  const sideSessionId = rightSessionContext?.sessionId ?? null
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  // Stable insertion order for sidebar — only updated on full refreshes, not optimistic saves
  const [sidebarOrder, setSidebarOrder] = React.useState<string[]>([])
  const [searchResults, setSearchResults] = React.useState<NoteSummary[] | null>(null)
  const [activeNote, setActiveNote] = React.useState<NoteDocument | null>(null)
  const activeNoteRef = React.useRef(activeNote)
  activeNoteRef.current = activeNote
  const [content, setContent] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null)
  const [commentDraftQuote, setCommentDraftQuote] = React.useState('')
  const [commentComposerTop, setCommentComposerTop] = React.useState(48)
  const [commentComposerBody, setCommentComposerBody] = React.useState('')
  const [commentTooltip, setCommentTooltip] = React.useState<{ body: string; quote: string; top: number; left: number } | null>(null)
  const [footnoteDraft, setFootnoteDraft] = React.useState('')
  const [indexHealth, setIndexHealth] = React.useState<NoteIndexHealth>(EMPTY_NOTE_INDEX_HEALTH)
  const [indexRebuilding, setIndexRebuilding] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [saveNeedsReload, setSaveNeedsReload] = React.useState(false)
  const [saveRecoveryOpen, setSaveRecoveryOpen] = React.useState(false)
  const [propertyPreview, setPropertyPreview] = React.useState<{ workspaceId: string; noteId: string; preview: PropertyDictionaryPreview; createdProperty?: { key: string; value: string } } | null>(null)
  const saveBlockedRef = React.useRef(false)
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('notes:collapsed-folders') ?? '[]')) }
    catch { return new Set() }
  })
  const [wikiQuery, setWikiQuery] = React.useState<string | null>(null)
  const [wikiIndex, setWikiIndex] = React.useState(0)
  const [wikiAnchor, setWikiAnchor] = React.useState<{ x: number; y: number } | null>(null)
  const [tagDraft, setTagDraft] = React.useState('')
  const [newPropertyKey, setNewPropertyKey] = React.useState('')
  const [newPropertyValue, setNewPropertyValue] = React.useState('')
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createTitle, setCreateTitle] = React.useState('')
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = React.useState(false)
  const [createFolderName, setCreateFolderName] = React.useState('')
  const [createInFolder, setCreateInFolder] = React.useState<string | undefined>(undefined)
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false)
  const [moveTargetNote, setMoveTargetNote] = React.useState<NoteSummary | null>(null)
  const [moveFolderName, setMoveFolderName] = React.useState('')
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameTitle, setRenameTitle] = React.useState('')
  const [renameImpact, setRenameImpact] = React.useState<NoteRenameImpact | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [renameFolderDialogOpen, setRenameFolderDialogOpen] = React.useState(false)
  const [renameFolderTarget, setRenameFolderTarget] = React.useState('')
  const [renameFolderName, setRenameFolderName] = React.useState('')
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = React.useState(false)
  const [deleteFolderTarget, setDeleteFolderTarget] = React.useState('')
  const [externalChange, setExternalChange] = React.useState<NoteChangedPayload | null>(null)
  const externalChangeToastIdRef = React.useRef<string | number | null>(null)
  const [missingLinkTarget, setMissingLinkTarget] = React.useState<string | null>(null)
  const [allAssets, setAllAssets] = React.useState<NoteAsset[]>([])
  const [allTasks, setAllTasks] = React.useState<NoteTask[]>([])
  const [assetDialogOpen, setAssetDialogOpen] = React.useState(false)
  const [assetRenameTarget, setAssetRenameTarget] = React.useState<NoteAsset | null>(null)
  const [assetRenameName, setAssetRenameName] = React.useState('')
  const [assetBusy, setAssetBusy] = React.useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('notes:inspector-collapsed') ?? 'true') }
    catch { return true }
  })
  const [railLayout, setRailLayout] = useNotesRailLayout()
  // Width of the document row (СОДЕРЖАНИЕ | note | КОММЕНТАРИИ) so the side
  // rails can yield before the note column gets unreadably narrow.
  const [docRowEl, setDocRowEl] = React.useState<HTMLDivElement | null>(null)
  const [docRowWidth, setDocRowWidth] = React.useState(0)
  React.useEffect(() => {
    if (!docRowEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setDocRowWidth(entry?.contentRect.width ?? 0))
    observer.observe(docRowEl)
    return () => observer.disconnect()
  }, [docRowEl])
  const [foldedHeadingIds, setFoldedHeadingIds] = React.useState<string[]>([])
  const [commandQuery, setCommandQuery] = React.useState<string | null>(null)
  const [commandIndex, setCommandIndex] = React.useState(0)
  const saveTimerRef = React.useRef<number | null>(null)
  const saveQueueRef = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const openNoteRequestRef = React.useRef(0)
  const searchRequestRef = React.useRef(0)
  const notesListRequestRef = React.useRef(0)
  const taskRequestRef = React.useRef(0)
  const taskCacheWorkspaceRef = React.useRef<string | null>(activeWorkspaceId ?? null)
  const taskCacheRef = React.useRef<Map<string, NoteTask[]>>(new Map())
  const taskCacheUpdatedAtRef = React.useRef<Map<string, number>>(new Map())
  const nativeRevisionByNoteRef = React.useRef<Map<string, number | null>>(new Map())
  const expectedRevisionByNoteRef = React.useRef<Map<string, string>>(new Map())
  const mutationOptions = React.useCallback((workspaceId: string, noteId: string, expectedRevision?: number | null): NoteMutationOptions => ({
    operationId: crypto.randomUUID(),
    expectedRevision: expectedRevision === undefined
      ? nativeRevisionByNoteRef.current.get(noteRevisionKey(workspaceId, noteId)) ?? null
      : expectedRevision,
    schemaVersion: 1,
  }), [])
  const dirtyRef = React.useRef(dirty)
  const contentRef = React.useRef(content)
  const revisionsRef = React.useRef(new Map<string, string>())
  const pendingCommitsRef = React.useRef(new Map<string, MarkdownCommitCommand>())
  const workspaceIdRef = React.useRef(activeWorkspaceId)
  const [contentResolution, setContentResolution] = React.useState<ContentResolution | ContentFailure | null>(null)
  const [sourceInfoOpen, setSourceInfoOpen] = React.useState(false)
  const [committedBlockTree, setCommittedBlockTree] = React.useState<BlockTreeResult | null>(null)
  const [markerPreview, setMarkerPreview] = React.useState<{ preview: NativeMarkerMappingPreview; operationId: string } | null>(null)
  const [markerBusy, setMarkerBusy] = React.useState(false)
  const [markerError, setMarkerError] = React.useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(null)
  const visibleBlockTree = !dirty && activeNote?.sourceStoreId === committedBlockTree?.sourceStoreId
    && activeNote?.revision === committedBlockTree?.revision && retainedSourceHash(content) === committedBlockTree?.sourceHash
    ? committedBlockTree : null
  React.useEffect(() => {
    let cancelled = false
    setCommittedBlockTree(null)
    setSelectedBlockId(null)
    setMarkerPreview(null)
    setMarkerError(null)
    if (!activeWorkspaceId || !activeNote?.revision || !activeNote.sourceStoreId || contentResolution?.status === 'error'
      || !contentResolution || !window.electronAPI.isChannelAvailable(RPC_CHANNELS.content.GET_BLOCK_TREE)) return
    const request = { ref: { workspaceId: activeWorkspaceId, entityId: 'note:' + (activeNote.nativeId ?? activeNote.id) }, revision: activeNote.revision,
      authorityEpoch: contentResolution.origin.authorityEpoch, sourceStoreId: activeNote.sourceStoreId }
    void window.electronAPI.getBlockTree(request).then(tree => {
      if (!cancelled && workspaceIdRef.current === activeWorkspaceId) setCommittedBlockTree(tree)
    }).catch(() => { if (!cancelled) setCommittedBlockTree(null) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, activeNote?.id, activeNote?.revision, activeNote?.sourceStoreId, contentResolution])
  const selectedBlock = visibleBlockTree?.identity.blocks.find(block => block.identity === 'anchored' && block.nodeId === selectedBlockId)
  const openStableBlock = (nodeId: string) => {
    if (!visibleBlockTree || !activeNote) return
    const resolved = resolveNoteBlockId(visibleBlockTree.listTree, nodeId)
    if (resolved) { setSelectedBlockId(resolved); navigate(routes.view.notes(activeNote.id + '#^' + nodeId)) }
  }
  React.useEffect(() => {
    if (!selectedNoteId || !visibleBlockTree || !activeNote) return
    const address = parseNoteBlockAddress(selectedNoteId)
    if (address.noteId !== activeNote.id || !address.blockId) return
    const nodeId = resolveNoteBlockId(visibleBlockTree.listTree, address.blockId)
    setSelectedBlockId(nodeId)
    if (!nodeId) toast.error(t('notes.blocks.notFound'))
  }, [selectedNoteId, visibleBlockTree, activeNote?.id, navigationRevision, t])
  const prepareMarkers = async () => {
    if (!visibleBlockTree || !activeWorkspaceId || !activeNote || dirty || markerBusy) return
    const revision = visibleBlockTree.revision
    setMarkerBusy(true)
    setMarkerError(null)
    try {
      const preview = await window.electronAPI.previewMarkerMapping({ ref: visibleBlockTree.canonicalRef,
        revision, authorityEpoch: visibleBlockTree.authorityEpoch, sourceStoreId: visibleBlockTree.sourceStoreId })
      if (workspaceIdRef.current !== activeWorkspaceId || activeNoteIdRef.current !== activeNote.id
        || dirtyRef.current || retainedSourceHash(contentRef.current) !== revision) return
      setMarkerPreview({ preview, operationId: crypto.randomUUID() })
    } catch (error) {
      toast.error(t('notes.blocks.unavailable'))
    } finally { setMarkerBusy(false) }
  }
  const markerAfter = React.useMemo(() => {
    if (!markerPreview) return null
    const applied = applyBlockMarkerMapping(retainBlockSource(markerPreview.preview.baseContent),
      markerPreview.preview.mapping, markerPreview.preview.authorityEpoch)
    return applied.status === 'ok' ? applied.text : null
  }, [markerPreview])
  const applyMarkers = async () => {
    if (!markerPreview || markerBusy || !activeNote || !activeWorkspaceId) return
    const command = markerPreview
    if (command.preview.ref.workspaceId !== activeWorkspaceId || dirtyRef.current
      || command.preview.sourceStoreId !== activeNote.sourceStoreId
      || command.preview.expectedRevision !== retainedSourceHash(contentRef.current) || markerAfter === null) {
      setMarkerError(t('notes.blocks.previewChanged'))
      return
    }
    const noteId = activeNote.id
    const workspaceId = activeWorkspaceId
    const opening = openNoteRequestRef.current
    setMarkerBusy(true)
    setMarkerError(null)
    try {
      const result = await writeNoteThroughAuthority<{ note: NoteDocument; receipt: { revision: string }; blockTree: BlockTreeResult | null }>(activeNote, workspaceId, contentResolution, {
        native: async () => {
          const note = await saveNativeNote(activeNote, markerAfter)
          return { note, receipt: { revision: note.revision! }, blockTree: null }
        },
        markdown: () => window.electronAPI.applyMarkerMapping({ preview: command.preview,
          operationId: command.operationId, reviewedDigest: command.preview.digest }),
      })
      if (workspaceIdRef.current !== workspaceId || activeNoteIdRef.current !== noteId || openNoteRequestRef.current !== opening) return
      if (dirtyRef.current || (contentRef.current !== command.preview.baseContent && contentRef.current !== result.note.content)) {
        setSaveNeedsReload(true)
        setMarkerError(t('notes.content.resultUnavailable'))
        return
      }
      revisionsRef.current.set(workspaceId + '\0' + noteId, result.receipt.revision)
      nativeRevisionByNoteRef.current.set(noteRevisionKey(workspaceId, noteId), result.note.nativeRevision ?? null)
      contentRef.current = result.note.content
      dirtyRef.current = false
      setActiveNote(result.note)
      setContent(result.note.content)
      setDirty(false)
      setNotes(previous => previous.map(note => note.id === noteId ? result.note : note))
      setCommittedBlockTree(result.blockTree)
      setContentResolution(previous => previous && previous.status !== 'error' ? {
        ...previous, content: result.note.content, revision: result.receipt.revision,
        contentHash: blockContentHash(result.note.content),
        canonicalRef: { ...previous.canonicalRef, revisionId: result.receipt.revision },
      } : previous)
      setMarkerPreview(null)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      setMarkerError(t(code === 'HASH_CONFLICT' ? 'notes.blocks.previewChanged' : code === 'AUTH_FAILED'
        ? 'notes.content.denied' : code === 'DOCUMENT_AUTHORITY_CHANGED' ? 'notes.content.authorityChanged'
        : code === 'DOCUMENT_RESULT_UNAVAILABLE' ? 'notes.content.resultUnavailable' : 'notes.content.unconfirmedSave'))
    } finally { setMarkerBusy(false) }
  }
  const blockToolbar = (
    <div className="shrink-0 border-b border-border/50 px-3 py-2" data-testid="notes-block-toolbar">
      <Button variant="outline" size="sm" disabled={markerBusy || dirty || !visibleBlockTree
        || visibleBlockTree.identity.status !== 'ok' || contentResolution?.status !== 'ok' || !contentResolution.capabilities.write}
        onClick={() => void prepareMarkers()}>{t('notes.blocks.prepare')}</Button>
      {visibleBlockTree?.identity.diagnostics.map((diagnostic, index) => (
        <p role="status" className="mt-1 text-xs text-muted-foreground" key={diagnostic.code + ':' + index}>
          {t('notes.blocks.diagnostic.' + diagnostic.code)}{diagnostic.id ? ' · ' + diagnostic.id : ''}
        </p>
      ))}
    </div>
  )
  const canEditContent = contentResolution?.status === 'ok' && contentResolution.capabilities.write && !saveNeedsReload
  React.useEffect(() => { workspaceIdRef.current = activeWorkspaceId }, [activeWorkspaceId])
  const noteViewCapabilities = React.useMemo(() => defaultNoteEntityCapabilities(), [])
  const [noteView, setNoteView] = useEntityView(
    activeNote ? `note:${activeNote.id}` : 'note:none',
    noteViewCapabilities,
    'standard',
  )
  const noteMindMapGraph = React.useMemo((): MindMapGraph | null => {
    if (!activeNote) return null
    if (noteView !== 'map' || !visibleBlockTree) return null
    return deriveNoteMindMap({
      noteId: activeNote.id,
      title: activeNote.title,
      markdown: content,
      listTree: visibleBlockTree.listTree,
      backlinks: (activeNote.backlinks ?? []).map((b) => ({
        id: b.noteId,
        title: b.title || b.noteId,
      })),
    })
  }, [activeNote, content, noteView, visibleBlockTree])
  const activeNoteIdRef = React.useRef<string | null>(null)
  const richEditorRef = React.useRef<TiptapEditorHandle | null>(null)
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  React.useEffect(() => { dirtyRef.current = dirty }, [dirty])
  React.useEffect(() => { contentRef.current = content }, [content])
  React.useEffect(() => { activeNoteIdRef.current = activeNote?.id ?? null }, [activeNote?.id])
  const [nativeNotesSync] = React.useState(createNativeNotesSyncController)

  const toggleFolder = React.useCallback((folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      localStorage.setItem('notes:collapsed-folders', JSON.stringify([...next]))
      return next
    })
  }, [])

  const refreshNotes = React.useCallback(async () => {
    const request = ++notesListRequestRef.current
    if (!activeWorkspaceId) return
    const listed = soupDocumentListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return
    const next = await window.electronAPI.listNotes(activeWorkspaceId)
    if (request !== notesListRequestRef.current) return
    setNotes(next)
    setSidebarOrder(next.map(n => n.id))
  }, [activeWorkspaceId])

  const refreshIndexHealth = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      setIndexHealth(EMPTY_NOTE_INDEX_HEALTH)
      return
    }
    try {
      setIndexHealth(await window.electronAPI.getNoteIndexHealth(activeWorkspaceId))
    } catch {
      setIndexHealth(EMPTY_NOTE_INDEX_HEALTH)
    }
  }, [activeWorkspaceId])

  const rebuildIndex = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    setIndexRebuilding(true)
    try {
      setIndexHealth(await window.electronAPI.rebuildNoteIndex(activeWorkspaceId))
      await refreshNotes()
    } catch {
      await refreshIndexHealth()
    } finally {
      setIndexRebuilding(false)
    }
  }, [activeWorkspaceId, refreshNotes, refreshIndexHealth])

  const refreshAssets = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      setAllAssets([])
      return
    }
    const next = await window.electronAPI.listNoteAssets(activeWorkspaceId)
    setAllAssets(next)
  }, [activeWorkspaceId])

  const refreshTasks = React.useCallback(async (sourceNotes?: NoteSummary[]) => {
    const request = ++taskRequestRef.current
    if (taskCacheWorkspaceRef.current !== (activeWorkspaceId ?? null)) {
      taskCacheRef.current.clear()
      taskCacheUpdatedAtRef.current.clear()
      taskCacheWorkspaceRef.current = activeWorkspaceId ?? null
    }
    if (!activeWorkspaceId) {
      setAllTasks([])
      return
    }
    const baseNotes = sourceNotes ?? notes
    const currentIds = new Set(baseNotes.map(n => n.id))
    for (const id of taskCacheRef.current.keys()) {
      if (!currentIds.has(id)) {
        taskCacheRef.current.delete(id)
        taskCacheUpdatedAtRef.current.delete(id)
      }
    }
    const toFetch = baseNotes.filter(note =>
      !taskCacheRef.current.has(note.id) || taskCacheUpdatedAtRef.current.get(note.id) !== note.updatedAt
    )
    const results = await Promise.allSettled(
      toFetch.map(note => window.electronAPI.readNote(activeWorkspaceId, note.id))
    )
    if (request !== taskRequestRef.current || taskCacheWorkspaceRef.current !== activeWorkspaceId) return
    for (const result of results) {
      if (result.status === 'fulfilled') {
        taskCacheRef.current.set(result.value.id, extractTasks(result.value, result.value.content))
        taskCacheUpdatedAtRef.current.set(result.value.id, result.value.updatedAt)
      }
    }
    setAllTasks([...taskCacheRef.current.values()].flat())
  }, [activeWorkspaceId, notes])

  const openNote = React.useCallback(async (noteId: string) => {
    const request = ++openNoteRequestRef.current
    if (!activeWorkspaceId) {
      setActiveNote(null)
      contentRef.current = ''
      dirtyRef.current = false
      setContent('')
      setDirty(false)
      setLoading(false)
      return
    }
    const read = soupDocumentReadResult({ source: 'native', nativeId: noteId })
    if (!isClaimableLive(read.result)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setContentResolution(null)
    try {
      const note = await window.electronAPI.readNote(activeWorkspaceId, noteId)
      if (request !== openNoteRequestRef.current || workspaceIdRef.current !== activeWorkspaceId) return
      const resolution = window.electronAPI.isChannelAvailable(RPC_CHANNELS.content.RESOLVE)
        ? await window.electronAPI.resolveContent({ workspaceId: activeWorkspaceId, entityId: `note:${note.nativeId ?? note.id}` })
        : { status: 'error' as const, code: 'missingDependency' as const }
      if (request !== openNoteRequestRef.current || workspaceIdRef.current !== activeWorkspaceId) return
      // Projection metadata never grants a path-based alias a native write authority.
      if (resolution.status !== 'error' && resolution.origin.nativeId !== (note.nativeId ?? note.id)) {
        throw Object.assign(new Error(t('notes.content.authorityChanged')), { code: 'DOCUMENT_AUTHORITY_CHANGED' })
      }
      setContentResolution(resolution)
      if (resolution.status !== 'error') {
        note.sourceStoreId = resolution.origin.sourceStoreId
        note.content = resolution.content
        note.revision = resolution.revision
      }
      const revisionKey = noteRevisionKey(activeWorkspaceId, note.id)
      if (note.revision) revisionsRef.current.set(revisionKey, note.revision)
      expectedRevisionByNoteRef.current.set(revisionKey, contentHash(note.content))
      nativeRevisionByNoteRef.current.set(revisionKey, note.nativeRevision ?? null)
      activeNoteIdRef.current = note.id
      setActiveNote(note)
      contentRef.current = note.content
      dirtyRef.current = false
      setContent(note.content)
      setDirty(false)
      setSaving(false)
      setSaveError(null)
      saveBlockedRef.current = false
      setSaveNeedsReload(false)
      setExternalChange(null)
      setTagDraft(note.tags.join(', '))
    } catch (error) {
      if (request !== openNoteRequestRef.current || workspaceIdRef.current !== activeWorkspaceId) return
      toast.error(error instanceof Error ? error.message : t('notes.toast.openFailed'))
      setActiveNote(null)
      contentRef.current = ''
      dirtyRef.current = false
      setContent('')
      setDirty(false)
      setSaving(false)
    } finally {
      if (request === openNoteRequestRef.current && workspaceIdRef.current === activeWorkspaceId) setLoading(false)
    }
  }, [activeWorkspaceId, t])

  React.useEffect(() => {
    if (!externalChange) return
    const noteId = externalChange.noteId
    externalChangeToastIdRef.current =     toast(t('notes.toast.changedOnDisk'), {
      description: dirtyRef.current ? t('notes.toast.changedOnDiskDesc') : undefined,
      duration: 8000,
      action: {
        label: t('notes.toast.reload'),
        onClick: () => { if (noteId && dirtyRef.current) setSaveRecoveryOpen(true); else if (noteId) void openNote(noteId) },
      },
      onDismiss: () => { setExternalChange(null) },
      onAutoClose: () => { setExternalChange(null) },
    })
    return () => {
      if (externalChangeToastIdRef.current != null) {
        toast.dismiss(externalChangeToastIdRef.current)
      }
    }
  }, [externalChange, openNote, t])

  React.useEffect(() => {
    refreshNotes()
    refreshAssets()
    void refreshIndexHealth()
    if (!activeWorkspaceId) return
    void nativeNotesSync.start(activeWorkspaceId)
      .then(() => nativeNotesSync.flush())
      .catch(error => {
        toast.error(error instanceof Error ? error.message : t('notes.toast.watchFailed'))
      })
    window.electronAPI.watchNotes(activeWorkspaceId).catch(error => {
      toast.error(error instanceof Error ? error.message : t('notes.toast.watchFailed'))
    }).then(() => { void refreshIndexHealth() })
    const unsubscribe = window.electronAPI.onNotesChanged((rawPayload) => {
      const payload = normalizeChangedPayload(rawPayload)
      if (payload.workspaceId !== activeWorkspaceId) return

      if (payload.reason === 'descriptor' && payload.noteId === activeNoteIdRef.current) {
        const noteId = payload.noteId
        const nativeId = activeNoteRef.current?.nativeId ?? noteId
        const opening = openNoteRequestRef.current
        setContentResolution(null)
        void window.electronAPI.resolveContent({ workspaceId: activeWorkspaceId, entityId: `note:${nativeId}` }).then(resolution => {
          if (workspaceIdRef.current !== activeWorkspaceId || activeNoteIdRef.current !== noteId || openNoteRequestRef.current !== opening) return
          setContentResolution(resolution)
          if (resolution.status !== 'ok' || !resolution.capabilities.write) setSaveNeedsReload(true)
        }).catch(() => {
          if (workspaceIdRef.current === activeWorkspaceId && activeNoteIdRef.current === noteId) {
            setContentResolution({ status: 'error', code: 'denied' })
            setSaveNeedsReload(true)
          }
        })
        return
      }
      // Saved-body replies update this view directly; descriptor changes above
      // re-check editing authority while preserving any in-flight draft.
      if (payload.reason !== 'external') return

      refreshNotes()
      refreshAssets()
      void refreshIndexHealth()

      if (payload.noteId && payload.noteId === activeNoteIdRef.current) {
        if (dirtyRef.current) {
          setExternalChange(payload)
        } else {
          openNote(payload.noteId)
        }
      }
    })

    return () => {
      unsubscribe()
      void nativeNotesSync.stop().catch(error => {
        toast.error(error instanceof Error ? error.message : t('notes.toast.watchFailed'))
      })
      window.electronAPI.unwatchNotes(activeWorkspaceId).catch(() => {})
    }
  }, [activeWorkspaceId, openNote, refreshAssets, refreshIndexHealth, refreshNotes, t])

  React.useEffect(() => {
    if (selectedNoteId) {
      void openNote(parseNoteBlockAddress(selectedNoteId).noteId)
      return
    }
    setActiveNote(null)
    contentRef.current = ''
    dirtyRef.current = false
    setContent('')
    setDirty(false)
    setSaveError(null)
    setContentResolution(null)
    ++openNoteRequestRef.current
  }, [selectedNoteId, openNote])

  const noteIds = React.useMemo(
    () => `${activeWorkspaceId ?? ''}:${notes.map(n => `${n.id}:${n.updatedAt}`).join(',')}`,
    [activeWorkspaceId, notes],
  )
  React.useEffect(() => {
    void refreshTasks(notes)
    // Refresh task projections when any note's persisted version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIds])

  const saveNativeNote = React.useCallback(async (note: NoteDocument, markdown: string): Promise<NoteDocument> => {
    const queuedMutation = await nativeNotesSync.queueSave(note, markdown)
    const receipts = await nativeNotesSync.flush()
    const receipt = receipts.find(candidate => candidate.operationId === queuedMutation.operationId)
    if (!receipt) throw new Error(`Native Notes operation ${queuedMutation.operationId} remains pending`)
    const committed = { ...note, content: markdown, nativeRevision: receipt.revision, revision: retainedSourceHash(markdown) }
    try {
      const canonical = await window.electronAPI.readNote(queuedMutation.workspaceId, note.id)
      if (canonical.nativeId === queuedMutation.nativeId && canonical.nativeRevision === receipt.revision && canonical.content === markdown) {
        return { ...canonical, sourceStoreId: note.sourceStoreId, revision: committed.revision }
      }
    } catch { /* The observed main ACK is retained even if the metadata read loses connectivity. */ }
    return committed
  }, [nativeNotesSync])
  const saveCurrentNote = React.useCallback(async (): Promise<boolean> => {
    if (!activeWorkspaceId || !activeNote) return true
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const noteId = activeNote.id
    const currentContent = contentRef.current
    const revisionKey = `${activeWorkspaceId}\0${noteId}`
    const documentGeneration = openNoteRequestRef.current
    const isCurrentDocument = () => activeNoteIdRef.current === noteId && workspaceIdRef.current === activeWorkspaceId && openNoteRequestRef.current === documentGeneration
    const queued = saveQueueRef.current.then(async () => {
      if (workspaceIdRef.current !== activeWorkspaceId || openNoteRequestRef.current !== documentGeneration) return false
      if (isCurrentDocument()) { setSaving(true); setSaveError(null) }
      try {
        const act = soupDocumentActResult({ source: 'native', action: 'write', nativeId: noteId })
        if (!isClaimableLive(act)) return false
        if (!canEditContent || (isCurrentDocument() && saveBlockedRef.current)) return false
        const saved = await writeNoteThroughAuthority(activeNote, activeWorkspaceId, contentResolution, {
          native: () => saveNativeNote(activeNote, currentContent),
          markdown: async () => {
            const expectedRevision = revisionsRef.current.get(revisionKey)
            if (!expectedRevision || contentResolution?.status !== 'ok') throw new Error(t('notes.content.reloadRequired'))
            let command = pendingCommitsRef.current.get(revisionKey)
            if (command) {
              // Unknown responses replay the same legacy operation; native retries belong to main's outbox.
              const replay = await window.electronAPI.commitMarkdown(command)
              revisionsRef.current.set(revisionKey, replay.receipt.revision)
              pendingCommitsRef.current.delete(revisionKey)
            }
            if (!isCurrentDocument()) throw new Error(t('notes.content.previewChanged'))
            command = { workspaceId: activeWorkspaceId, noteId, content: currentContent,
              expectedRevision: revisionsRef.current.get(revisionKey)!, sourceStoreId: activeNote.sourceStoreId,
              authorityEpoch: contentResolution.origin.authorityEpoch, operationId: crypto.randomUUID() }
            pendingCommitsRef.current.set(revisionKey, command)
            const result = await window.electronAPI.commitMarkdown(command)
            pendingCommitsRef.current.delete(revisionKey)
            return { ...result.note, content: currentContent, revision: result.receipt.revision }
          },
        })
        nativeRevisionByNoteRef.current.set(revisionKey, saved.nativeRevision ?? null)
        expectedRevisionByNoteRef.current.set(revisionKey, contentHash(saved.content))
        if (saved.revision) revisionsRef.current.set(revisionKey, saved.revision)
        if (isCurrentDocument()) {
          const stillDirty = contentRef.current !== currentContent
          setActiveNote(saved)
          dirtyRef.current = stillDirty
          setDirty(stillDirty)
          setTagDraft(saved.tags.join(', '))
          setContentResolution(previous => previous && previous.status !== 'error' ? {
            ...previous, content: saved.content, revision: saved.revision!, contentHash: contentHash(saved.content),
            canonicalRef: { ...previous.canonicalRef, revisionId: saved.revision },
          } : previous)
        }
        if (workspaceIdRef.current === activeWorkspaceId) {
          setNotes(prev => prev.map(n => n.id === saved.id ? saved : n))
          taskCacheRef.current.set(saved.id, extractTasks(saved, saved.content))
          taskCacheUpdatedAtRef.current.set(saved.id, saved.updatedAt)
          setAllTasks([...taskCacheRef.current.values()].flat())
        }
        return true
      } catch (error) {
        const code = (error as { code?: string })?.code
        const knownFailures: Record<string, string> = {
          HASH_CONFLICT: 'notes.content.conflict', AUTH_FAILED: 'notes.content.denied', NOT_FOUND: 'notes.content.deleted',
          DOCUMENT_VALIDATION_FAILED: 'notes.content.invalidCommand', DOCUMENT_AUTHORITY_CHANGED: 'notes.content.authorityChanged',
          DOCUMENT_BUSY: 'notes.content.busy', DOCUMENT_RESULT_UNAVAILABLE: 'notes.content.resultUnavailable',
        }
        if (code && knownFailures[code] && code !== 'DOCUMENT_RESULT_UNAVAILABLE') pendingCommitsRef.current.delete(revisionKey)
        const message = code && knownFailures[code] ? t(knownFailures[code]) : t('notes.content.unconfirmedSave')
        if (isCurrentDocument()) {
          if (['HASH_CONFLICT', 'AUTH_FAILED', 'NOT_FOUND', 'DOCUMENT_AUTHORITY_CHANGED', 'DOCUMENT_RESULT_UNAVAILABLE'].includes(code ?? '')) {
            saveBlockedRef.current = true
            setSaveNeedsReload(true)
          }
          setSaveError(message)
          toast.error(message)
        }
        return false
      } finally {
        if (isCurrentDocument()) setSaving(false)
      }
    }).catch((): boolean => false)
    saveQueueRef.current = queued
    return queued
  // contentRef is a ref — intentionally excluded; activeNote.id and activeWorkspaceId are the real deps
  }, [activeWorkspaceId, activeNote, canEditContent, contentResolution, saveNativeNote, t])

  const flushBeforeAction = React.useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    return await saveCurrentNote() && !dirtyRef.current
  }, [saveCurrentNote])

  React.useEffect(() => {
    if (!dirty || !activeWorkspaceId || !activeNote || saveNeedsReload) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      await saveCurrentNote()
    }, 900)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [activeWorkspaceId, activeNote, dirty, saveNeedsReload, saveCurrentNote])

  React.useEffect(() => {
    const request = ++searchRequestRef.current
    if (!activeWorkspaceId) {
      setSearchResults(null)
      return
    }
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    setSearchResults(null)

    const timer = window.setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchNotes(activeWorkspaceId, q)
        if (request === searchRequestRef.current) setSearchResults(results)
      } catch (error) {
        if (request === searchRequestRef.current) {
          toast.error(error instanceof Error ? error.message : t('notes.toast.searchFailed'))
        }
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, query, t])

  React.useEffect(() => {
    setWikiIndex(0)
  }, [wikiQuery])

  React.useEffect(() => {
    setTagDraft(activeNote?.tags.join(', ') ?? '')
  }, [activeNote?.id, activeNote?.tags])

  const visibleNotes = React.useMemo(() => {
    const filtered = filterNotes(searchResults ?? notes, searchResults ? '' : query, selectedTag)
    if (searchResults) return filtered
    // Apply stable sidebar order — new notes (not yet in order) go to front
    const orderIndex = new Map(sidebarOrder.map((id, i) => [id, i]))
    return [...filtered].sort((a, b) => {
      const ia = orderIndex.get(a.id) ?? -1
      const ib = orderIndex.get(b.id) ?? -1
      if (ia === -1 && ib === -1) return b.updatedAt - a.updatedAt
      if (ia === -1) return -1
      if (ib === -1) return 1
      return ia - ib
    })
  }, [notes, sidebarOrder, searchResults, query, selectedTag])
  const folderTree = React.useMemo(() => buildFolderTree(visibleNotes), [visibleNotes])
  const allTags = React.useMemo(() => {
    const tags = new Set<string>()
    notes.forEach(note => note.tags.forEach(tag => tags.add(tag)))
    return [...tags].sort((a, b) => a.localeCompare(b))
  }, [notes])

  const currentProperties = React.useMemo(() => activeNote?.properties ?? {}, [activeNote?.properties])
  const propertyEntries = React.useMemo(
    () => Object.entries(currentProperties).filter(([key]) => key !== 'tags'),
    [currentProperties]
  )
  const propertyProjection = React.useMemo(() => projectFrontmatter(retainSource(content)), [content])
  const richParts = React.useMemo(() => splitFrontmatter(content), [content])
  const dailyDate = parseDailyNoteDate(activeNote?.id)
  const currentNoteAssets = React.useMemo(() => {
    const refs = new Set(activeNote?.assetRefs.map(ref => ref.replace(/^\.\//, '')) ?? [])
    return allAssets.filter(asset => refs.has(asset.relativePath))
  }, [activeNote?.assetRefs, allAssets])
  const uncreatedLinks = React.useMemo(() => {
    const targets = new Map<string, string>()
    activeNote?.links.forEach(link => {
      if (!findNoteByTarget(notes, link.target)) {
        targets.set(normalizeNoteTarget(link.target), link.target)
      }
    })
    return [...targets.values()].sort((a, b) => a.localeCompare(b))
  }, [activeNote?.links, notes])
  const noteInsights = React.useMemo(() => {
    if (!activeNote) return EMPTY_NOTE_INSIGHTS
    return buildVaultInsights({
      documentId: activeNote.id,
      content,
      links: activeNote.links,
      catalog: notes.map((note) => ({
        id: note.id,
        title: note.title,
        aliases: aliasesFromProperties(note.properties),
      })),
      properties: activeNote.properties,
    })
  }, [activeNote, content, notes])
  const orphanAssets = React.useMemo(
    () => allAssets.filter(asset => (asset.referencedBy?.length ?? 0) === 0),
    [allAssets]
  )
  const activeNoteStats = activeNote
    ? `${activeNote.links.length}↗ · ${activeNote.backlinks.length}↙ · ${t('notes.header.charCount', { count: content.length })}`
    : ''
  const activeNoteTasks = React.useMemo(
    () => activeNote ? extractTasks(activeNote, content) : [],
    [activeNote, content]
  )
  const openTasks = React.useMemo(() => allTasks.filter(task => !task.checked), [allTasks])

  const wikiMatches = React.useMemo(() => {
    if (wikiQuery == null) return []
    return matchWikiLinkCandidates(notes, wikiQuery, { excludeId: activeNote?.id, limit: 8 })
  }, [notes, activeNote?.id, wikiQuery])

  const wikiCreateLabel = wikiQuery?.trim()
  const showWikiCreate = !!wikiCreateLabel && !findNoteByTarget(notes, wikiCreateLabel)
  const wikiItemCount = wikiMatches.length + (showWikiCreate ? 1 : 0)
  const wikiCreateSelected = showWikiCreate && wikiIndex >= wikiMatches.length
  const showWikiMenu = wikiQuery != null && wikiItemCount > 0

  const handleCreate = async () => {
    if (!activeWorkspaceId || !createTitle.trim()) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.createNote(
      activeWorkspaceId,
      createTitle.trim(),
      createInFolder,
      mutationOptions(activeWorkspaceId, createTitle.trim(), null),
    )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, note.id), note.nativeRevision ?? null)
    setCreateDialogOpen(false)
    setCreateTitle('')
    setCreateInFolder(undefined)
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const openCreateNoteDialog = (folder?: string) => {
    setCreateTitle('')
    const projectFolder = activeProjectSlug ? `projects/${activeProjectSlug}` : undefined
    setCreateInFolder(folder ?? projectFolder)
    setCreateDialogOpen(true)
  }

  const handleCreateFolder = async () => {
    if (!activeWorkspaceId || !createFolderName.trim()) return
    if (!await flushBeforeAction()) return
    const folder = stripMdExtension(createFolderName.trim()).replace(/^\/+|\/+$/g, '')
    const note = await window.electronAPI.createNote(
      activeWorkspaceId,
      t('notes.untitled'),
      folder,
      mutationOptions(activeWorkspaceId, `${folder}/${t('notes.untitled')}`, null),
    )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, note.id), note.nativeRevision ?? null)
    setCreateFolderDialogOpen(false)
    setCreateFolderName('')
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const handleDaily = async (date?: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.getDailyNote(activeWorkspaceId, date)
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const handleDailyShift = async (deltaDays: number) => {
    const baseDate = dailyDate ?? todayDateString()
    await handleDaily(shiftDateString(baseDate, deltaDays))
  }

  const openRenameDialog = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    setRenameTitle(activeNote.title)
    setRenameImpact(null)
    setRenameDialogOpen(true)
  }

  const openRenameDialogForNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    setActiveNote(document)
    expectedRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, document.id), contentHash(document.content))
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, document.id), document.nativeRevision ?? null)
    contentRef.current = document.content
    dirtyRef.current = false
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setRenameTitle(document.title)
    setRenameImpact(null)
    setRenameDialogOpen(true)
    navigate(routes.view.notes(document.id))
  }

  const openDeleteDialogForNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    setActiveNote(document)
    expectedRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, document.id), contentHash(document.content))
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, document.id), document.nativeRevision ?? null)
    dirtyRef.current = false
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setDeleteDialogOpen(true)
    navigate(routes.view.notes(document.id))
  }

  const editTableCell = React.useCallback(async (
    noteId: string,
    field: 'title' | 'tags' | `property:${string}`,
    value: string,
  ) => {
    if (!activeWorkspaceId) return
    if (activeNote?.id === noteId && !await flushBeforeAction()) return
    const act = soupDocumentActResult({ source: 'native', action: 'write', nativeId: noteId })
    if (!isClaimableLive(act)) return

    try {
      if (field === 'title') {
        const title = value.trim()
        if (!title) return
        const renamedDocument = await window.electronAPI.readNote(activeWorkspaceId, noteId)
        const renamed = await window.electronAPI.renameNote(
          activeWorkspaceId,
          noteId,
          title,
          mutationOptions(activeWorkspaceId, noteId, renamedDocument.nativeRevision),
        )
        nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, noteId), renamed.note.nativeRevision ?? null)
        await refreshNotes()
        if (activeNote?.id === noteId) navigate(routes.view.notes(renamed.note.id))
        return
      }

      const document = await window.electronAPI.readNote(activeWorkspaceId, noteId)
      nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, noteId), document.nativeRevision ?? null)
      const properties = { ...document.properties }
      if (field === 'tags') {
        properties.tags = value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
      } else {
        const key = field.slice('property:'.length)
        const previous = properties[key]
        properties[key] = parseNotePropertyValue(previous, value)
      }
      const updated = await window.electronAPI.updateNoteProperties(
        activeWorkspaceId,
        noteId,
        properties,
        mutationOptions(activeWorkspaceId, noteId, document.nativeRevision),
      )
      nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, noteId), updated.nativeRevision ?? null)
      if (activeNote?.id === noteId) {
        setActiveNote(updated)
        contentRef.current = updated.content
        dirtyRef.current = false
        setContent(updated.content)
        expectedRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, noteId), contentHash(updated.content))
        setDirty(false)
        setTagDraft(updated.tags.join(', '))
      }
      await refreshNotes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.updatePropertiesFailed'))
    }
  }, [activeNote, activeWorkspaceId, flushBeforeAction, mutationOptions, refreshNotes, t])

  const duplicateNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    const title = `${document.title} copy`
    const created = await window.electronAPI.createNote(
      activeWorkspaceId,
      title,
      noteFolder(note) || undefined,
      mutationOptions(activeWorkspaceId, title, null),
    )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, created.id), created.nativeRevision ?? null)
    const duplicateContent = updateMarkdownTitle(document.content, title)
    const saved = isNativeNoteDocument(created)
      ? await saveNativeNote(created, duplicateContent)
      : await window.electronAPI.saveNote(
        activeWorkspaceId,
        created.id,
        duplicateContent,
        created.revision,
        created.sourceStoreId,
      )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, saved.id), saved.nativeRevision ?? null)
    await refreshNotes()
    navigate(routes.view.notes(saved.id))
    toast.success(t('notes.toast.duplicated'))
  }

  const openMoveDialog = (note: NoteSummary) => {
    setMoveTargetNote(note)
    setMoveFolderName(noteFolder(note))
    setMoveDialogOpen(true)
  }

  const moveNoteToFolder = async () => {
    if (!activeWorkspaceId || !moveTargetNote) return
    if (!await flushBeforeAction()) return
    const folder = stripMdExtension(moveFolderName.trim()).replace(/^\/+|\/+$/g, '')
    if (folder === noteFolder(moveTargetNote)) {
      setMoveDialogOpen(false)
      return
    }
    try {
      const document = await window.electronAPI.readNote(activeWorkspaceId, moveTargetNote.id)
      const moved = await window.electronAPI.moveNote(
        activeWorkspaceId,
        moveTargetNote.id,
        folder,
        mutationOptions(activeWorkspaceId, moveTargetNote.id, document.nativeRevision),
      )
      nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, moved.note.id), moved.note.nativeRevision ?? null)
      setMoveDialogOpen(false)
      setMoveTargetNote(null)
      setMoveFolderName('')
      await refreshNotes()
      navigate(routes.view.notes(moved.note.id))
      toast.success(t('notes.toast.moved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.moveFailed'))
    }
  }

  const moveSilently = async (note: NoteSummary, targetFolder: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    try {
      const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
      const moved = await window.electronAPI.moveNote(
        activeWorkspaceId,
        note.id,
        targetFolder,
        mutationOptions(activeWorkspaceId, note.id, document.nativeRevision),
      )
      nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, moved.note.id), moved.note.nativeRevision ?? null)
      await refreshNotes()
      navigate(routes.view.notes(moved.note.id))
      toast.success(t('notes.toast.moved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.moveFailed'))
    }
  }

  const handleSidebarDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    if (active.data.current?.type !== 'note' || over.data.current?.type !== 'folder') return
    const note = active.data.current.note as NoteSummary
    const targetFolder = over.data.current.folder as string
    if (noteFolder(note) === targetFolder) return
    void moveSilently(note, targetFolder)
  }

  const copyNoteLink = async (note: NoteSummary) => {    await navigator.clipboard.writeText(`[[${note.title}]]`)
    toast.success(t('notes.toast.linkCopied'))
  }

  const openRenameFolderDialog = (folder: string) => {
    setRenameFolderTarget(folder)
    setRenameFolderName(folder.split('/').pop() ?? folder)
    setRenameFolderDialogOpen(true)
  }

  const handleRenameFolder = async () => {
    if (!activeWorkspaceId || !renameFolderTarget || !renameFolderName.trim()) return
    try {
      await window.electronAPI.renameFolderNote(activeWorkspaceId, renameFolderTarget, renameFolderName.trim())
      setRenameFolderDialogOpen(false)
      setRenameFolderTarget('')
      setRenameFolderName('')
      await refreshNotes()
      toast.success(t('notes.toast.folderRenamed'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.renameFolderFailed'))
    }
  }

  const openDeleteFolderDialog = (folder: string) => {
    setDeleteFolderTarget(folder)
    setDeleteFolderDialogOpen(true)
  }

  const handleDeleteFolder = async () => {
    if (!activeWorkspaceId || !deleteFolderTarget) return
    try {
      const result = await window.electronAPI.deleteFolderNote(activeWorkspaceId, deleteFolderTarget)
      setDeleteFolderDialogOpen(false)
      setDeleteFolderTarget('')
      if (activeNote && result.deletedNotes.includes(activeNote.id)) {
        setActiveNote(null)
        contentRef.current = ''
        dirtyRef.current = false
        setContent('')
        setDirty(false)
        navigate(routes.view.notes())
      }
      await refreshNotes()
      toast.success(t('notes.toast.deletedFolder', { count: result.deletedNotes.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.deleteFolderFailed'))
    }
  }

  const copyNotePath = async (note: NoteSummary) => {
    await navigator.clipboard.writeText(`notes/${note.relativePath}`)
    toast.success(t('notes.toast.pathCopied'))
  }

  const revealNote = async (note: NoteSummary) => {
    await window.electronAPI.showInFolder(note.path)
  }

  const refreshRenameImpact = React.useCallback(async (title: string) => {
    if (!activeWorkspaceId || !activeNote || activeNote.nativeRevision !== undefined || !title.trim() || title.trim() === activeNote.title) {
      setRenameImpact(null)
      return
    }
    try {
      const impact = await window.electronAPI.getNoteRenameImpact(activeWorkspaceId, activeNote.id, title.trim())
      setRenameImpact(impact)
    } catch {
      setRenameImpact(null)
    }
  }, [activeWorkspaceId, activeNote])

  React.useEffect(() => {
    if (!renameDialogOpen) return
    const timer = window.setTimeout(() => {
      refreshRenameImpact(renameTitle)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [renameDialogOpen, renameTitle, refreshRenameImpact])

  const handleRename = async () => {
    if (!activeWorkspaceId || !activeNote || !renameTitle.trim() || renameTitle.trim() === activeNote.title) return
    const result = await window.electronAPI.renameNote(
      activeWorkspaceId,
      activeNote.id,
      renameTitle.trim(),
      mutationOptions(activeWorkspaceId, activeNote.id, activeNote.nativeRevision),
    )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, activeNote.id), result.note.nativeRevision ?? null)
    setRenameDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notes(result.note.id))
    if (activeNote.nativeRevision === undefined) {
      toast.success(t('notes.toast.updatedLinkedNotes', { count: result.updatedNotes.length }))
    }
  }

  const handleDelete = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const act = soupDocumentActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: activeNote.id,
    })
    if (!isClaimableLive(act)) return
    await window.electronAPI.deleteNote(
      activeWorkspaceId,
      activeNote.id,
      mutationOptions(activeWorkspaceId, activeNote.id, activeNote.nativeRevision),
    )
    setDeleteDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notes())
  }

  const applyPropertyPreview = React.useCallback(async (request: { workspaceId: string; noteId: string; preview: PropertyDictionaryPreview; createdProperty?: { key: string; value: string } }) => {
    if (request.workspaceId !== workspaceIdRef.current || request.noteId !== activeNoteIdRef.current
      || retainedSourceHash(contentRef.current) !== request.preview.expectedRevision) {
      toast.error(t('notes.content.previewChanged')); return false
    }
    contentRef.current = request.preview.content
    dirtyRef.current = true
    setContent(request.preview.content)
    setDirty(true)
    setPropertyPreview(null)
    const saved = await saveCurrentNote()
    if (saved) {
      await refreshNotes()
      if (request.createdProperty) {
        const created = request.createdProperty
        setNewPropertyKey(current => current.trim() === created.key ? '' : current)
        setNewPropertyValue(current => current === created.value ? '' : current)
      }
    }
    return saved
  }, [saveCurrentNote, refreshNotes, t])

  const updateProperty = React.useCallback(async (key: string, value: unknown | undefined, createdProperty?: { key: string; value: string }) => {
    if (!activeWorkspaceId || !activeNote) return false
    if (!canEditContent) { toast.error(t('notes.content.readOnly')); return false }
    if (!await flushBeforeAction()) return false
    const properties = { ...activeNote.properties }
    if (value === undefined) {
      delete properties[key]
    } else {
      properties[key] = value
    }
    try {
      const preview = previewPropertyDictionary(contentRef.current, activeNote.properties, properties)
      const request = { workspaceId: activeWorkspaceId, noteId: activeNote.id, preview, createdProperty }
      if (preview.requiresReview) { setPropertyPreview(request); return false }
      return await applyPropertyPreview(request)
    } catch (error) {
      toast.error(t('notes.toast.updatePropertiesFailed'))
      return false
    }
  }, [activeWorkspaceId, activeNote, canEditContent, flushBeforeAction, applyPropertyPreview, t])

  const updateScalarProperty = React.useCallback(async (path: string[], value: PropertyValue): Promise<boolean> => {
    if (!activeWorkspaceId || !activeNote || !canEditContent || !await flushBeforeAction()) return false
    const source = retainSource(contentRef.current)
    const preview = previewPropertyPatch(source, path, value)
    if ('status' in preview) { toast.error(t('notes.content.propertySourceReadOnly')); return false }
    const applied = applyPropertyPatch(source, preview)
    if (applied.status !== 'ok') { toast.error(t('notes.content.previewChanged')); return false }
    const next = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(applied.bytes)
    return await applyPropertyPreview({ workspaceId: activeWorkspaceId, noteId: activeNote.id, preview: {
      expectedRevision: source.sourceHash, content: next, requiresReview: false,
      before: '', after: '', digest: preview.digest,
    } })
  }, [activeWorkspaceId, activeNote, canEditContent, flushBeforeAction, applyPropertyPreview, t])

  const applyTags = React.useCallback(() => {
    const tags = tagDraft.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
    void updateProperty('tags', tags)
  }, [tagDraft, updateProperty])

  const addProperty = React.useCallback(() => {
    const key = newPropertyKey.trim()
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      toast.error(t('notes.toast.propertyKeyInvalid'))
      return
    }
    // New fields are text by default; changing type is an explicit operation.
    void updateProperty(key, newPropertyValue, { key, value: newPropertyValue })
  }, [newPropertyKey, newPropertyValue, updateProperty, t])

  const insertAtCursor = (text: string) => {
    if (!canEditContent) return
    const editor = richEditorRef.current
    if (editor) {
      editor.chain().focus().insertContent(text).run()
      return
    }
    const next = `${contentRef.current}${contentRef.current && !contentRef.current.endsWith('\n') ? '\n' : ''}${text}`
    contentRef.current = next
    setContent(next)
    dirtyRef.current = true
    setDirty(true)
  }

  const applyNoteMarkdown = (next: string) => {
    if (!canEditContent) return
    contentRef.current = next
    dirtyRef.current = true
    setContent(next)
    dirtyRef.current = true
    setDirty(true)
    const editor = richEditorRef.current
    if (editor) {
      editor.commands.setContent(splitFrontmatter(next).body)
    }
  }

  const importFiles = React.useCallback(async (files: File[] | FileList) => {
    if (!activeWorkspaceId || !activeNote) return
    const list = Array.from(files)
    if (list.length === 0) return
    try {
      const snippets: string[] = []
      for (const file of list) {
        const attachment = await fileToAttachment(file)
        const result = await window.electronAPI.importNoteAsset(activeWorkspaceId, attachment)
        snippets.push(result.markdown)
      }
      insertAtCursor(snippets.join('\n'))
      await refreshAssets()
      toast.success(t('notes.toast.importedAssets', { count: list.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.importAssetFailed'))
    }
  }, [activeWorkspaceId, activeNote, refreshAssets, t])

  const handleImportAsset = async () => {
    if (!activeWorkspaceId || !activeNote) return
    const paths = await window.electronAPI.openFileDialog()
    const path = paths[0]
    if (!path) return
    const attachment = await window.electronAPI.readUserAttachment(path)
    if (!attachment) {
      toast.error(t('notes.toast.readFileFailed'))
      return
    }
    const result = await window.electronAPI.importNoteAsset(activeWorkspaceId, attachment)
    insertAtCursor(result.markdown)
    await refreshAssets()
  }

  const handleExportPdf = async () => {
    if (!activeNote || !richEditorRef.current) return
    const editorDom = richEditorRef.current.view.dom as HTMLElement
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:2em auto;line-height:1.6;color:#111}
pre{background:#f4f4f4;padding:1em;border-radius:4px;overflow-x:auto}
code{font-family:monospace;font-size:.9em}img{max-width:100%}
h1,h2,h3{margin-top:1.5em}
</style></head><body><h1>${activeNote.title.replace(/</g,'&lt;')}</h1>${editorDom.innerHTML}</body></html>`
    const result = await window.electronAPI.exportNotePdf({ html, defaultPath: `${activeNote.title}.pdf` })
    if (!result.canceled) toast.success(t('notes.toast.exportedPdf'))
  }

  const handleRichBodyChange = (nextBody: string) => {
    if (!canEditContent) return
    const next = mergeFrontmatter(richParts.frontmatter, nextBody)
    if (next === contentRef.current) return
    contentRef.current = next
    dirtyRef.current = true
    setContent(next)
    setDirty(true)
    setSaveError(null)
    updateWikiQueryAndAnchor()
  }

  const updateWikiQueryAndAnchor = React.useCallback(() => {
    const editor = richEditorRef.current
    const query = findRichWikiQuery(editor)
    setWikiQuery(query)
    if (query !== null && editor) {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        const editorDom = editor.view.dom.closest('.overflow-y-auto')
        const rect = editorDom?.getBoundingClientRect() ?? { left: 0, top: 0 }
        setWikiAnchor({ x: coords.left - rect.left, y: coords.bottom - rect.top + 4 })
      } catch {
        setWikiAnchor(null)
      }
    } else {
      setWikiAnchor(null)
    }
  }, [])

  const syncRichWikiQuery = React.useCallback(() => {
    updateWikiQueryAndAnchor()
  }, [updateWikiQueryAndAnchor])

  const handleOpenNote = async (noteId: string) => {
    if (!await flushBeforeAction()) return
    navigate(routes.view.notes(noteId))
  }

  const openWikiLinkAtCursor = async () => {
    const target = findRichWikiLinkAtCursor(richEditorRef.current)
    if (!target) return
    const address = parseNoteBlockAddress(target)
    const note = findNoteByTarget(notes, address.noteId)
    if (note) {
      await handleOpenNote(note.id + (address.blockId ? '#^' + address.blockId : ''))
      return
    }
    setMissingLinkTarget(target)
  }

  const completeWikiLink = (note: NoteSummary) => {
    completeWikiText(note.title)
  }

  const completeWikiText = (text: string) => {
    const editor = richEditorRef.current
    const range = findRichWikiQueryRange(editor)
    if (!editor || !range || !text.trim()) return
    editor.chain().focus().deleteRange(range).insertContent(`[[${text.trim()}]]`).run()
    setWikiQuery(null)
  }

  const completeWikiCreate = async (raw: string) => {
    if (!activeWorkspaceId || !raw.trim()) return
    const { title, folder } = parseWikiCreateTarget(raw)
    if (!title) return
    try {
      const created = await window.electronAPI.createNote(
        activeWorkspaceId,
        title,
        folder,
        mutationOptions(activeWorkspaceId, `${folder ?? ''}/${title}`, null),
      )
      nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, created.id), created.nativeRevision ?? null)
      completeWikiText(created.title)
      await refreshNotes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.editor.wikiCreateFailed'))
    }
  }

  const createMissingLinkNote = React.useCallback(async () => {
    if (!activeWorkspaceId || !missingLinkTarget) return
    const cleanTarget = stripMdExtension(missingLinkTarget)
    const parts = cleanTarget.split('/').filter(Boolean)
    const title = parts.pop() || cleanTarget
    const created = await window.electronAPI.createNote(
      activeWorkspaceId,
      title,
      parts.length > 0 ? parts.join('/') : undefined,
      mutationOptions(activeWorkspaceId, `${parts.join('/')}/${title}`, null),
    )
    nativeRevisionByNoteRef.current.set(noteRevisionKey(activeWorkspaceId, created.id), created.nativeRevision ?? null)
    setMissingLinkTarget(null)
    await refreshNotes()
    navigate(routes.view.notes(created.id))
  }, [activeWorkspaceId, missingLinkTarget, refreshNotes])

  const AI_PROMPTS: Record<AIActionMode, { sessionNameKey: string; instructionKey: string }> = {
    'analyze': {
      sessionNameKey: 'notes.ai.sessionAnalyze',
      instructionKey: 'notes.ai.promptAnalyze',
    },
    'expand': {
      sessionNameKey: 'notes.ai.sessionExpand',
      instructionKey: 'notes.ai.promptExpand',
    },
    'summarize': {
      sessionNameKey: 'notes.ai.sessionSummarize',
      instructionKey: 'notes.ai.promptSummarize',
    },
    'extract-tasks': {
      sessionNameKey: 'notes.ai.sessionExtractTasks',
      instructionKey: 'notes.ai.promptExtractTasks',
    },
  }

  const presetTagVocabulary = React.useMemo(() => {
    const tags = new Set<string>()
    const walk = (nodes: typeof labels) => {
      for (const node of nodes) {
        if (node.name?.trim()) tags.add(node.name.trim())
        if (node.children?.length) walk(node.children)
      }
    }
    walk(labels)
    for (const status of sessionStatuses) {
      if (status.label?.trim()) tags.add(status.label.trim())
    }
    // Stable product vocabulary extras (sidebar states)
    for (const key of ['sidebar.flagged', 'sidebar.archived', 'kanban.column.backlog', 'kanban.column.todo', 'kanban.column.inProgress', 'kanban.column.needsReview', 'kanban.column.done'] as const) {
      const label = t(key)
      if (label && label !== key) tags.add(label)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [labels, sessionStatuses, t])

  const openNotesRightSession = React.useCallback(async (opts: {
    sessionName: string
    prompt: string
    chip: { title: string; path: string }
  }) => {
    if (!activeWorkspaceId || !activeNote) return
    const entity = bindNativeNote({
      id: activeNote.id,
      title: activeNote.title,
      workspaceId: activeWorkspaceId,
      updatedAt: activeNote.updatedAt,
    })
    const surface = {
      workspaceId: activeWorkspaceId,
      surfaceId: NOTES_SURFACE_ID,
      entityRefs: [entity.id],
      permissionMode: 'allow-all' as const,
      revisionByEntityId: revisionByEntityId(entity.id, activeNote.updatedAt),
    }
    if (describeRightSessionOpen(rightSessionContext, surface) === 'reuse') {
      setRightSessionFocusToken((n) => n + 1)
      return
    }
    const session = await onCreateSession(activeWorkspaceId, { name: opts.sessionName, model: NOTES_AI_MODEL })
    const ctx = bindRightSessionContext({ ...surface, sessionId: session.id })
    // Prefill only — do NOT auto-send. Keep note open; open side session panel.
    onInputChange(session.id, opts.prompt)
    setRightSessionContext(ctx)
    setSideSessionPrompt(opts.prompt)
    setSideNoteChip(opts.chip)
    setRightSessionFocusToken((n) => n + 1)
  }, [activeWorkspaceId, activeNote, rightSessionContext, onCreateSession, onInputChange])

  const handleAskAgent = async (mode: AIActionMode = 'extract-tasks') => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const { sessionNameKey } = AI_PROMPTS[mode]
    const attachPath = `notes/${activeNote.relativePath}`
    const attachTitle = activeNote.title
    const storedPrompts = parseNotesAiPrompts(typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTES_AI_PROMPTS_STORAGE_KEY))
    const instruction = resolveNotesAiInstruction(mode, t, storedPrompts)
    const prompt = [
      t('notes.ai.contextHeader', { title: attachTitle }),
      t('notes.ai.contextPath', { path: attachPath }),
      t('notes.ai.contextTags', {
        tags: activeNote.tags.length ? activeNote.tags.map(tag => `#${tag}`).join(' ') : t('notes.inspector.none'),
      }),
      t('notes.ai.contextBacklinks', {
        links: activeNote.backlinks.length
          ? activeNote.backlinks.map(link => link.title).join(', ')
          : t('notes.inspector.none'),
      }),
      t('notes.ai.contextOpenTasks', {
        count: activeNoteTasks.filter(task => !task.checked).length,
      }),
      '',
      '```markdown',
      content,
      '```',
      '',
      instruction,
    ].join('\n')
    await openNotesRightSession({
      sessionName: `${t(sessionNameKey)}: ${activeNote.title}`,
      prompt,
      chip: { title: attachTitle, path: attachPath },
    })
  }

  const handleBoundChat = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const attachPath = `notes/${activeNote.relativePath}`
    const prompt = [
      t('notes.ai.contextHeader', { title: activeNote.title }),
      t('notes.ai.contextPath', { path: attachPath }),
      '',
    ].join('\n')
    await openNotesRightSession({
      sessionName: activeNote.title,
      prompt,
      chip: { title: activeNote.title, path: attachPath },
    })
  }

  const closeSideSession = React.useCallback(() => {
    setRightSessionContext(null)
    setSideSessionPrompt('')
    setSideNoteChip(null)
  }, [])

  const sendSideSession = React.useCallback(() => {
    if (!sideSessionId) return
    const draft = (getDraft(sideSessionId) || sideSessionPrompt).trim()
    if (!draft) return
    onSendMessage(sideSessionId, draft)
    onInputChange(sideSessionId, '')
    setSideSessionPrompt('')
  }, [sideSessionId, sideSessionPrompt, getDraft, onSendMessage, onInputChange])

  const openAssetRenameDialog = (asset: NoteAsset) => {
    setAssetRenameTarget(asset)
    setAssetRenameName(asset.name)
  }

  const handleRenameAsset = async () => {
    if (!activeWorkspaceId || !assetRenameTarget || !assetRenameName.trim()) return
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.renameNoteAsset(activeWorkspaceId, assetRenameTarget.relativePath, assetRenameName.trim())
      setAssetRenameTarget(null)
      setAssetRenameName('')
      await refreshAssets()
      await refreshNotes()
      if (activeNote) await openNote(activeNote.id)
      toast.success(t('notes.toast.updatedNotes', { count: result.updatedNotes.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.renameAssetFailed'))
    } finally {
      setAssetBusy(false)
    }
  }

  const handleDeleteAsset = async (asset: NoteAsset) => {
    if (!activeWorkspaceId) return
    setAssetBusy(true)
    try {
      await window.electronAPI.deleteNoteAsset(activeWorkspaceId, asset.relativePath)
      await refreshAssets()
      await refreshNotes()
      toast.success(t('notes.toast.assetDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.deleteAssetFailed'))
    } finally {
      setAssetBusy(false)
    }
  }

  const handleCleanUnusedAssets = async () => {
    if (!activeWorkspaceId || orphanAssets.length === 0) return
    setAssetBusy(true)
    try {
      for (const asset of orphanAssets) {
        await window.electronAPI.deleteNoteAsset(activeWorkspaceId, asset.relativePath)
      }
      await refreshAssets()
      toast.success(t('notes.toast.cleanedAssets', { count: orphanAssets.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.toast.cleanAssetsFailed'))
    } finally {
      setAssetBusy(false)
    }
  }

  const toggleTask = async (task: NoteTask) => {
    if (!activeWorkspaceId) return
    const workspaceId = activeWorkspaceId
    const opening = openNoteRequestRef.current
    const wasActive = activeNoteIdRef.current === task.noteId
    try {
      if (wasActive && !await flushBeforeAction()) return
      const draft = contentRef.current
      const document = await window.electronAPI.readNote(workspaceId, task.noteId)
      if (workspaceIdRef.current !== workspaceId) return
      const lines = document.content.split(/(?<=\n)/)
      const index = task.line - 1
      if (!lines[index] || !/\[([ xX])\]/.test(lines[index])) return
      lines[index] = lines[index].replace(/\[([ xX])\]/, task.checked ? '[ ]' : '[x]')
      const next = lines.join('')
      if (wasActive) {
        // Apply to this exact live draft, then use the same serialized save path
        // as text/property edits. A later ACK cannot replace a newly opened note.
        if (openNoteRequestRef.current !== opening || activeNoteIdRef.current !== task.noteId
          || contentRef.current !== draft || dirtyRef.current || draft !== document.content) return
        contentRef.current = next
        dirtyRef.current = true
        setContent(next)
        setDirty(true)
        await saveCurrentNote()
      } else {
        const resolution = window.electronAPI.isChannelAvailable(RPC_CHANNELS.content.RESOLVE)
          ? await window.electronAPI.resolveContent({ workspaceId, entityId: `note:${document.nativeId ?? document.id}` })
          : null
        if (workspaceIdRef.current !== workspaceId) return
        if (resolution && resolution.status !== 'error') document.sourceStoreId = resolution.origin.sourceStoreId
        const saved = await writeNoteThroughAuthority(document, workspaceId, resolution, {
          native: () => saveNativeNote(document, next),
          markdown: () => window.electronAPI.saveNote(workspaceId, task.noteId, next, document.revision, document.sourceStoreId),
        })
        nativeRevisionByNoteRef.current.set(noteRevisionKey(workspaceId, saved.id), saved.nativeRevision ?? null)
        taskCacheUpdatedAtRef.current.set(saved.id, saved.updatedAt)
        if (activeNoteIdRef.current !== task.noteId || workspaceIdRef.current !== workspaceId) revisionsRef.current.set(`${workspaceId}\0${task.noteId}`, saved.revision!)
        if (workspaceIdRef.current !== workspaceId) return
        taskCacheRef.current.set(saved.id, extractTasks(saved, saved.content))
        setAllTasks([...taskCacheRef.current.values()].flat())
        setNotes(prev => prev.map(note => note.id === saved.id ? saved : note))
      }
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) toast.error(error instanceof Error ? error.message : t('notes.toast.saveFailed'))
    }
  }

  const toggleInspector = React.useCallback(() => {
    setInspectorCollapsed(prev => {
      const next = !prev
      localStorage.setItem('notes:inspector-collapsed', JSON.stringify(next))
      return next
    })
  }, [])

  const handleRichEditorReady = React.useCallback((editor: TiptapEditorHandle | null) => {
    richEditorRef.current = editor
  }, [])

  React.useEffect(() => {
    if (!activeNote) {
      setFoldedHeadingIds([])
      return
    }
    setFoldedHeadingIds(parsePersistedFolds(localStorage.getItem(notesFoldStorageKey(activeNote.id))))
  }, [activeNote?.id])

  const markdownComments = React.useMemo(
    () => extractComments(content).map((comment) => ({
      id: comment.id,
      quote: comment.quote,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    [content],
  )

  const commandCatalog = React.useMemo(() => {
    const sessions = [...sessionMetaMap.values()].slice(0, 20).map((session) => ({
      id: session.id,
      title: session.name || session.preview || session.id,
    }))
    const refs = peopleAndEntitiesFromInsights(
      noteInsights.entities,
      notes.map((note) => note.properties ?? {}),
    )
    return defaultNoteCommands({
      sessions,
      agents: [{ id: 'rox', label: 'Rox' }],
      projects: projects.slice(0, 20).map((project) => ({ id: project.id, name: project.name || project.slug || project.id })),
      tasks: allTasks.slice(0, 20).map((task) => ({ id: `${task.noteId}:${task.line}`, text: task.text })),
      people: refs.people.slice(0, 20),
      entities: refs.entities.slice(0, 20),
    })
  }, [allTasks, noteInsights.entities, notes, projects, sessionMetaMap])

  const commandMatches = React.useMemo(
    () => (commandQuery ? matchNoteCommands(commandQuery, commandCatalog) : []),
    [commandCatalog, commandQuery],
  )
  React.useEffect(() => setCommandIndex(0), [commandQuery])

  const applyCommandItem = React.useCallback((item: (typeof commandCatalog)[number]) => {
    const editor = richEditorRef.current
    if (!editor || !commandQuery) return
    const to = editor.state.selection.from
    const from = Math.max(0, to - commandQuery.length)
    const snippet = snippetForColumnCommand(item.id)
    editor.chain().focus().deleteRange({ from, to }).insertContent(snippet ?? item.insert).run()
    setCommandQuery(null)
    if (item.subject === 'action' && item.id === 'bang:ask-agent') void handleAskAgent('summarize')
    if (item.subject === 'session') navigate(routes.view.allSessions(item.insert.replace('@session:', '')))
  }, [commandQuery])

  const wikiMenu = showWikiMenu ? (
    <div
      className="absolute z-20 w-80 rounded-[8px] border border-border/70 bg-popover p-1 shadow-strong"
      data-testid="notes-wiki-menu"
      style={wikiAnchor
        ? { left: Math.max(4, wikiAnchor.x), top: wikiAnchor.y }
        : { left: 24, bottom: 24 }
      }
    >
      {wikiMatches.map(note => (
        <button
          key={note.id}
          onClick={() => completeWikiLink(note)}
          className={cn(
            'w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]',
            wikiMatches[wikiIndex]?.id === note.id && 'bg-foreground/[0.08]'
          )}
        >
          <div className="truncate text-xs font-medium">{note.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{wikiMatchSubtitle(note, wikiQuery ?? '')}</div>
        </button>
      ))}
      {showWikiCreate && wikiCreateLabel ? (
        <button
          data-testid="notes-wiki-create"
          onClick={() => { void completeWikiCreate(wikiCreateLabel) }}
          className={cn(
            'mt-1 flex w-full items-center gap-2 rounded-[6px] border-t border-border/60 px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]',
            wikiCreateSelected && 'bg-foreground/[0.08]',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('notes.editor.wikiCreate', { title: wikiCreateLabel })}
        </button>
      ) : null}
      <div className="border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        {t('notes.editor.wikiHint')}
      </div>
    </div>
  ) : null

  if (!activeWorkspaceId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('notes.empty.selectWorkspace')}</div>
  }

  // Display-only: rails the user left open auto-hide (comments first, then
  // the outline) while the note column would drop below NOTE_COLUMN_MIN.
  // Persisted rail preferences are untouched.
  const NOTE_COLUMN_MIN = 460
  const noteColumnWidth = (toc: boolean, comments: boolean) =>
    docRowWidth - (toc ? railLayout.toc : 0) - (comments ? railLayout.comments : 0)
  const roomFor = (toc: boolean, comments: boolean) =>
    docRowWidth <= 0 || noteColumnWidth(toc, comments) >= NOTE_COLUMN_MIN
  const commentsShown = !railLayout.commentsCollapsed
    && (Boolean(commentDraftQuote) || roomFor(!railLayout.tocCollapsed, true))
  const tocShown = !railLayout.tocCollapsed && roomFor(true, commentsShown)

  return (
    <>
    <NotesEditorHeadlineStyles />
    <div className="notes-shell flex h-full min-w-0">
      <aside
        className="notes-side-surface shrink-0 flex flex-col min-h-0"
        style={{ width: railLayout.vaultCollapsed ? 0 : railLayout.vault }}
        hidden={railLayout.vaultCollapsed}
        data-testid="notes-vault-rail"
      >
        <div className="shrink-0 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('notes.search.placeholder')}
                className="h-7 w-full rounded-[6px] border-0 bg-foreground/[0.06] pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:bg-foreground/[0.09]"
              />
            </div>
            <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDaily()} title={t('notes.toolbar.daily')}>
              <CalendarDays className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => setCreateFolderDialogOpen(true)} title={t('notes.toolbar.newFolder')}>
              <FolderPlus className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => openCreateNoteDialog()} title={t('notes.toolbar.newNote')}>
              <FilePlus2 className="h-4 w-4" />
            </button>
          </div>
          {allTags.length > 0 && (
            <div className="mt-2 max-h-36 overflow-y-auto rounded-[10px] bg-foreground/[0.03] p-1">
              <button
                className={cn(
                  'flex w-full items-center rounded-[6px] px-2 py-1 text-left text-[11px] hover:bg-foreground/[0.06]',
                  !selectedTag && 'bg-foreground/[0.08]'
                )}
                onClick={() => setSelectedTag(null)}
              >
                {t('notes.tags.all')}
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={cn(
                    'flex w-full items-center rounded-[6px] px-2 py-1 text-left text-[11px] hover:bg-foreground/[0.06]',
                    selectedTag === tag && 'bg-foreground/[0.08]'
                  )}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <DndContext sensors={dndSensors} onDragEnd={handleSidebarDragEnd}>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {(folderTree.rootNotes.length > 0 || folderTree.folders.length > 0) ? (
            <>
              {/* Root-level notes (no folder) */}
              {folderTree.rootNotes.map(note => (
                <DraggableNoteItem key={note.id} note={note}>
                  {(isDragging, dragListeners) => (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          onClick={() => handleOpenNote(note.id)}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
                          className={cn(
                            'notes-list-item mb-0.5 w-full rounded-[6px] px-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                            activeNote?.id === note.id && 'notes-list-item-active',
                            isDragging && 'opacity-50'
                          )}
                          {...dragListeners}
                        >
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                            <div className="min-w-0 flex-1 truncate text-sm">{note.title}</div>
                          </div>
                          {note.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1 pl-5">
                              {note.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="rounded-[4px] bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </button>
                      </ContextMenuTrigger>
                      <StyledContextMenuContent>
                        <StyledContextMenuItem onClick={() => handleOpenNote(note.id)}>
                          <FileText className="h-3.5 w-3.5" />
                          {t('common.open')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openRenameDialogForNote(note)}>
                          <Pencil className="h-3.5 w-3.5" />
                          {t('common.rename')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openCreateNoteDialog()}>
                          <FilePlus2 className="h-3.5 w-3.5" />
                          {t('notes.menu.newHere')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => duplicateNote(note)}>
                          <Copy className="h-3.5 w-3.5" />
                          {t('notes.menu.duplicate')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openMoveDialog(note)}>
                          <FolderInput className="h-3.5 w-3.5" />
                          {t('notes.menu.moveToFolder')}
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem onClick={() => copyNoteLink(note)}>
                          <Link2 className="h-3.5 w-3.5" />
                          {t('notes.menu.copyLink')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => copyNotePath(note)}>
                          <FileText className="h-3.5 w-3.5" />
                          {t('notes.menu.copyPath')}
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => revealNote(note)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t('notes.menu.reveal')}
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem variant="destructive" onClick={() => openDeleteDialogForNote(note)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('common.delete')}
                        </StyledContextMenuItem>
                      </StyledContextMenuContent>
                    </ContextMenu>
                  )}
                </DraggableNoteItem>
              ))}

              {/* Folder tree */}
              {folderTree.folders.map(node => (
                <FolderTreeItem
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  activeNoteId={activeNote?.id}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={toggleFolder}
                  onOpenNote={handleOpenNote}
                  onOpenCreateNoteDialog={openCreateNoteDialog}
                  onOpenRenameFolder={openRenameFolderDialog}
                  onOpenDeleteFolder={openDeleteFolderDialog}
                  onOpenMoveDialog={openMoveDialog}
                  onOpenRenameDialogForNote={openRenameDialogForNote}
                  onOpenDeleteDialogForNote={openDeleteDialogForNote}
                  onDuplicateNote={duplicateNote}
                  onCopyNoteLink={copyNoteLink}
                  onCopyNotePath={copyNotePath}
                  onRevealNote={revealNote}
                />
              ))}
            </>
          ) : (
            <div className="px-3 py-10 text-center text-xs text-muted-foreground">
              {query || selectedTag ? t('notes.vault.noMatches') : t('notes.vault.empty')}
            </div>
          )}
        </div>
        </DndContext>
        <div className="shrink-0 px-3 py-2 text-[11px] text-muted-foreground/80">
          {t('notes.vault.noteCount', { count: notes.length })} · {t('notes.vault.assetCount', { count: allAssets.length })}
        </div>
      </aside>
      <NotesRailSash
        width={railLayout.vault}
        onWidth={(vault) => setRailLayout({ vault })}
        collapsed={railLayout.vaultCollapsed}
        onToggle={() => setRailLayout({ vaultCollapsed: !railLayout.vaultCollapsed })}
        label={t('notes.layout.resizeVault')}
      />

      <main className="notes-content-surface flex-1 min-w-0 flex flex-col">
        <div className="h-[42px] shrink-0 px-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
            {activeNote ? (
              <NotesBreadcrumbs noteId={activeNote.id} title={activeNote.title} onOpenFolder={(folder) => setQuery(folder ?? '')} />
            ) : (
              <div className="truncate text-sm font-medium">{t('notes.header.title')}</div>
            )}
            {activeNote && <div className="min-w-0 truncate text-[11px] text-muted-foreground/60">{activeNoteStats}</div>}
            {activeNote && <button type="button" data-testid="notes-content-authority" aria-haspopup="dialog" onClick={() => setSourceInfoOpen(true)} className="shrink-0 rounded bg-foreground/[0.04] px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.08]" title={t('notes.content.authorityHint')}>
              {contentResolution?.status === 'ok' ? t('notes.content.markdown') : t('notes.content.readOnly')}
            </button>}
          </div>
          {dailyDate && (
            <div className="mr-1 flex items-center gap-1">
              <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDailyShift(-1)} title={t('notes.toolbar.previousDaily')}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">{dailyDate}</span>
              <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDailyShift(1)} title={t('notes.toolbar.nextDaily')}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <NotesAIMenu activeNote={activeNote} onAction={handleAskAgent} />
          <button
            className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center disabled:opacity-40"
            onClick={() => void handleBoundChat()}
            disabled={!activeNote}
            title={t('notes.sideSession.newChat')}
            data-testid="notes-bound-chat"
          >
            <SquarePen className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center disabled:opacity-40" onClick={handleImportAsset} disabled={!activeNote} title={t('notes.toolbar.attachAsset')}>
            <Paperclip className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center disabled:opacity-40" onClick={handleExportPdf} disabled={!activeNote} title={t('notes.toolbar.exportPdf')}>
            <FileDown className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[6px] hover:bg-foreground/[0.06] grid place-items-center" onClick={openRenameDialog} disabled={!activeNote} title={t('notes.toolbar.rename')}>
            <Pencil className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[6px] hover:bg-destructive/10 hover:text-destructive text-muted-foreground grid place-items-center disabled:opacity-40" onClick={() => setDeleteDialogOpen(true)} disabled={!activeNote} title={t('notes.toolbar.delete')}>
            <Trash2 className="h-4 w-4" />
          </button>
          <span className={cn('w-20 text-right text-[11px]', saveError ? 'text-destructive' : 'text-muted-foreground')} title={t('notes.save.autosaveHint')}>
            {saveError ? t('notes.save.failed') : saving ? t('common.saving') : dirty ? t('notes.save.autosaving') : activeNote ? t('notes.save.saved') : ''}
          </span>
        </div>

        {activeNote && saveError && (
          <div role="alert" data-testid="notes-save-recovery" className="mx-3 mb-2 grid min-w-0 gap-2 rounded-md bg-destructive/5 px-3 py-2 text-xs">
            <p className="min-w-0 break-words text-destructive" data-testid="notes-save-recovery-message">{saveError}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={async () => {
              try { await navigator.clipboard.writeText(contentRef.current); toast.success(t('notes.content.draftCopied')) }
              catch { toast.error(t('notes.content.copyFailed')) }
            }}>{t('notes.content.copyDraft')}</Button>
            <Button variant="ghost" size="sm" onClick={() => saveNeedsReload ? setSaveRecoveryOpen(true) : void saveCurrentNote()}>
              {saveNeedsReload ? t('notes.content.reloadSource') : t('notes.content.retrySave')}
            </Button>
            </div>
          </div>
        )}

        <Dialog open={saveRecoveryOpen} onOpenChange={setSaveRecoveryOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('notes.content.reloadTitle')}</DialogTitle><DialogDescription>{t('notes.content.reloadDescription')}</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSaveRecoveryOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => { setSaveRecoveryOpen(false); if (activeNoteIdRef.current) void openNote(activeNoteIdRef.current) }}>{t('notes.content.reloadSource')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={sourceInfoOpen} onOpenChange={setSourceInfoOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{t('notes.content.sourceTitle')}</DialogTitle><DialogDescription>{t('notes.content.sourceDescription')}</DialogDescription></DialogHeader>
            {contentResolution && contentResolution.status !== 'error' ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt>{t('notes.content.sourceState')}</dt><dd>{t(contentResolution.capabilities.write ? 'notes.content.markdown' : 'notes.content.readOnly')}</dd>
              <dt>{t('notes.content.sourceRef')}</dt><dd className="break-all font-mono">{contentResolution.canonicalRef.entityId}</dd>
              <dt>{t('notes.content.sourceStore')}</dt><dd className="break-all font-mono">{contentResolution.origin.sourceStoreId}</dd>
              <dt>{t('notes.content.sourceEpoch')}</dt><dd>{contentResolution.origin.authorityEpoch}</dd>
              <dt>{t('notes.content.sourceDescriptor')}</dt><dd>{contentResolution.descriptorRevision ?? t('notes.content.inferredSource')}</dd>
              <dt>{t('notes.content.sourceRevision')}</dt><dd className="break-all font-mono">{contentResolution.revision}</dd>
              <dt>{t('notes.content.sourceFormat')}</dt><dd>{contentResolution.descriptor?.authority ?? t('notes.content.unknownSource')}</dd>
              {contentResolution.code && <><dt>{t('notes.content.sourceDiagnostic')}</dt><dd>{t(`notes.content.sourceCodes.${contentResolution.code}`)}</dd></>}
            </dl> : <p role="status" className="text-xs">{contentResolution?.status === 'error' ? t(`notes.content.sourceCodes.${contentResolution.code}`) : t('notes.content.sourceChecking')}</p>}
            <p className="text-xs leading-5 text-muted-foreground">{t('notes.content.sourceExample')}</p>
          </DialogContent>
        </Dialog>
        <Dialog open={propertyPreview !== null} onOpenChange={open => { if (!open) setPropertyPreview(null) }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{t('notes.content.propertyPreviewTitle')}</DialogTitle><DialogDescription>{t('notes.content.propertyPreviewDescription')}</DialogDescription></DialogHeader>
            <div className="grid max-h-[50vh] grid-cols-1 gap-3 overflow-auto sm:grid-cols-2">
              <div><p className="mb-2 text-xs text-muted-foreground">{t('notes.content.before')}</p><pre className="whitespace-pre-wrap rounded bg-foreground/5 p-3 text-xs">{propertyPreview?.preview.before}</pre></div>
              <div><p className="mb-2 text-xs text-muted-foreground">{t('notes.content.after')}</p><pre className="whitespace-pre-wrap rounded bg-foreground/5 p-3 text-xs">{propertyPreview?.preview.after}</pre></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setPropertyPreview(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (propertyPreview) void applyPropertyPreview(propertyPreview) }}>{t('notes.content.applyProperties')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {activeNote ? (
          <EntityViewTabs
            value={noteView}
            onChange={setNoteView}
            capabilities={noteViewCapabilities}
            className="min-w-0 flex-wrap"
          />
        ) : null}

        <div className="relative flex-1 min-h-0">
          {!activeNote ? (
            <div className="h-full grid place-items-center">
              {loading ? (
                <div className="text-sm text-muted-foreground">{t('notes.empty.loading')}</div>
              ) : (
                <div className="w-[420px] max-w-[calc(100%-48px)] p-4 text-center" data-notes-empty="">
                  <div className="text-sm font-medium">{t('notes.empty.noNote')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t('notes.empty.noNoteHint')}</div>
                  {/* Flat, wrapping action row: never wider than the empty state. */}
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => handleDaily()}>
                      <CalendarDays className="h-3.5 w-3.5" />
                      {t('notes.toolbar.daily')}
                    </Button>
                    <NotesImportButton workspaceId={activeWorkspaceId || undefined} onImported={() => void refreshNotes()} />
                    <Button variant="outline" size="sm" onClick={() => openCreateNoteDialog()}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                      {t('notes.toolbar.newNote')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : noteView === 'map' ? (
            <div className="flex h-full min-h-0 flex-col">{blockToolbar}<div className="min-h-0 flex-1">
            <MindMapHost
              entity={{ type: 'note', noteId: activeNote.id }}
              graph={noteMindMapGraph}
              error={!visibleBlockTree ? t('notes.blocks.unavailable') : null}
              onNavigate={(source) => { if (source.kind === 'block') openStableBlock(source.id) }}
              mode={noteView}
              workspaceId={activeWorkspaceId || undefined}
              sourceExcerpt={content || undefined}
            />
            </div></div>
          ) : noteView === 'table' || noteView === 'canvas' || noteView === 'graph' || noteView === 'outline' ? (
            <div className="flex h-full min-h-0 flex-col">{noteView === 'outline' ? blockToolbar : null}
            <div className="min-h-0 flex-1">
            <NotesViewHost
              view={noteView}
              blockTree={visibleBlockTree?.listTree}
              onOpenBlock={openStableBlock}
              notes={notes.map((note) => ({
                id: note.id,
                title: note.title,
                markdown: note.id === activeNote.id ? content : '',
                tags: note.tags,
                properties: note.properties,
                tasks: note.id === activeNote.id
                  ? undefined
                  : taskCacheRef.current.get(note.id)?.map((task) => ({ checked: task.checked })),
                links: note.links,
                backlinks: note.id === activeNote.id ? activeNote.backlinks : undefined,
              }))}
              activeNoteId={activeNote.id}
              workspaceId={activeWorkspaceId ?? ''}
              onOpenNote={(noteId) => void handleOpenNote(noteId)}
              onCreateNote={(folder) => openCreateNoteDialog(folder)}
              onEditNote={(noteId, field, value) => void editTableCell(noteId, field, value)}
              onDeleteNote={(noteId) => {
                const note = notes.find((item) => item.id === noteId)
                if (note) void openDeleteDialogForNote(note)
              }}
              onConvert={(noteId, kind) => {
                if (noteId !== activeNote.id) return
                void (async () => {
                  const converted = convertNote(
                    { id: activeNote.id, title: activeNote.title, markdown: content, tags: activeNote.tags },
                    kind,
                  )
                  if (converted.kind === 'task') {
                    try {
                      const current = loadPersonalTaskStore()
                      const next = PersonalTaskStore.fromJson(current.exportJson())
                      const created = next.create({
                        title: converted.title,
                        notes: converted.body,
                        list: 'inbox',
                        links: [{ kind: 'note', id: converted.provenance.noteId }],
                        tags: activeNote.tags ?? [],
                      })
                      persistPersonalTaskStore(next)
                      toast.success(t('notes.views.convertTaskDone'))
                      navigate(routes.view.tasks(created.id))
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    }
                    return
                  }
                  // Real session with provenance.noteId — not toast-only / not summarize-as-proxy.
                  if (!activeWorkspaceId) return
                  try {
                    const session = await onCreateSession(activeWorkspaceId, {
                      name: converted.title,
                    })
                    const prompt = [
                      `provenance.noteId: ${converted.provenance.noteId}`,
                      '',
                      converted.prompt,
                    ].join('\n')
                    onInputChange(session.id, prompt)
                    navigate(routes.view.allSessions(session.id))
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err))
                  }
                })()
              }}
            />
            </div></div>
          ) : (
            <div ref={setDocRowEl} className="flex h-full min-h-0">
            {tocShown ? (
            <NotesToc
              markdown={content}
              width={railLayout.toc}
              foldedIds={new Set(foldedHeadingIds)}
              onToggleFold={(id) => {
                if (!activeNote) return
                const next = foldedHeadingIds.includes(id)
                  ? foldedHeadingIds.filter((item) => item !== id)
                  : [...foldedHeadingIds, id]
                setFoldedHeadingIds(next)
                localStorage.setItem(notesFoldStorageKey(activeNote.id), serializePersistedFolds(next))
                const nextContent = applyPersistentFolds(contentRef.current, next)
                contentRef.current = nextContent
                dirtyRef.current = true
                setContent(nextContent)
                setDirty(true)
              }}
              onJump={(text) => {
                const root = document.querySelector('.notes-editor .ProseMirror')
                if (!root) return
                const heading = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
                  (node) => node.textContent?.trim() === text,
                )
                heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
            ) : null}
            <NotesRailSash
              width={railLayout.toc}
              onWidth={(toc) => setRailLayout({ toc })}
              collapsed={railLayout.tocCollapsed}
              onToggle={() => setRailLayout({ tocCollapsed: !railLayout.tocCollapsed })}
              label={t('notes.layout.resizeToc')}
            />
            <div
              className="notes-editor relative h-full min-w-0 flex-1 overflow-y-auto px-10 pb-16 pt-8"
              onMouseUp={(event) => {
                const quote = window.getSelection()?.toString().trim() ?? ''
                if (!quote) return
                setCommentDraftQuote(quote)
                setCommentTooltip(null)
                const editor = event.currentTarget.getBoundingClientRect()
                const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null
                setCommentComposerTop(selectionComposerOffset(range?.top ?? editor.top + 48, editor.top, editor.height))
              }}
              onDoubleClick={() => {
                const quote = window.getSelection()?.toString().trim() ?? ''
                if (quote) setCommentDraftQuote(quote)
                setRailLayout({ commentsCollapsed: false })
              }}
              onKeyDownCapture={(event) => {
                if (!canEditContent) return
                if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '-') {
                  event.preventDefault()
                  richEditorRef.current?.chain().focus().setHorizontalRule().run()
                  return
                }
                if (noteCommentKeyboardAction(event) === 'open') {
                  event.preventDefault()
                  const quote = window.getSelection()?.toString().trim() ?? ''
                  if (quote) setCommentDraftQuote(quote)
                  setRailLayout({ commentsCollapsed: false })
                  return
                }
                const columnAction = noteColumnKeyboardAction(event)
                if (columnAction === 'insert-2' || columnAction === 'insert-3') {
                  event.preventDefault()
                  insertAtCursor(columnAction === 'insert-2' ? TWO_COLUMN_SNIPPET : THREE_COLUMN_SNIPPET)
                  return
                }
                if (columnAction === 'widen' || columnAction === 'narrow') {
                  event.preventDefault()
                  const editor = richEditorRef.current
                  const from = editor?.state.selection.from ?? 0
                  const textBefore = editor
                    ? editor.state.doc.textBetween(0, from, '\n', '\n')
                    : splitFrontmatter(content).body
                  const next = resizeColumnsAt(splitFrontmatter(content).body, textBefore.length, columnAction === 'widen' ? 3 : 2)
                  applyNoteMarkdown(mergeFrontmatter(richParts.frontmatter, next))
                  return
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void openWikiLinkAtCursor()
                  return
                }
                if (showWikiMenu) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setWikiIndex(index => Math.min(index + 1, Math.max(0, wikiItemCount - 1)))
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setWikiIndex(index => Math.max(index - 1, 0))
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setWikiQuery(null)
                    return
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault()
                    const match = wikiMatches[wikiIndex]
                    if (match) completeWikiLink(match)
                    else if (wikiCreateLabel) void completeWikiCreate(wikiCreateLabel)
                  }
                  return
                }
                if (commandQuery) {
                  const action = notePaletteKeyAction(event, commandIndex, commandMatches.length)
                  if (action?.type === 'move') {
                    event.preventDefault()
                    setCommandIndex(action.index)
                    return
                  }
                  if (action?.type === 'select') {
                    event.preventDefault()
                    const item = commandMatches[commandIndex]
                    if (item) applyCommandItem(item)
                    return
                  }
                  if (action?.type === 'close') {
                    event.preventDefault()
                    setCommandQuery(null)
                  }
                }
              }}
              onKeyUpCapture={() => {
                syncRichWikiQuery()
                setCommandQuery(findRichCommandQuery(richEditorRef.current))
              }}
              onMouseUpCapture={syncRichWikiQuery}
              onPasteCapture={(event) => {
                if (event.clipboardData.files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void importFiles(event.clipboardData.files)
                  return
                }
                const html = event.clipboardData.getData('text/html')
                const text = event.clipboardData.getData('text/plain')
                if (/<script|javascript:/i.test(`${html}\n${text}`)) {
                  event.preventDefault()
                  richEditorRef.current?.chain().focus().insertContent(sanitizePastedMarkdown(text)).run()
                }
              }}
              onDropCapture={(event) => {
                if (event.dataTransfer.files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void importFiles(event.dataTransfer.files)
                }
              }}
            >
              <TiptapMarkdownEditor
                key={activeNote.id}
                editable={canEditContent}
                content={richParts.body}
                onEditorReady={handleRichEditorReady}
                onUpdate={handleRichBodyChange}
                onWikiLinkClick={(target) => {
                  const note = findNoteByTarget(notes, target)
                  if (note) { void handleOpenNote(note.id) }
                  else { setMissingLinkTarget(target) }
                }}
                onTagClick={(tag) => setSelectedTag(selectedTag === tag ? null : tag)}
                placeholder={t('notes.editor.placeholder')}
                markdownEngine="legacy"
                className="notes-editor-prose mx-auto w-full max-w-[70ch] min-h-full"
              />
              <NotesCommentHighlights
                comments={markdownComments}
                hidden={!commentsShown}
                contentKey={content}
                onActivate={(comment, rect) => {
                  const editor = document.querySelector('.notes-editor')?.getBoundingClientRect()
                  setCommentTooltip({
                    quote: comment.quote,
                    body: comment.body,
                    top: rect.bottom - (editor?.top ?? 0) + 6,
                    left: rect.left - (editor?.left ?? 0),
                  })
                }}
              />
              {commentTooltip && !commentsShown ? (
                <NotesCommentTooltip comment={{ id: 'tooltip', quote: commentTooltip.quote, body: commentTooltip.body, createdAt: 0 }} top={commentTooltip.top} left={commentTooltip.left} />
              ) : null}
              {!commentsShown && commentDraftQuote ? (
                <NotesCommentComposer
                  className="absolute right-3 z-20"
                  top={commentComposerTop}
                  quote={commentDraftQuote}
                  body={commentComposerBody}
                  onBodyChange={setCommentComposerBody}
                  onCancel={() => {
                    setCommentDraftQuote('')
                    setCommentComposerBody('')
                  }}
                  onSubmit={() => {
                    const text = commentComposerBody.trim()
                    if (!text || !activeNote) return
                    const nextContent = upsertMarkdownComment(contentRef.current, {
                      id: crypto.randomUUID(),
                      quote: commentDraftQuote.trim(),
                      body: text,
                      createdAt: Date.now(),
                    })
                    contentRef.current = nextContent
                    dirtyRef.current = true
                    setContent(nextContent)
                    setDirty(true)
                    setCommentDraftQuote('')
                    setCommentComposerBody('')
                  }}
                />
              ) : null}
              {richParts.frontmatter && (
                <div className="mx-auto mt-4 max-w-[70ch] rounded-[6px] bg-foreground/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
                  {t('notes.frontmatterPreserved')}
                </div>
              )}
              {wikiMenu}
              {commandQuery ? (
                <NotesCommandPalette
                  query={commandQuery}
                  items={commandCatalog}
                  activeIndex={commandIndex}
                  onClose={() => setCommandQuery(null)}
                  onSelect={applyCommandItem}
                />
              ) : null}
            </div>
            <NotesRailSash
              width={railLayout.comments}
              invert
              onWidth={(comments) => setRailLayout({ comments })}
              collapsed={railLayout.commentsCollapsed}
              onToggle={() => setRailLayout({ commentsCollapsed: !railLayout.commentsCollapsed })}
              label={t('notes.layout.resizeComments')}
            />
            {activeNote && commentsShown ? (
              <NotesComments
                noteId={activeNote.id}
                draftQuote={commentDraftQuote}
                markdownComments={markdownComments}
                width={railLayout.comments}
                composerTop={commentComposerTop}
                onClearDraft={() => setCommentDraftQuote('')}
                onJumpToQuote={(quote) => {
                  const root = document.querySelector('.notes-editor .ProseMirror')
                  if (!root || !quote) return
                  const hit = Array.from(root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')).find(
                    (node) => node.textContent?.includes(quote),
                  )
                  hit?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                onCommit={(comments) => {
                  let next = content
                  for (const comment of comments) next = upsertMarkdownComment(next, comment)
                  contentRef.current = next
                  dirtyRef.current = true
                  setContent(next)
                  setDirty(true)
                }}
              />
            ) : null}
            </div>
          )}
        </div>
      </main>

      {rightSessionContext && (
        <RightSessionShell
          context={rightSessionContext}
          prompt={sideSessionPrompt}
          focusToken={rightSessionFocusToken}
          chips={sideNoteChip ? [{ id: rightSessionContext.entityRefs[0] ?? 'note', title: sideNoteChip.title, detail: sideNoteChip.path }] : undefined}
          onPromptChange={(value) => {
            setSideSessionPrompt(value)
            if (sideSessionId) onInputChange(sideSessionId, value)
          }}
          onSend={sendSideSession}
          onClose={closeSideSession}
        />
      )}

      <NoteInspector
        activeNote={activeNote}
        content={content}
        notes={notes}
        allTasks={allTasks}
        allAssets={allAssets}
        selectedTag={selectedTag}
        tagDraft={tagDraft}
        propertyEntries={propertyEntries}
        propertyProjection={propertyProjection}
        propertiesWritable={canEditContent}
        onUpdateScalarProperty={updateScalarProperty}
        newPropertyKey={newPropertyKey}
        newPropertyValue={newPropertyValue}
        currentNoteAssets={currentNoteAssets}
        uncreatedLinks={uncreatedLinks}
        activeNoteTasks={activeNoteTasks}
        openTasks={openTasks}
        presetTags={presetTagVocabulary}
        onTagDraftChange={setTagDraft}
        onApplyTags={applyTags}
        onTagClick={(tag) => setSelectedTag(selectedTag === tag ? null : tag)}
        onAddTag={(tag) => {
          if (!activeNote) return
          const next = Array.from(new Set([...activeNote.tags, tag]))
          setTagDraft(next.join(', '))
          void updateProperty('tags', next)
        }}
        onUpdateProperty={updateProperty}
        onNewPropertyKeyChange={setNewPropertyKey}
        onNewPropertyValueChange={setNewPropertyValue}
        onAddProperty={addProperty}
        onOpenAssetDialog={() => setAssetDialogOpen(true)}
        onOpenFile={onOpenFile}
        onToggleTask={toggleTask}
        onOpenNote={handleOpenNote}
        onMissingLink={(target) => {
          const note = findNoteByTarget(notes, target)
          if (note) void handleOpenNote(note.id)
          else setMissingLinkTarget(target)
        }}
        insights={noteInsights}
        indexHealth={indexHealth}
        indexRebuilding={indexRebuilding}
        onRebuildIndex={() => { void rebuildIndex() }}
        footnoteDraft={footnoteDraft}
        onFootnoteDraftChange={setFootnoteDraft}
        onApplyLink={(suggestion) => applyNoteMarkdown(applyLinkSuggestion(content, suggestion.mention, suggestion.targetTitle))}
        onApplyMerge={(merge) => applyNoteMarkdown(applyEntityMerge(content, merge.fromName, merge.toName))}
        onUndoMerge={(merge) => applyNoteMarkdown(undoEntityMerge(content, merge.fromName, merge.toName))}
        onCreateFootnote={() => {
          const inserted = insertFootnote(content, footnoteDraft)
          setFootnoteDraft('')
          applyNoteMarkdown(inserted.markdown)
        }}
        onUpdateFootnote={(footnote, body) => applyNoteMarkdown(updateFootnoteDefinition(content, footnote.id, body))}
        onJumpFootnote={(footnote) => {
          const editor = richEditorRef.current
          if (!editor) return
          editor.chain().focus().run()
          const needle = `[^${footnote.id}]`
          const from = content.indexOf(needle)
          if (from >= 0) {
            const bodyOffset = splitFrontmatter(content).frontmatter.length
            const pos = Math.max(1, from - bodyOffset)
            try {
              editor.chain().focus().setTextSelection(pos).run()
            } catch {
              /* selection mapping is best-effort */
            }
          }
        }}
        collapsed={inspectorCollapsed}
        onToggleCollapsed={toggleInspector}
      />
    </div>
    <Dialog open={Boolean(markerPreview)} onOpenChange={(open) => { if (!open && !markerBusy) { setMarkerPreview(null); setMarkerError(null) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes.blocks.previewTitle')}</DialogTitle>
          <DialogDescription>{t('notes.blocks.previewDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-3 overflow-auto" data-testid="notes-marker-preview">
          <section><h3 className="text-sm font-medium">{t('notes.content.before')}</h3>
            <pre tabIndex={0} className="whitespace-pre-wrap text-xs">{markerPreview?.preview.baseContent}</pre></section>
          <section><h3 className="text-sm font-medium">{t('notes.content.after')}</h3>
            <pre tabIndex={0} className="whitespace-pre-wrap text-xs">{markerAfter}</pre></section>
        </div>
        {markerError ? <p role="alert" className="text-sm text-destructive">{markerError}</p> : null}
        <Button disabled={markerBusy || markerAfter === null || !markerPreview || markerPreview.preview.mapping.addedMarkers.length === 0}
          onClick={() => void applyMarkers()}>{t('notes.blocks.apply')}</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(selectedBlock)} onOpenChange={(open) => { if (!open) setSelectedBlockId(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{activeNote?.title}</DialogTitle>
          <DialogDescription>{selectedBlockId && activeNote ? '[[' + activeNote.id + '#^' + selectedBlockId + ']]' : ''}</DialogDescription>
        </DialogHeader>
        <pre tabIndex={0} className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm" data-testid="notes-stable-block-source" data-block-id={selectedBlockId ?? undefined}>
          {selectedBlock ? retainedText(retainBlockSource(content), selectedBlock.range) : ''}
        </pre>
      </DialogContent>
    </Dialog>
    <NotesDialogs
      createDialogOpen={createDialogOpen}
      createTitle={createTitle}
      createInFolder={createInFolder}
      onCreateDialogOpenChange={(open) => { setCreateDialogOpen(open); if (!open) setCreateInFolder(undefined) }}
      onCreateTitleChange={setCreateTitle}
      onCreateNote={handleCreate}
      createFolderDialogOpen={createFolderDialogOpen}
      createFolderName={createFolderName}
      onCreateFolderDialogOpenChange={setCreateFolderDialogOpen}
      onCreateFolderNameChange={setCreateFolderName}
      onCreateFolder={handleCreateFolder}
      moveDialogOpen={moveDialogOpen}
      moveTargetNote={moveTargetNote}
      moveFolderName={moveFolderName}
      onMoveDialogOpenChange={setMoveDialogOpen}
      onMoveFolderNameChange={setMoveFolderName}
      onMoveNote={moveNoteToFolder}
      renameDialogOpen={renameDialogOpen}
      renameTitle={renameTitle}
      renameImpact={renameImpact}
      activeNote={activeNote}
      onRenameDialogOpenChange={setRenameDialogOpen}
      onRenameTitleChange={setRenameTitle}
      onRenameNote={handleRename}
      deleteDialogOpen={deleteDialogOpen}
      onDeleteDialogOpenChange={setDeleteDialogOpen}
      onDeleteNote={handleDelete}
      externalChange={externalChange}
      onDismissExternalChange={() => setExternalChange(null)}
      onReloadNote={() => { const noteId = externalChange?.noteId; setExternalChange(null); if (noteId) void openNote(noteId) }}
      missingLinkTarget={missingLinkTarget}
      onDismissMissingLink={() => setMissingLinkTarget(null)}
      onCreateMissingLink={createMissingLinkNote}
      assetDialogOpen={assetDialogOpen}
      allAssets={allAssets}
      orphanAssets={orphanAssets}
      assetBusy={assetBusy}
      onAssetDialogOpenChange={setAssetDialogOpen}
      onImportAsset={handleImportAsset}
      onCleanUnusedAssets={handleCleanUnusedAssets}
      onOpenFile={onOpenFile}
      onOpenAssetRenameDialog={openAssetRenameDialog}
      onDeleteAsset={handleDeleteAsset}
      assetRenameTarget={assetRenameTarget}
      assetRenameName={assetRenameName}
      onAssetRenameTargetChange={setAssetRenameTarget}
      onAssetRenameNameChange={setAssetRenameName}
      onRenameAsset={handleRenameAsset}
      renameFolderDialogOpen={renameFolderDialogOpen}
      renameFolderTarget={renameFolderTarget}
      renameFolderName={renameFolderName}
      onRenameFolderDialogOpenChange={setRenameFolderDialogOpen}
      onRenameFolderNameChange={setRenameFolderName}
      onRenameFolder={handleRenameFolder}
      deleteFolderDialogOpen={deleteFolderDialogOpen}
      deleteFolderTarget={deleteFolderTarget}
      deleteFolderNoteCount={notes.filter(n => noteFolder(n) === deleteFolderTarget || noteFolder(n).startsWith(deleteFolderTarget + '/')).length}
      onDeleteFolderDialogOpenChange={setDeleteFolderDialogOpen}
      onDeleteFolder={handleDeleteFolder}
    />
    </>
  )
}
