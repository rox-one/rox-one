import * as React from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, FilePlus2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Link2, ListTree, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { activeSessionIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { TiptapMarkdownEditor, type TiptapEditorHandle } from '@craft-agent/ui'
import type { FileAttachment, NoteAsset, NoteChangedPayload, NoteCommentAnchor, NoteCommentThread, NoteDocument, NoteRenameImpact, NoteSummary } from '../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'

import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'
import { NoteInspector } from './notes/NoteInspector'
import type { NoteTask } from './notes/NoteInspector'
import { NotesAIMenu } from './notes/NotesAIMenu'
import type { AIActionMode } from './notes/NotesAIMenu'
import { NotesDialogs } from './notes/NotesDialogs'
import { pathStartsWith } from '@craft-agent/core/utils'
import {
  getNoteRailWidth,
  parseDocumentOutline,
  parseStoredRailCollapsed,
  parseStoredRailWidth,
  type DocumentOutlineItem,
  type NoteRailKind,
} from './notes/document-outline'
import { createNoteCommentAnchor, resolveNoteCommentAnchor, resolveNoteCommentAnchors, type ResolvedNoteCommentAnchor } from './notes/note-comments'

interface NotesPageProps {
  selectedNoteId: string | null
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

function baseNoteTitle(noteId: string): string {
  return noteId.split('/').pop() || noteId
}

function findNoteByTarget(notes: NoteSummary[], target: string): NoteSummary | null {
  const normalized = normalizeNoteTarget(target)
  return notes.find(note =>
    normalizeNoteTarget(note.id) === normalized
    || normalizeNoteTarget(note.title) === normalized
    || normalizeNoteTarget(baseNoteTitle(note.id)) === normalized
  ) ?? null
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

function parsePropertyInput(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function inputToProperty(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.includes(',')) return trimmed.split(',').map(part => part.trim()).filter(Boolean)
  return parsePropertyInput(trimmed)
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
    name: file.name || 'вложение',
    mimeType: file.type || 'application/octet-stream',
    base64: btoa(binary),
    size: file.size,
  }
}

function getEditorPlainText(editor: TiptapEditorHandle): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
}

function readEditorCommentAnchor(editor: TiptapEditorHandle): NoteCommentAnchor | null {
  const selection = editor.state.selection
  if (selection.empty) return null
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  const fullText = getEditorPlainText(editor)
  const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n')
  const before = editor.state.doc.textBetween(0, from, '\n', '\n')
  return createNoteCommentAnchor({
    fullText,
    start: before.length,
    end: before.length + selectedText.length,
    selectedText,
  })
}

/**
 * Converts an offset in the document-wide text representation used by comment
 * anchors back to a ProseMirror selection position. `textBetween` deliberately
 * uses the same block separators as `getEditorPlainText`, so marks and paragraph
 * boundaries do not need bespoke position arithmetic.
 */
export function findDocPositionForPlainTextOffset(editor: TiptapEditorHandle, offset: number): number | null {
  const doc = editor.state.doc
  if (!Number.isFinite(offset) || offset < 0) return null

  const fullText = doc.textBetween(0, doc.content.size, '\n', '\n')
  if (offset > fullText.length) return null

  // Position 0 is outside the first textblock. For a selection beginning at
  // the first character, prefer the first valid text position instead.
  if (offset === 0) {
    return doc.content.size > 0 ? 1 : null
  }

  // `textBetween` gives us the canonical projection shared with the anchor
  // store. Its prefix length is monotonic as a ProseMirror position advances,
  // so a binary search avoids one full projection per character in long notes.
  let lower = 1
  let upper = doc.content.size
  while (lower < upper) {
    const position = Math.floor((lower + upper) / 2)
    const prefixLength = doc.textBetween(0, position, '\n', '\n').length
    if (prefixLength < offset) {
      lower = position + 1
    } else {
      upper = position
    }
  }

  return doc.textBetween(0, lower, '\n', '\n').length >= offset ? lower : null
}

export function findDocRangeForComment(
  editor: TiptapEditorHandle,
  quote: string,
  resolved?: Pick<ResolvedNoteCommentAnchor, 'start' | 'end'>,
): { from: number; to: number } | null {
  const fullText = getEditorPlainText(editor)
  let start: number
  let end: number
  if (
    resolved
    && resolved.start != null
    && resolved.end != null
    && resolved.end > resolved.start
    && fullText.slice(resolved.start, resolved.end) === quote
  ) {
    start = resolved.start
    end = resolved.end
  } else {
    start = fullText.indexOf(quote)
    end = start + quote.length
  }
  if (!quote.trim() || start < 0 || end <= start) return null

  const from = findDocPositionForPlainTextOffset(editor, start)
  const to = findDocPositionForPlainTextOffset(editor, end)
  if (from == null || to == null || to <= from) return null

  return { from, to }
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
                  'mb-0.5 flex h-7 cursor-pointer items-center gap-1 rounded-[5px] pr-2 text-sm font-medium text-muted-foreground hover:bg-foreground/[0.04]',
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
                {t('notes.document.newNoteInFolder')}
              </StyledContextMenuItem>
              <StyledContextMenuItem onClick={() => onOpenRenameFolder(node.fullPath)}>
                <Pencil className="h-3.5 w-3.5" />
                {t('notes.document.renameFolder')}
              </StyledContextMenuItem>
              <StyledContextMenuSeparator />
              <StyledContextMenuItem variant="destructive" onClick={() => onOpenDeleteFolder(node.fullPath)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('notes.dialog.deleteFolder')}
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
                        'mb-0.5 w-full rounded-[6px] pr-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                        activeNoteId === note.id && 'bg-foreground/[0.08]',
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
                            <span key={tag} className="rounded-[4px] bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
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
                      {t('notes.document.newNoteHere')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onDuplicateNote(note)}>
                      <Copy className="h-3.5 w-3.5" />
                      {t('notes.document.duplicate')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenMoveDialog(note)}>
                      <FolderInput className="h-3.5 w-3.5" />
                      {t('notes.dialog.move')}
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem onClick={() => onCopyNoteLink(note)}>
                      <Link2 className="h-3.5 w-3.5" />
                      {t('notes.document.copyWikiLink')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onCopyNotePath(note)}>
                      <FileText className="h-3.5 w-3.5" />
                      {t('notes.document.copyMarkdownPath')}
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onRevealNote(note)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('notes.document.revealFinder')}
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

const NOTES_LAYOUT_PREFERENCE_KEY = 'notesDocumentLayout'

type NotesDocumentLayoutPreference = {
  collapsedFolders?: unknown
  inspectorCollapsed?: unknown
  vaultCollapsed?: unknown
  outlineCollapsed?: unknown
  vaultWidth?: unknown
  outlineWidth?: unknown
}

function parseNotesLayoutPreference(content: string): NotesDocumentLayoutPreference {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const layout = (parsed as Record<string, unknown>)[NOTES_LAYOUT_PREFERENCE_KEY]
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {}
    return layout as NotesDocumentLayoutPreference
  } catch {
    return {}
  }
}

function parseNotesLayoutPreferences(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function readLayoutBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return parseStoredRailCollapsed(value, fallback)
  return fallback
}

function readLayoutWidth(kind: NoteRailKind, value: unknown): number {
  if (typeof value === 'number' || typeof value === 'string') {
    return parseStoredRailWidth(kind, String(value))
  }
  return getNoteRailWidth(kind, false)
}

function readCollapsedFolders(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((folder): folder is string => typeof folder === 'string') : [])
}

async function readNotesLayoutPreference(): Promise<NotesDocumentLayoutPreference> {
  const { content } = await window.electronAPI.readPreferences()
  return parseNotesLayoutPreference(content)
}

async function persistNotesLayoutPreference(patch: NotesDocumentLayoutPreference): Promise<void> {
  const { content } = await window.electronAPI.readPreferences()
  const preferences = parseNotesLayoutPreferences(content)
  const current = preferences[NOTES_LAYOUT_PREFERENCE_KEY]
  const currentLayout = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {}
  const result = await window.electronAPI.writePreferences(
    JSON.stringify({
      ...preferences,
      [NOTES_LAYOUT_PREFERENCE_KEY]: { ...currentLayout, ...patch },
      updatedAt: Date.now(),
    }, null, 2),
  )
  if (!result.success) throw new Error(result.error ?? 'Unable to save notes layout preferences')
}

function noteCrumbs(note: NoteDocument | null, vaultLabel: string): string[] {
  if (!note) return [vaultLabel]
  const folderParts = note.id.split('/').slice(0, -1).filter(Boolean)
  return [vaultLabel, ...folderParts, note.title]
}

function focusEditorHeading(
  editor: TiptapEditorHandle | null,
  item: DocumentOutlineItem,
): void {
  if (!editor) return
  let seen = -1
  let targetPos: number | null = null

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    seen += 1
    if (seen !== item.ordinal) return true
    targetPos = Math.max(1, pos + 1)
    return false
  })

  if (targetPos == null) return

  try {
    editor.chain().focus().setTextSelection(targetPos).run()
    window.requestAnimationFrame(() => {
      const dom = editor.view.domAtPos(targetPos!)
      const sourceNode = dom.node
      const element = sourceNode instanceof Element
        ? sourceNode.closest('h1,h2,h3,h4,h5,h6') ?? sourceNode
        : sourceNode.parentElement?.closest('h1,h2,h3,h4,h5,h6')
      element?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  } catch {
    editor.commands.focus()
  }
}

export default function NotesPage({ selectedNoteId }: NotesPageProps) {
  const { t } = useTranslation()
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
  const [sideSessionId, setSideSessionId] = React.useState<string | null>(null)
  const [sideSessionPrompt, setSideSessionPrompt] = React.useState('')
  const [sideNoteChip, setSideNoteChip] = React.useState<{ title: string; path: string } | null>(null)
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  // Stable insertion order for sidebar — only updated on full refreshes, not optimistic saves
  const [sidebarOrder, setSidebarOrder] = React.useState<string[]>([])
  const [searchResults, setSearchResults] = React.useState<NoteSummary[] | null>(null)
  const [activeNote, setActiveNote] = React.useState<NoteDocument | null>(null)
  const [content, setContent] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(() => new Set())
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
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState<boolean>(true)
  const [vaultCollapsed, setVaultCollapsed] = React.useState<boolean>(false)
  const [outlineCollapsed, setOutlineCollapsed] = React.useState<boolean>(false)
  const [vaultWidth, setVaultWidth] = React.useState<number>(() => getNoteRailWidth('vault', false))
  const [outlineWidth, setOutlineWidth] = React.useState<number>(() => getNoteRailWidth('outline', false))
  const saveTimerRef = React.useRef<number | null>(null)
  const saveQueueRef = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const taskCacheRef = React.useRef<Map<string, NoteTask[]>>(new Map())
  const dirtyRef = React.useRef(dirty)
  const contentRef = React.useRef(content)
  const activeNoteIdRef = React.useRef<string | null>(null)
  const richEditorRef = React.useRef<TiptapEditorHandle | null>(null)
  const commentSelectionCleanupRef = React.useRef<(() => void) | null>(null)
  const commentDraftLockedRef = React.useRef(false)
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [noteComments, setNoteComments] = React.useState<NoteCommentThread[]>([])
  const [commentDraft, setCommentDraft] = React.useState('')
  const [pendingCommentAnchor, setPendingCommentAnchor] = React.useState<NoteCommentAnchor | null>(null)
  const [commentMenuPosition, setCommentMenuPosition] = React.useState<{ x: number; y: number } | null>(null)
  const [activeCommentId, setActiveCommentId] = React.useState<string | null>(null)
  const [commentPanelSignal, setCommentPanelSignal] = React.useState(0)
  const [commentSourceText, setCommentSourceText] = React.useState('')

  React.useEffect(() => { dirtyRef.current = dirty }, [dirty])
  React.useEffect(() => { contentRef.current = content }, [content])
  React.useEffect(() => { activeNoteIdRef.current = activeNote?.id ?? null }, [activeNote?.id])

  React.useEffect(() => {
    let cancelled = false
    void readNotesLayoutPreference()
      .then((layout) => {
        if (cancelled) return
        setCollapsedFolders(readCollapsedFolders(layout.collapsedFolders))
        setInspectorCollapsed(readLayoutBoolean(layout.inspectorCollapsed, true))
        setVaultCollapsed(readLayoutBoolean(layout.vaultCollapsed, false))
        setOutlineCollapsed(readLayoutBoolean(layout.outlineCollapsed, false))
        setVaultWidth(readLayoutWidth('vault', layout.vaultWidth))
        setOutlineWidth(readLayoutWidth('outline', layout.outlineWidth))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const toggleFolder = React.useCallback((folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      void persistNotesLayoutPreference({ collapsedFolders: [...next] }).catch(() => undefined)
      return next
    })
  }, [])

  const refreshNotes = React.useCallback(async () => {    if (!activeWorkspaceId) return
    const next = await window.electronAPI.listNotes(activeWorkspaceId)
    setNotes(next)
    setSidebarOrder(next.map(n => n.id))
  }, [activeWorkspaceId])

  const refreshAssets = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      setAllAssets([])
      return
    }
    const next = await window.electronAPI.listNoteAssets(activeWorkspaceId)
    setAllAssets(next)
  }, [activeWorkspaceId])

  const refreshNoteComments = React.useCallback(async (noteId: string) => {
    if (!activeWorkspaceId) {
      setNoteComments([])
      return []
    }
    const next = await window.electronAPI.listNoteComments(activeWorkspaceId, noteId)
    setNoteComments(next)
    return next
  }, [activeWorkspaceId])

  const refreshTasks = React.useCallback(async (sourceNotes?: NoteSummary[]) => {
    if (!activeWorkspaceId) {
      setAllTasks([])
      taskCacheRef.current.clear()
      return
    }
    const baseNotes = sourceNotes ?? notes
    const currentIds = new Set(baseNotes.map(n => n.id))
    for (const id of taskCacheRef.current.keys()) {
      if (!currentIds.has(id)) taskCacheRef.current.delete(id)
    }
    const toFetch = baseNotes.filter(n => !taskCacheRef.current.has(n.id))
    const results = await Promise.allSettled(
      toFetch.map(note => window.electronAPI.readNote(activeWorkspaceId, note.id))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        taskCacheRef.current.set(result.value.id, extractTasks(result.value, result.value.content))
      }
    }
    setAllTasks([...taskCacheRef.current.values()].flat())
  }, [activeWorkspaceId, notes])

  const openNote = React.useCallback(async (noteId: string) => {
    if (!activeWorkspaceId) return
    setLoading(true)
    try {
      const [note, comments] = await Promise.all([
        window.electronAPI.readNote(activeWorkspaceId, noteId),
        window.electronAPI.listNoteComments(activeWorkspaceId, noteId).catch(() => [] as NoteCommentThread[]),
      ])
      setActiveNote(note)
      setNoteComments(comments)
      setActiveCommentId(null)
      commentDraftLockedRef.current = false
      setPendingCommentAnchor(null)
      setCommentDraft('')
      setCommentMenuPosition(null)
      setContent(note.content)
      setCommentSourceText(note.content)
      setDirty(false)
      setSaveError(null)
      setExternalChange(null)
      setTagDraft(note.tags.join(', '))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось открыть заметку')
      setActiveNote(null)
      setNoteComments([])
      setContent('')
      setCommentSourceText('')
      commentDraftLockedRef.current = false
      setPendingCommentAnchor(null)
      setCommentDraft('')
      setCommentMenuPosition(null)
      setDirty(false)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  React.useEffect(() => {
    if (!externalChange) return
    const noteId = externalChange.noteId
    externalChangeToastIdRef.current = toast('Заметка изменилась на диске', {
      description: dirtyRef.current ? 'Другой процесс обновил эту заметку. Перезагрузить её?' : undefined,
      duration: 8000,
      action: {
        label: 'Перезагрузить',
        onClick: () => { setExternalChange(null); if (noteId) void openNote(noteId) },
      },
      onDismiss: () => { setExternalChange(null) },
      onAutoClose: () => { setExternalChange(null) },
    })
    return () => {
      if (externalChangeToastIdRef.current != null) {
        toast.dismiss(externalChangeToastIdRef.current)
      }
    }
  }, [externalChange, openNote])

  React.useEffect(() => {
    refreshNotes()
    refreshAssets()
    if (!activeWorkspaceId) return
    window.electronAPI.watchNotes(activeWorkspaceId).catch(error => {
        toast.error(error instanceof Error ? error.message : 'Не удалось следить за заметками')
    })
    const unsubscribe = window.electronAPI.onNotesChanged((rawPayload) => {
      const payload = normalizeChangedPayload(rawPayload)
      if (payload.workspaceId !== activeWorkspaceId) return

      if (payload.reason === 'create') {
        void refreshNotes()
        return
      }

      if (payload.reason === 'comments') {
        if (payload.noteId && payload.noteId === activeNoteIdRef.current) {
          void refreshNoteComments(payload.noteId).catch(() => undefined)
        }
        return
      }

      // Internal saves are handled optimistically — only react to external changes
      // (e.g. another process edited the file, or the user ran a script)
      if (payload.reason !== 'external') return

      refreshNotes()
      refreshAssets()

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
      window.electronAPI.unwatchNotes(activeWorkspaceId).catch(() => {})
    }
  }, [activeWorkspaceId, openNote, refreshAssets, refreshNoteComments, refreshNotes])

  React.useEffect(() => {
    if (selectedNoteId) {
      openNote(selectedNoteId)
      return
    }
    setActiveNote(null)
    setNoteComments([])
    setContent('')
    setCommentSourceText('')
    commentDraftLockedRef.current = false
    setPendingCommentAnchor(null)
    setCommentDraft('')
    setCommentMenuPosition(null)
    setActiveCommentId(null)
    setDirty(false)
    setSaveError(null)
  }, [selectedNoteId, openNote])

  const noteIds = React.useMemo(() => notes.map(n => n.id).join(','), [notes])
  React.useEffect(() => {
    void refreshTasks(notes)
    // Only re-run when the set of note IDs changes, not on every content/metadata update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIds])

  const saveCurrentNote = React.useCallback(async (): Promise<boolean> => {
    if (!activeWorkspaceId || !activeNote) return true
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const noteId = activeNote.id
    const currentContent = contentRef.current
    const queued = saveQueueRef.current.then(async () => {
      setSaving(true)
      setSaveError(null)
      try {
        const saved = await window.electronAPI.saveNote(activeWorkspaceId, noteId, currentContent)
        if (activeNoteIdRef.current === noteId) {
          setActiveNote(saved)
          setDirty(false)
          setTagDraft(saved.tags.join(', '))
        }
        if ((saved.autoCreatedNoteIds?.length ?? 0) > 0) {
          await refreshNotes()
        } else {
          // Optimistically update sidebar when no wikilink targets were auto-created.
          setNotes(prev => prev.map(n => n.id === saved.id ? saved : n))
        }
        taskCacheRef.current.set(saved.id, extractTasks(saved, saved.content))
        setAllTasks([...taskCacheRef.current.values()].flat())
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось сохранить заметку'
        setSaveError(message)
        toast.error(message)
        return false
      } finally {
        setSaving(false)
      }
    }).catch((): boolean => false)
    saveQueueRef.current = queued
    return queued
  // contentRef is a ref — intentionally excluded; activeNote.id and activeWorkspaceId are the real deps
  }, [activeWorkspaceId, activeNote, refreshNotes])

  const flushBeforeAction = React.useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    return saveCurrentNote()
  }, [saveCurrentNote])

  React.useEffect(() => {
    if (!dirty || !activeWorkspaceId || !activeNote) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      await saveCurrentNote()
    }, 900)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [activeWorkspaceId, activeNote, dirty, saveCurrentNote])

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchNotes(activeWorkspaceId, q)
        setSearchResults(results)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось найти заметки')
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, query])

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
  const richParts = React.useMemo(() => splitFrontmatter(content), [content])
  const documentOutline = React.useMemo(
    () => parseDocumentOutline(richParts.body, activeNote?.title ?? t('notes.document.untitled')),
    [richParts.body, activeNote?.title, t],
  )
  const foldingLabels = React.useMemo(() => ({
    collapseSection: t('notes.folding.collapseSection'),
    collapseTaskList: t('notes.folding.collapseTaskList'),
    expandSection: t('notes.folding.expandSection'),
    expandTaskList: t('notes.folding.expandTaskList'),
  }), [t])
  const roxBlockLabels = React.useMemo(() => ({
    collapse: t('notes.blocks.collapse'),
    expand: t('notes.blocks.expand'),
  }), [t])
  const slashCommandLabels = React.useMemo(() => ({
    empty: t('notes.slash.empty'),
    groupFormat: t('notes.slash.groupFormat'),
    groupLists: t('notes.slash.groupLists'),
    groupBlocks: t('notes.slash.groupBlocks'),
    paragraphTitle: t('notes.slash.paragraphTitle'),
    paragraphDescription: t('notes.slash.paragraphDescription'),
    heading1Title: t('notes.slash.heading1Title'),
    heading1Description: t('notes.slash.heading1Description'),
    heading2Title: t('notes.slash.heading2Title'),
    heading2Description: t('notes.slash.heading2Description'),
    heading3Title: t('notes.slash.heading3Title'),
    heading3Description: t('notes.slash.heading3Description'),
    bulletListTitle: t('notes.slash.bulletListTitle'),
    bulletListDescription: t('notes.slash.bulletListDescription'),
    orderedListTitle: t('notes.slash.orderedListTitle'),
    orderedListDescription: t('notes.slash.orderedListDescription'),
    taskListTitle: t('notes.slash.taskListTitle'),
    taskListDescription: t('notes.slash.taskListDescription'),
    quoteTitle: t('notes.slash.quoteTitle'),
    quoteDescription: t('notes.slash.quoteDescription'),
    dividerTitle: t('notes.slash.dividerTitle'),
    dividerDescription: t('notes.slash.dividerDescription'),
    spoilerTitle: t('notes.slash.spoilerTitle'),
    spoilerDescription: t('notes.slash.spoilerDescription'),
    columns2Title: t('notes.slash.columns2Title'),
    columns2Description: t('notes.slash.columns2Description'),
    columns3Title: t('notes.slash.columns3Title'),
    columns3Description: t('notes.slash.columns3Description'),
    codeTitle: t('notes.slash.codeTitle'),
    codeDescription: t('notes.slash.codeDescription'),
    mermaidTitle: t('notes.slash.mermaidTitle'),
    mermaidDescription: t('notes.slash.mermaidDescription'),
    latexTitle: t('notes.slash.latexTitle'),
    latexDescription: t('notes.slash.latexDescription'),
    spoilerInsertTitle: t('notes.slash.spoilerInsertTitle'),
    detailsInsertTitle: t('notes.slash.detailsInsertTitle'),
  }), [t])
  const crumbs = React.useMemo(() => noteCrumbs(activeNote, t('notes.document.vault')), [activeNote, t])
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
  const orphanAssets = React.useMemo(
    () => allAssets.filter(asset => (asset.referencedBy?.length ?? 0) === 0),
    [allAssets]
  )
  const activeNoteStats = activeNote
    ? `${activeNote.links.length}↗ · ${activeNote.backlinks.length}↙ · ${content.length} зн.`
    : ''
  const activeNoteTasks = React.useMemo(
    () => activeNote ? extractTasks(activeNote, content) : [],
    [activeNote, content]
  )
  const openTasks = React.useMemo(() => allTasks.filter(task => !task.checked), [allTasks])
  const commentAnchorStates = React.useMemo(
    () => resolveNoteCommentAnchors(commentSourceText, noteComments),
    [commentSourceText, noteComments],
  )

  const wikiMatches = React.useMemo(() => {
    if (wikiQuery == null) return []
    const q = wikiQuery.toLowerCase()
    return notes
      .filter(note => note.id !== activeNote?.id)
      .filter(note => !q || note.title.toLowerCase().includes(q) || noteRelativeLabel(note).toLowerCase().includes(q))
      .slice(0, 8)
  }, [notes, activeNote?.id, wikiQuery])

  const wikiCreateLabel = wikiQuery?.trim()
  const showWikiMenu = wikiQuery != null && (wikiMatches.length > 0 || !!wikiCreateLabel)

  const handleCreate = async () => {
    if (!activeWorkspaceId || !createTitle.trim()) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.createNote(activeWorkspaceId, createTitle.trim(), createInFolder)
    setCreateDialogOpen(false)
    setCreateTitle('')
    setCreateInFolder(undefined)
    await refreshNotes()
    navigate(routes.view.notesLegacy(note.id))
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
    const note = await window.electronAPI.createNote(activeWorkspaceId, 'Untitled', folder)
    setCreateFolderDialogOpen(false)
    setCreateFolderName('')
    await refreshNotes()
    navigate(routes.view.notesLegacy(note.id))
  }

  const handleDaily = async (date?: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.getDailyNote(activeWorkspaceId, date)
    await refreshNotes()
    navigate(routes.view.notesLegacy(note.id))
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
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setRenameTitle(document.title)
    setRenameImpact(null)
    setRenameDialogOpen(true)
    navigate(routes.view.notesLegacy(document.id))
  }

  const openDeleteDialogForNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    setActiveNote(document)
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setDeleteDialogOpen(true)
    navigate(routes.view.notesLegacy(document.id))
  }

  const duplicateNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    const title = `${document.title} копия`
    const created = await window.electronAPI.createNote(activeWorkspaceId, title, noteFolder(note) || undefined)
    const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, updateMarkdownTitle(document.content, title))
    await refreshNotes()
    navigate(routes.view.notesLegacy(saved.id))
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
    const document = await window.electronAPI.readNote(activeWorkspaceId, moveTargetNote.id)
    let created: Awaited<ReturnType<typeof window.electronAPI.createNote>> | null = null
    try {
      created = await window.electronAPI.createNote(activeWorkspaceId, document.title, folder || undefined)
      const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, document.content)
      await window.electronAPI.deleteNote(activeWorkspaceId, moveTargetNote.id)
      setMoveDialogOpen(false)
      setMoveTargetNote(null)
      setMoveFolderName('')
      await refreshNotes()
      navigate(routes.view.notesLegacy(saved.id))
      toast.success(t('notes.toast.moved'))
    } catch (error) {
      if (created) {
        await window.electronAPI.deleteNote(activeWorkspaceId, created.id).catch(() => {})
      }
      toast.error(error instanceof Error ? error.message : 'Не удалось переместить заметку')
    }
  }

  const moveSilently = async (note: NoteSummary, targetFolder: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    let created: Awaited<ReturnType<typeof window.electronAPI.createNote>> | null = null
    try {
      created = await window.electronAPI.createNote(activeWorkspaceId, document.title, targetFolder || undefined)
      const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, document.content)
      await window.electronAPI.deleteNote(activeWorkspaceId, note.id)
      await refreshNotes()
      navigate(routes.view.notesLegacy(saved.id))
      toast.success(t('notes.toast.moved'))
    } catch (error) {
      if (created) await window.electronAPI.deleteNote(activeWorkspaceId, created.id).catch(() => {})
      toast.error(error instanceof Error ? error.message : 'Не удалось переместить заметку')
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
      toast.error(error instanceof Error ? error.message : 'Не удалось переименовать папку')
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
        setContent('')
        setDirty(false)
        navigate(routes.view.notesLegacy())
      }
      await refreshNotes()
      toast.success(t('notes.toast.deletedFolder', { count: result.deletedNotes.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить папку')
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
    if (!activeWorkspaceId || !activeNote || !title.trim() || title.trim() === activeNote.title) {
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
    const result = await window.electronAPI.renameNote(activeWorkspaceId, activeNote.id, renameTitle.trim())
    setRenameDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notesLegacy(result.note.id))
    toast.success(t('notes.toast.updatedLinkedNotes', { count: result.updatedNotes.length }))
  }

  const handleDelete = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    await window.electronAPI.deleteNote(activeWorkspaceId, activeNote.id)
    setDeleteDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notesLegacy())
  }

  const updateProperty = React.useCallback(async (key: string, value: unknown | undefined) => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const properties = { ...activeNote.properties }
    if (value === undefined) {
      delete properties[key]
    } else {
      properties[key] = value
    }
    try {
      const updated = await window.electronAPI.updateNoteProperties(activeWorkspaceId, activeNote.id, properties)
      setActiveNote(updated)
      setContent(updated.content)
      setDirty(false)
      setSaveError(null)
      setTagDraft(updated.tags.join(', '))
      await refreshNotes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить свойства заметки')
    }
  }, [activeWorkspaceId, activeNote, flushBeforeAction, refreshNotes])

  const applyTags = React.useCallback(() => {
    const tags = tagDraft.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
    void updateProperty('tags', tags)
  }, [tagDraft, updateProperty])

  const addProperty = React.useCallback(() => {
    const key = newPropertyKey.trim()
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      toast.error('Ключ свойства может содержать буквы, цифры, подчёркивание и дефис')
      return
    }
    void updateProperty(key, inputToProperty(newPropertyValue))
    setNewPropertyKey('')
    setNewPropertyValue('')
  }, [newPropertyKey, newPropertyValue, updateProperty])

  const insertAtCursor = (text: string) => {
    const editor = richEditorRef.current
    if (editor) {
      editor.chain().focus().insertContent(text).run()
      return
    }
    setContent(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${text}`)
    setDirty(true)
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
      toast.success(`Импортировано вложений: ${list.length}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось импортировать вложение')
    }
  }, [activeWorkspaceId, activeNote, refreshAssets])

  const handleImportAsset = async () => {
    if (!activeWorkspaceId || !activeNote) return
    const paths = await window.electronAPI.openFileDialog()
    const path = paths[0]
    if (!path) return
    const attachment = await window.electronAPI.readUserAttachment(path)
    if (!attachment) {
      toast.error('Не удалось прочитать выбранный файл')
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
    if (!result.canceled) toast.success('PDF экспортирован')
  }

  const handleRichBodyChange = (nextBody: string) => {
    setContent(mergeFrontmatter(richParts.frontmatter, nextBody))
    const editor = richEditorRef.current
    setCommentSourceText(editor ? getEditorPlainText(editor) : nextBody)
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
    navigate(routes.view.notesLegacy(noteId))
  }

  const openWikiLinkAtCursor = async () => {
    const target = findRichWikiLinkAtCursor(richEditorRef.current)
    if (!target) return
    const note = findNoteByTarget(notes, target)
    if (note) {
      await handleOpenNote(note.id)
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

  const createMissingLinkNote = React.useCallback(async () => {
    if (!activeWorkspaceId || !missingLinkTarget) return
    const cleanTarget = stripMdExtension(missingLinkTarget)
    const parts = cleanTarget.split('/').filter(Boolean)
    const title = parts.pop() || cleanTarget
    const created = await window.electronAPI.createNote(activeWorkspaceId, title, parts.length > 0 ? parts.join('/') : undefined)
    setMissingLinkTarget(null)
    await refreshNotes()
    navigate(routes.view.notesLegacy(created.id))
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

  const handleAskAgent = async (mode: AIActionMode = 'extract-tasks') => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const { sessionNameKey, instructionKey } = AI_PROMPTS[mode]
    const sessionName = `${t(sessionNameKey)}: ${activeNote.title}`
    const instruction = t(instructionKey)
    const session = await onCreateSession(activeWorkspaceId, { name: sessionName })

    const legacyPath = `notes/${activeNote.relativePath}`
    const attachPath = legacyPath
    const attachTitle = activeNote.title
    const pathLine = t('notes.ai.contextPath', { path: attachPath })

    const prompt = [
      t('notes.ai.contextHeader', { title: attachTitle }),
      pathLine,
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
    // Prefill only — do NOT auto-send. Keep note open; open side session panel.
    onInputChange(session.id, prompt)
    setSideSessionId(session.id)
    setSideSessionPrompt(prompt)
    setSideNoteChip({ title: attachTitle, path: attachPath })
  }

  const closeSideSession = React.useCallback(() => {
    setSideSessionId(null)
    setSideSessionPrompt('')
    setSideNoteChip(null)
  }, [])

  const sendSideSession = React.useCallback(() => {
    if (!sideSessionId) return
    const draft = (getDraft(sideSessionId) || sideSessionPrompt).trim()
    if (!draft) return
    const sessionId = sideSessionId
    onSendMessage(sessionId, draft)
    onInputChange(sessionId, '')
    setSideSessionPrompt('')
    closeSideSession()
    navigate(routes.view.allSessions(sessionId))
  }, [sideSessionId, sideSessionPrompt, getDraft, onSendMessage, onInputChange, closeSideSession])

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
      toast.success(`Updated ${result.updatedNotes.length} note${result.updatedNotes.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось переименовать вложение')
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
      toast.success('Вложение удалено')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить вложение')
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
      toast.success(`Удалено неиспользуемых вложений: ${orphanAssets.length}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось очистить вложения')
    } finally {
      setAssetBusy(false)
    }
  }

  const toggleTask = async (task: NoteTask) => {
    if (!activeWorkspaceId) return
    if (activeNote?.id === task.noteId) {
      const flushed = await flushBeforeAction()
      if (!flushed) return
    }
    const document = await window.electronAPI.readNote(activeWorkspaceId, task.noteId)
    const lines = document.content.split(/\r?\n/)
    const index = task.line - 1
    if (!lines[index]) return
    lines[index] = lines[index].replace(/\[([ xX])\]/, task.checked ? '[ ]' : '[x]')
    const saved = await window.electronAPI.saveNote(activeWorkspaceId, task.noteId, lines.join('\n'))
    if (activeNote?.id === task.noteId) {
      setActiveNote(saved)
      setContent(saved.content)
      setDirty(false)
      setTagDraft(saved.tags.join(', '))
    }
    taskCacheRef.current.delete(task.noteId)
    await refreshNotes()
    await refreshTasks()
  }

  const toggleInspector = React.useCallback(() => {
    setInspectorCollapsed(prev => {
      const next = !prev
      void persistNotesLayoutPreference({ inspectorCollapsed: next }).catch(() => undefined)
      return next
    })
  }, [])

  const toggleVaultRail = React.useCallback(() => {
    setVaultCollapsed(prev => {
      const next = !prev
      void persistNotesLayoutPreference({ vaultCollapsed: next }).catch(() => undefined)
      return next
    })
  }, [])

  const toggleOutlineRail = React.useCallback(() => {
    setOutlineCollapsed(prev => {
      const next = !prev
      void persistNotesLayoutPreference({ outlineCollapsed: next }).catch(() => undefined)
      return next
    })
  }, [])

  const startRailResize = React.useCallback((rail: 'vault' | 'outline', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rail === 'vault' ? vaultWidth : outlineWidth
    let latestWidth = startWidth
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = getNoteRailWidth(rail, false, startWidth + moveEvent.clientX - startX)
      latestWidth = nextWidth
      if (rail === 'vault') {
        setVaultWidth(nextWidth)
      } else {
        setOutlineWidth(nextWidth)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void persistNotesLayoutPreference(
        rail === 'vault' ? { vaultWidth: latestWidth } : { outlineWidth: latestWidth },
      ).catch(() => undefined)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [outlineWidth, vaultWidth])

  const handleOutlineSelect = React.useCallback((item: DocumentOutlineItem) => {
    window.requestAnimationFrame(() => focusEditorHeading(richEditorRef.current, item))
  }, [])

  const syncCommentSelection = React.useCallback((editor = richEditorRef.current) => {
    if (!editor) return
    setCommentSourceText(getEditorPlainText(editor))
    const anchor = readEditorCommentAnchor(editor)
    if (!anchor) {
      setCommentMenuPosition(null)
      if (!commentDraftLockedRef.current) setPendingCommentAnchor(null)
      return
    }

    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.to)
      setPendingCommentAnchor(anchor)
      setCommentMenuPosition({
        x: Math.min(window.innerWidth - 220, Math.max(16, coords.left)),
        y: Math.max(72, coords.top - 44),
      })
    } catch {
      setPendingCommentAnchor(anchor)
      setCommentMenuPosition({ x: 24, y: 96 })
    }
  }, [])

  const handleRichEditorReady = React.useCallback((editor: TiptapEditorHandle | null) => {
    commentSelectionCleanupRef.current?.()
    commentSelectionCleanupRef.current = null
    richEditorRef.current = editor
    if (!editor) return

    const sync = () => syncCommentSelection(editor)
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    setCommentSourceText(getEditorPlainText(editor))
    commentSelectionCleanupRef.current = () => {
      editor.off('selectionUpdate', sync)
      editor.off('transaction', sync)
    }
  }, [syncCommentSelection])

  React.useEffect(() => () => {
    commentSelectionCleanupRef.current?.()
    commentSelectionCleanupRef.current = null
  }, [])

  const openCommentDraft = React.useCallback(() => {
    const editor = richEditorRef.current
    const anchor = editor ? readEditorCommentAnchor(editor) ?? pendingCommentAnchor : pendingCommentAnchor
    if (!anchor) return
    commentDraftLockedRef.current = true
    setPendingCommentAnchor(anchor)
    setInspectorCollapsed(false)
    setCommentPanelSignal(signal => signal + 1)
    setCommentMenuPosition(null)
  }, [pendingCommentAnchor])

  const createComment = React.useCallback(async () => {
    if (!activeWorkspaceId || !activeNote || !pendingCommentAnchor || !commentDraft.trim()) return
    const currentText = richEditorRef.current ? getEditorPlainText(richEditorRef.current) : commentSourceText
    const resolvedAnchor = resolveNoteCommentAnchor(currentText, pendingCommentAnchor)
    const resolvedStart = resolvedAnchor.start
    const resolvedEnd = resolvedAnchor.end
    const resolvedText = resolvedStart == null || resolvedEnd == null
      ? ''
      : currentText.slice(resolvedStart, resolvedEnd)
    if (resolvedAnchor.stale || resolvedStart == null || resolvedEnd == null || !resolvedText || resolvedText !== pendingCommentAnchor.selectedText) {
      commentDraftLockedRef.current = false
      setPendingCommentAnchor(null)
      setCommentMenuPosition(null)
      toast.error(t('notes.comments.errorChangedSelection'))
      return
    }
    const refreshedAnchor = createNoteCommentAnchor({
      fullText: currentText,
      start: resolvedStart,
      end: resolvedEnd,
      selectedText: resolvedText,
    })
    if (!refreshedAnchor) {
      commentDraftLockedRef.current = false
      setPendingCommentAnchor(null)
      setCommentMenuPosition(null)
      toast.error(t('notes.comments.errorAttachSelection'))
      return
    }
    const saved = await flushBeforeAction()
    if (!saved) return

    try {
      const comment = await window.electronAPI.createNoteComment(activeWorkspaceId, {
        noteId: activeNote.id,
        body: commentDraft,
        anchor: refreshedAnchor,
      })
      setNoteComments(prev => [...prev.filter(item => item.id !== comment.id), comment])
      setActiveCommentId(comment.id)
      setCommentDraft('')
      commentDraftLockedRef.current = false
      setPendingCommentAnchor(null)
      setCommentPanelSignal(signal => signal + 1)
      toast.success(t('notes.comments.created'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.comments.errorCreate'))
    }
  }, [activeNote, activeWorkspaceId, commentDraft, commentSourceText, flushBeforeAction, pendingCommentAnchor])

  const updateCommentBody = React.useCallback(async (commentId: string, body: string) => {
    if (!activeWorkspaceId || !activeNote || !body.trim()) return
    try {
      const updated = await window.electronAPI.updateNoteComment(activeWorkspaceId, {
        noteId: activeNote.id,
        commentId,
        body,
      })
      setNoteComments(prev => prev.map(comment => comment.id === updated.id ? updated : comment))
      setActiveCommentId(updated.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.comments.errorUpdate'))
    }
  }, [activeNote, activeWorkspaceId])

  const setCommentResolved = React.useCallback(async (commentId: string, resolved: boolean) => {
    if (!activeWorkspaceId || !activeNote) return
    try {
      const updated = await window.electronAPI.updateNoteComment(activeWorkspaceId, {
        noteId: activeNote.id,
        commentId,
        resolved,
      })
      setNoteComments(prev => prev.map(comment => comment.id === updated.id ? updated : comment))
      setActiveCommentId(updated.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.comments.errorStatus'))
    }
  }, [activeNote, activeWorkspaceId])

  const deleteComment = React.useCallback(async (commentId: string) => {
    if (!activeWorkspaceId || !activeNote) return
    try {
      await window.electronAPI.deleteNoteComment(activeWorkspaceId, activeNote.id, commentId)
      setNoteComments(prev => prev.filter(comment => comment.id !== commentId))
      if (activeCommentId === commentId) setActiveCommentId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.comments.errorDelete'))
    }
  }, [activeCommentId, activeNote, activeWorkspaceId])

  const jumpToComment = React.useCallback((comment: NoteCommentThread, resolved?: ResolvedNoteCommentAnchor) => {
    const editor = richEditorRef.current
    if (!editor) return
    const exact = comment.anchor.selectedText
      || comment.anchor.selectors.find(selector => selector.type === 'text-quote')?.exact
      || ''
    const range = findDocRangeForComment(editor, exact, resolved)
    if (range) {
      try {
        editor.chain().focus().setTextSelection(range).run()
      } catch {
        editor.commands.focus()
      }
    } else {
      editor.commands.focus()
    }
    setActiveCommentId(comment.id)
    setInspectorCollapsed(false)
    setCommentPanelSignal(signal => signal + 1)
    if (resolved?.stale) toast.message(t('notes.comments.staleToast'))
  }, [])

  const wikiMenu = showWikiMenu ? (
    <div
      className="absolute z-20 w-80 rounded-[8px] border border-border/70 bg-popover p-1 shadow-strong"
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
            'w-full rounded-[5px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]',
            wikiMatches[wikiIndex]?.id === note.id && 'bg-foreground/[0.08]'
          )}
        >
          <div className="truncate text-xs font-medium">{note.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{noteRelativeLabel(note)}</div>
        </button>
      ))}
      {wikiCreateLabel && !findNoteByTarget(notes, wikiCreateLabel) && (
        <button
          onClick={() => completeWikiText(wikiCreateLabel)}
          className="mt-1 flex w-full items-center gap-2 rounded-[5px] border-t border-border/60 px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          Ссылка на новую заметку «{wikiCreateLabel}»
        </button>
      )}
      <div className="border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        ↑/↓ выбрать · Enter вставить · Esc закрыть
      </div>
    </div>
  ) : null

  const shellFontStyle: React.CSSProperties = {
    fontFamily: 'var(--font-default)',
  }

  if (!activeWorkspaceId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Выберите рабочее пространство, чтобы открыть заметки.</div>
  }

  return (
    <>
    <div className="flex h-full min-w-0 overflow-hidden bg-background text-foreground" style={shellFontStyle}>
      <aside
        style={{ width: getNoteRailWidth('vault', vaultCollapsed, vaultWidth) }}
        className={cn(
          'relative shrink-0 border-r border-border/70 bg-muted/[0.18] shadow-minimal transition-[width] duration-200 ease-out motion-reduce:transition-none',
          vaultCollapsed ? 'flex flex-col items-center py-2' : 'flex min-h-0 flex-col',
        )}
      >
        {vaultCollapsed ? (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={toggleVaultRail}
              aria-label={t('notes.document.expandVault')}
              title={t('notes.document.expandVault')}
            >
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openCreateNoteDialog()}
              aria-label={t('notes.dialog.newNote')}
              title={t('notes.dialog.newNote')}
            >
              <FilePlus2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleDaily()}
              aria-label={t('notes.document.dailyNote')}
              title={t('notes.document.dailyNote')}
            >
              <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <>
        <div className="shrink-0 px-3 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={toggleVaultRail}
              aria-label={t('notes.document.collapseVault')}
              title={t('notes.document.collapseVault')}
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('common.search')}
                className="h-7 w-full rounded-[6px] border border-border/60 bg-background pl-7 pr-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDaily()} title={t('notes.document.dailyNote')}>
              <CalendarDays className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => setCreateFolderDialogOpen(true)} title={t('notes.dialog.newFolder')}>
              <FolderPlus className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => openCreateNoteDialog()} title={t('notes.dialog.newNote')}>
              <FilePlus2 className="h-4 w-4" />
            </button>
          </div>
          {allTags.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
              <button
                className={cn(
                  'shrink-0 rounded-[5px] px-2 py-1 text-[11px] hover:bg-foreground/[0.06]',
                  !selectedTag && 'bg-foreground/[0.08]'
                )}
                onClick={() => setSelectedTag(null)}
              >
                Все
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={cn(
                    'shrink-0 rounded-[5px] px-2 py-1 text-[11px] hover:bg-foreground/[0.06]',
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
                            'mb-0.5 w-full rounded-[6px] px-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                            activeNote?.id === note.id && 'bg-foreground/[0.08]',
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
                                <span key={tag} className="rounded-[4px] bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </button>
                      </ContextMenuTrigger>
                      <StyledContextMenuContent>
                        <StyledContextMenuItem onClick={() => handleOpenNote(note.id)}>
                          <FileText className="h-3.5 w-3.5" />
                          Открыть
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openRenameDialogForNote(note)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Переименовать
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openCreateNoteDialog()}>
                          <FilePlus2 className="h-3.5 w-3.5" />
                          Новая заметка здесь
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => duplicateNote(note)}>
                          <Copy className="h-3.5 w-3.5" />
                          Дублировать
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openMoveDialog(note)}>
                          <FolderInput className="h-3.5 w-3.5" />
                          Переместить в папку
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem onClick={() => copyNoteLink(note)}>
                          <Link2 className="h-3.5 w-3.5" />
                          Скопировать wiki-link
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => copyNotePath(note)}>
                          <FileText className="h-3.5 w-3.5" />
                          Скопировать путь Markdown
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => revealNote(note)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Показать в Finder
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem variant="destructive" onClick={() => openDeleteDialogForNote(note)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
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
              {query || selectedTag ? t('notes.document.noMatchingNotes') : t('notes.document.noNotes')}
            </div>
          )}
        </div>
        </DndContext>
        <div className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          {t('notes.document.notesAssetsCount', { notes: notes.length, assets: allAssets.length })}
        </div>
          </>
        )}
      </aside>

      {!vaultCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('notes.document.resizeVault')}
          className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent"
          onPointerDown={(event) => startRailResize('vault', event)}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50 group-hover:bg-primary/60" />
        </div>
      )}

      {activeNote && (
        <>
          <aside
            style={{ width: getNoteRailWidth('outline', outlineCollapsed, outlineWidth) }}
            className={cn(
              'relative shrink-0 border-r border-border/70 bg-background/95 transition-[width] duration-200 ease-out motion-reduce:transition-none',
              outlineCollapsed ? 'flex flex-col items-center py-2' : 'flex min-h-0 flex-col',
            )}
          >
            {outlineCollapsed ? (
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleOutlineRail}
                aria-label={t('notes.document.expandOutline')}
                title={t('notes.document.expandOutline')}
              >
                <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />
              </button>
            ) : (
              <>
                <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border/60 px-3">
                  <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                    {t('notes.document.outline')}
                  </div>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={toggleOutlineRail}
                    aria-label={t('notes.document.collapseOutline')}
                    title={t('notes.document.collapseOutline')}
                  >
                    <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <button
                    type="button"
                    className="mb-2 flex w-full items-start gap-2 rounded-[6px] border border-border/55 bg-muted/[0.22] px-2 py-2 text-left hover:bg-foreground/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => richEditorRef.current?.commands.focus('start')}
                  >
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{documentOutline.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{activeNote.relativePath}</span>
                    </span>
                  </button>

                  {documentOutline.items.length > 0 ? (
                    <div className="space-y-0.5" role="navigation" aria-label={t('notes.document.outlineNavigation')}>
                      {documentOutline.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{ paddingLeft: `${8 + Math.min(item.level - 1, 4) * 10}px` }}
                          onClick={() => handleOutlineSelect(item)}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35" />
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">{item.line}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[8px] border border-dashed border-border/70 bg-muted/[0.14] px-3 py-4 text-xs text-muted-foreground">
                      {documentOutline.isBodyEmpty
                        ? t('notes.document.outlineEmpty')
                        : t('notes.document.outlineNoHeadings')}
                    </div>
                  )}

                  <div className="mt-3 rounded-[8px] border border-border/55 bg-muted/[0.14] p-2">
                    <div className="mb-1.5 text-[10px] uppercase text-muted-foreground/70">{t('notes.document.links')}</div>
                    <div className="grid grid-cols-3 gap-1 text-center text-[10px] text-muted-foreground">
                      <div className="rounded-[5px] bg-background/70 px-1 py-1">
                        <div className="text-xs font-medium text-foreground">{activeNote.links.length}</div>
                        {t('notes.document.outgoingShort')}
                      </div>
                      <div className="rounded-[5px] bg-background/70 px-1 py-1">
                        <div className="text-xs font-medium text-foreground">{activeNote.backlinks.length}</div>
                        {t('notes.document.incomingShort')}
                      </div>
                      <div className="rounded-[5px] bg-background/70 px-1 py-1">
                        <div className="text-xs font-medium text-foreground">{activeNoteTasks.length}</div>
                        {t('notes.inspector.tasks')}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </aside>
          {!outlineCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('notes.document.resizeOutline')}
              className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent"
              onPointerDown={(event) => startRailResize('outline', event)}
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50 group-hover:bg-primary/60" />
            </div>
          )}
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="min-h-[54px] shrink-0 border-b border-border/70 bg-background/95 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <nav className="mb-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" aria-label={t('notes.document.breadcrumb')}>
                {crumbs.map((crumb, index) => (
                  <React.Fragment key={`${crumb}:${index}`}>
                    {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/45" strokeWidth={1.7} />}
                    <span className={cn('truncate', index === crumbs.length - 1 && 'text-foreground/80')}>
                      {crumb}
                    </span>
                  </React.Fragment>
                ))}
              </nav>
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold tracking-normal">{activeNote?.title ?? t('notes.document.vault')}</div>
                {activeNote && <div className="shrink-0 text-[11px] text-muted-foreground/60">{activeNoteStats}</div>}
              </div>
            </div>
            {activeNote && (
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleInspector}
                aria-label={inspectorCollapsed ? t('notes.inspector.expand') : t('notes.inspector.collapse')}
                title={inspectorCollapsed ? t('notes.inspector.expand') : t('notes.inspector.collapse')}
              >
                {inspectorCollapsed
                  ? <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
                  : <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />}
              </button>
            )}
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <div className="mr-auto min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {activeNote ? activeNote.relativePath : t('notes.document.localNotePlaceholder')}
            </div>
            {dailyDate && (
              <div className="mr-1 flex shrink-0 items-center gap-1">
                <button className="grid h-7 w-7 place-items-center rounded-[5px] hover:bg-foreground/[0.06]" onClick={() => handleDailyShift(-1)} title={t('notes.document.previousDaily')} aria-label={t('notes.document.previousDaily')}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-muted-foreground">{dailyDate}</span>
                <button className="grid h-7 w-7 place-items-center rounded-[5px] hover:bg-foreground/[0.06]" onClick={() => handleDailyShift(1)} title={t('notes.document.nextDaily')} aria-label={t('notes.document.nextDaily')}>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <NotesAIMenu activeNote={activeNote} onAction={handleAskAgent} />
            <button className="grid h-7 w-7 place-items-center rounded-[5px] hover:bg-foreground/[0.06] disabled:opacity-40" onClick={handleImportAsset} disabled={!activeNote} title={t('notes.document.addAttachment')} aria-label={t('notes.document.addAttachment')}>
              <Paperclip className="h-4 w-4" />
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-[5px] hover:bg-foreground/[0.06] disabled:opacity-40" onClick={handleExportPdf} disabled={!activeNote} title={t('notes.document.exportPdf')} aria-label={t('notes.document.exportPdf')}>
              <FileDown className="h-4 w-4" />
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-[5px] hover:bg-foreground/[0.06] disabled:opacity-40" onClick={openRenameDialog} disabled={!activeNote} title={t('common.rename')} aria-label={t('common.rename')}>
              <Pencil className="h-4 w-4" />
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" onClick={() => setDeleteDialogOpen(true)} disabled={!activeNote} title={t('common.delete')} aria-label={t('common.delete')}>
              <Trash2 className="h-4 w-4" />
            </button>
            <span className={cn('w-20 shrink-0 text-right text-[11px]', saveError ? 'text-destructive' : 'text-muted-foreground')} title={t('notes.document.autosaveTitle')}>
              {saveError ? t('notes.document.saveError') : saving ? t('notes.document.saving') : dirty ? t('notes.document.autosave') : activeNote ? t('notes.document.saved') : ''}
            </span>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-muted/[0.06]">
          {!activeNote ? (
            <div className="grid h-full place-items-center">
              {loading ? (
                <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : (
                <div className="w-[360px] max-w-[calc(100%-48px)] rounded-[10px] border border-border/70 bg-background/85 p-4 text-center shadow-modal-small">
                  <div className="text-sm font-medium">{t('notes.document.noNoteSelected')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t('notes.document.noNoteSelectedHint')}</div>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDaily()}>
                      <CalendarDays className="h-3.5 w-3.5" />
                      {t('common.today')}
                    </Button>
                    <Button size="sm" onClick={() => openCreateNoteDialog()}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                      {t('notes.dialog.newNote')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
              onKeyDownCapture={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void openWikiLinkAtCursor()
                  return
                }
                if (!showWikiMenu) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setWikiIndex(index => Math.min(index + 1, Math.max(0, wikiMatches.length - 1)))
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
                  else if (wikiCreateLabel) completeWikiText(wikiCreateLabel)
                }
              }}
              onKeyUpCapture={syncRichWikiQuery}
              onMouseUpCapture={syncRichWikiQuery}
              onPasteCapture={(event) => {
                if (event.clipboardData.files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void importFiles(event.clipboardData.files)
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
              <div className="mx-auto min-h-full w-full max-w-[900px] rounded-[12px] border border-border/65 bg-background/92 px-5 py-6 shadow-panel-focused sm:px-8 lg:px-10">
                <TiptapMarkdownEditor
                  key={activeNote.id}
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
                  markdownEngine="official"
                  foldingStorageKey={`rox:notes:folding:${activeWorkspaceId}:${activeNote.id}`}
                  foldingLabels={foldingLabels}
                  roxBlockLabels={roxBlockLabels}
                  slashCommandLabels={slashCommandLabels}
                  className="min-h-[calc(100vh-220px)] w-full"
                />
                {richParts.frontmatter && (
                  <div className="mx-auto mt-4 max-w-[760px] rounded-[7px] border border-border/60 bg-muted/[0.22] px-3 py-2 text-[11px] text-muted-foreground">
                    {t('notes.document.metadataSaved')}
                  </div>
                )}
                <div className="mx-auto mt-4 max-w-[760px] rounded-[7px] border border-dashed border-border/50 bg-muted/[0.10] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t('notes.document.wikilinkHint')}
                </div>
              </div>
              {wikiMenu}
              {commentMenuPosition && pendingCommentAnchor && (
                <button
                  type="button"
                  className="fixed z-40 inline-flex h-9 items-center gap-2 rounded-full border border-border/70 bg-popover px-3 text-xs font-medium text-foreground shadow-strong hover:bg-foreground/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ left: commentMenuPosition.x, top: commentMenuPosition.y }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openCommentDraft}
                  title={t('notes.comments.addSelection')}
                >
                  <MessageSquarePlus className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  {t('notes.comments.button')}
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {sideSessionId && (
        <aside className="w-[380px] shrink-0 border-l border-border/60 bg-muted/[0.10] flex flex-col min-h-0">
          <div className="h-[42px] shrink-0 border-b border-border/60 px-3 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{t('notes.sideSession.title')}</div>
            <button
              type="button"
              className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
              onClick={closeSideSession}
              title={t('notes.sideSession.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
            {sideNoteChip && (
              <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px]">
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{sideNoteChip.title}</span>
                <span className="truncate text-muted-foreground">{sideNoteChip.path}</span>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">{t('notes.sideSession.hint')}</div>
          </div>
          <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col gap-2">
            <textarea
              value={sideSessionPrompt}
              onChange={(e) => {
                setSideSessionPrompt(e.target.value)
                if (sideSessionId) onInputChange(sideSessionId, e.target.value)
              }}
              className="min-h-0 flex-1 w-full resize-none rounded-[8px] border border-border/60 bg-background p-2.5 text-xs leading-relaxed outline-none focus:border-foreground/30"
              placeholder={t('notes.sideSession.promptPlaceholder')}
            />
            <div className="flex items-center justify-end gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={closeSideSession}>
                {t('notes.sideSession.cancel')}
              </Button>
              <Button size="sm" onClick={sendSideSession} disabled={!sideSessionPrompt.trim()}>
                {t('notes.sideSession.send')}
              </Button>
            </div>
          </div>
        </aside>
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
        newPropertyKey={newPropertyKey}
        newPropertyValue={newPropertyValue}
        currentNoteAssets={currentNoteAssets}
        uncreatedLinks={uncreatedLinks}
        activeNoteTasks={activeNoteTasks}
        openTasks={openTasks}
        comments={noteComments}
        pendingCommentAnchor={pendingCommentAnchor}
        commentDraft={commentDraft}
        activeCommentId={activeCommentId}
        commentAnchorStates={commentAnchorStates}
        commentPanelSignal={commentPanelSignal}
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
        onCommentDraftChange={setCommentDraft}
        onCreateComment={createComment}
        onSelectComment={(comment, resolved) => jumpToComment(comment, resolved)}
        onUpdateCommentBody={updateCommentBody}
        onResolveComment={(commentId) => setCommentResolved(commentId, true)}
        onReopenComment={(commentId) => setCommentResolved(commentId, false)}
        onDeleteComment={deleteComment}
        collapsed={inspectorCollapsed}
        onToggleCollapsed={toggleInspector}
      />
    </div>
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
      deleteFolderNoteCount={notes.filter(n => pathStartsWith(noteFolder(n), deleteFolderTarget)).length}
      onDeleteFolderDialogOpenChange={setDeleteFolderDialogOpen}
      onDeleteFolder={handleDeleteFolder}
    />
    </>
  )
}
