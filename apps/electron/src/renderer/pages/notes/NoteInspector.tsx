import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, CheckCircle2, CheckSquare2, ChevronLeft, ChevronRight, CornerDownRight, FileText, Link2, ListChecks, MessageSquareText, Paperclip, Plus, RotateCcw, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NoteAsset, NoteCommentAnchor, NoteCommentThread, NoteDocument, NoteSummary } from '../../../shared/types'
import type { ResolvedNoteCommentAnchor } from './note-comments'

// ---------------------------------------------------------------------------
// Types shared between inspector and dialogs
// ---------------------------------------------------------------------------

export type NoteTask = {
  noteId: string
  noteTitle: string
  line: number
  text: string
  checked: boolean
}

type InspectorPanel = 'properties' | 'links' | 'comments'

export function noteRelativeLabel(note: Pick<NoteSummary, 'relativePath'>): string {
  return note.relativePath.replace(/\.md$/i, '')
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function resolveNoteAssetPath(note: NoteDocument, ref: string): string {
  if (/^\/|^[A-Za-z]:[\\/]/.test(ref)) return ref
  const normalized = ref.replace(/^\.\//, '')
  const noteRootPath = note.path.endsWith(note.relativePath.replace(/\//g, '/'))
    ? note.path.slice(0, -note.relativePath.length).replace(/[\\/]$/, '')
    : note.path.replace(/[\\/][^\\/]+$/, '')
  if (normalized.startsWith('assets/')) return `${noteRootPath}/${normalized}`
  return `${note.path.replace(/[\\/][^\\/]+$/, '')}/${normalized}`
}

// ---------------------------------------------------------------------------
// AssetThumbnail — uses thumbnail:// protocol in Electron for efficient resize
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

export function AssetThumbnail({ asset, size = 'sm' }: { asset: NoteAsset; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = React.useState(false)
  const ext = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const dim = size === 'md' ? 'h-10 w-10' : 'h-7 w-7'

  if (!failed && IMAGE_EXTS.has(ext)) {
    return (
      <img
        src={`thumbnail://thumb/${encodeURIComponent(asset.path)}`}
        className={cn(dim, 'rounded object-cover shrink-0 border border-border/40')}
        alt=""
        onError={() => setFailed(true)}
      />
    )
  }
  if (ext === 'pdf') return <FileText className="h-4 w-4 shrink-0 text-destructive/70" />
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
}

// ---------------------------------------------------------------------------
// NoteInspector
// ---------------------------------------------------------------------------

export interface NoteInspectorProps {
  activeNote: NoteDocument | null
  content: string
  notes: NoteSummary[]
  allTasks: NoteTask[]
  allAssets: NoteAsset[]
  selectedTag: string | null
  tagDraft: string
  propertyEntries: [string, unknown][]
  newPropertyKey: string
  newPropertyValue: string
  currentNoteAssets: NoteAsset[]
  uncreatedLinks: string[]
  activeNoteTasks: NoteTask[]
  openTasks: NoteTask[]
  comments: NoteCommentThread[]
  pendingCommentAnchor: NoteCommentAnchor | null
  commentDraft: string
  activeCommentId: string | null
  commentAnchorStates: Record<string, ResolvedNoteCommentAnchor>
  commentPanelSignal: number
  presetTags?: string[]
  onTagDraftChange(v: string): void
  onApplyTags(): void
  onTagClick(tag: string): void
  onAddTag?(tag: string): void
  onUpdateProperty(key: string, value: unknown | undefined): void
  onNewPropertyKeyChange(v: string): void
  onNewPropertyValueChange(v: string): void
  onAddProperty(): void
  onOpenAssetDialog(): void
  onOpenFile(path: string): void
  onToggleTask(task: NoteTask): void
  onOpenNote(noteId: string): void
  onMissingLink(target: string): void
  onCommentDraftChange(v: string): void
  onCreateComment(): void
  onSelectComment(comment: NoteCommentThread, resolved?: ResolvedNoteCommentAnchor): void
  onUpdateCommentBody(commentId: string, body: string): void
  onResolveComment(commentId: string): void
  onReopenComment(commentId: string): void
  onDeleteComment(commentId: string): void
  collapsed?: boolean
  onToggleCollapsed?(): void
}

function propertyToInput(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')
}

function inputToProperty(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.includes(',')) return trimmed.split(',').map(part => part.trim()).filter(Boolean)
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed.replace(/^['"]|['"]$/g, '')
}

export function NoteInspector({
  activeNote,
  allAssets: _allAssets,
  selectedTag,
  tagDraft,
  propertyEntries,
  newPropertyKey,
  newPropertyValue,
  currentNoteAssets,
  uncreatedLinks,
  activeNoteTasks,
  openTasks,
  comments,
  pendingCommentAnchor,
  commentDraft,
  activeCommentId,
  commentAnchorStates,
  commentPanelSignal,
  presetTags = [],
  onTagDraftChange,
  onAddTag,
  onApplyTags,
  onTagClick,
  onUpdateProperty,
  onNewPropertyKeyChange,
  onNewPropertyValueChange,
  onAddProperty,
  onOpenAssetDialog,
  onOpenFile,
  onToggleTask,
  onOpenNote,
  onMissingLink,
  onCommentDraftChange,
  onCreateComment,
  onSelectComment,
  onUpdateCommentBody,
  onResolveComment,
  onReopenComment,
  onDeleteComment,
  collapsed = false,
  onToggleCollapsed,
}: NoteInspectorProps) {
  const { t } = useTranslation()
  const [panel, setPanel] = React.useState<InspectorPanel>('properties')
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null)
  const [editingCommentBody, setEditingCommentBody] = React.useState('')
  const inspectorPanels = [
    { id: 'properties' as const, label: t('notes.inspector.panelProperties'), icon: SlidersHorizontal },
    { id: 'links' as const, label: t('notes.inspector.panelLinks'), icon: Link2 },
    { id: 'comments' as const, label: t('notes.inspector.panelComments'), icon: MessageSquareText },
  ]
  void _allAssets

  React.useEffect(() => {
    if (commentPanelSignal > 0) setPanel('comments')
  }, [commentPanelSignal])

  const unresolvedComments = comments.filter(comment => !comment.resolvedAt)
  const resolvedComments = comments.filter(comment => comment.resolvedAt)
  const orderedComments = [...unresolvedComments, ...resolvedComments]

  const beginEditComment = (comment: NoteCommentThread) => {
    setEditingCommentId(comment.id)
    setEditingCommentBody(comment.body)
  }

  const commitEditComment = () => {
    if (!editingCommentId || !editingCommentBody.trim()) return
    onUpdateCommentBody(editingCommentId, editingCommentBody)
    setEditingCommentId(null)
    setEditingCommentBody('')
  }

  if (collapsed) {
    return (
      <aside className="w-8 shrink-0 border-l border-border/60 bg-muted/[0.12] flex flex-col items-center pt-2">
        <button
          className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onToggleCollapsed}
          title={t('notes.inspector.expand')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  if (!activeNote) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border/60 overflow-y-auto bg-muted/[0.12] p-3">
        <div className="mb-2 flex items-center justify-end">
          <button
            className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
            onClick={onToggleCollapsed}
            title={t('notes.inspector.collapse')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-[8px] border border-dashed border-border/70 bg-background/50 p-4 text-center">
          <div className="text-sm font-medium">{t('notes.inspector.title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('notes.inspector.emptyHint')}</div>
        </div>
      </aside>
    )
  }

  const suggestedPresets = presetTags.filter(
    tag => !activeNote.tags.some(existing => existing.toLowerCase() === tag.toLowerCase()),
  ).slice(0, 12)

  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-border/70 bg-background/95 p-3">
      <div className="mb-3 flex items-center justify-end">
        <button
          className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onToggleCollapsed}
          title={t('notes.inspector.collapse')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div
        className="mb-4 grid grid-cols-3 gap-1 rounded-[8px] border border-border/65 bg-muted/[0.14] p-0.5"
        role="tablist"
        aria-label={t('notes.inspector.panelLabel')}
      >
        {inspectorPanels.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              panel === id ? 'bg-background text-foreground shadow-minimal' : 'hover:bg-foreground/[0.06] hover:text-foreground',
            )}
            onClick={() => setPanel(id)}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      {panel === 'properties' && (
        <>
      {/* Tags */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Tag className="h-3.5 w-3.5" />
          {t('notes.inspector.tags')}
        </div>
        <div className="mb-2 flex gap-1.5">
          <input
            value={tagDraft}
            onChange={(e) => onTagDraftChange(e.target.value)}
            onBlur={onApplyTags}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); onApplyTags() } }}
            placeholder={t('notes.inspector.tagsPlaceholder')}
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-border/60 bg-background px-2 text-xs outline-none focus:border-foreground/30"
          />
          <button className="h-7 rounded-[5px] px-2 text-xs hover:bg-foreground/[0.06]" onClick={onApplyTags}>
            {t('notes.inspector.apply')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeNote.tags.length ? activeNote.tags.map(tag => (
            <button
              key={tag}
              className={cn(
                'rounded-[5px] bg-foreground/[0.06] px-2 py-1 text-[11px] hover:bg-foreground/[0.1]',
                selectedTag === tag && 'bg-accent/15 text-accent',
              )}
              onClick={() => onTagClick(tag)}
            >
              #{tag}
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.none')}</span>}
        </div>
        {suggestedPresets.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t('notes.inspector.suggestedTags')}
            </div>
            <div className="flex flex-wrap gap-1">
              {suggestedPresets.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className="rounded-[5px] border border-dashed border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06]"
                  onClick={() => onAddTag?.(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Tasks */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CheckSquare2 className="h-3.5 w-3.5" />
            {t('notes.inspector.tasks')}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t('notes.inspector.openCount', { count: openTasks.length })}
          </span>
        </div>
        <div className="space-y-1">
          {(activeNoteTasks.length ? activeNoteTasks : openTasks.slice(0, 8)).map(task => (
            <button
              key={`${task.noteId}:${task.line}:${task.text}`}
              onClick={() => onToggleTask(task)}
              className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <span className={cn(
                'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border border-border/80',
                task.checked && 'bg-foreground text-background'
              )}>
                {task.checked && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-xs', task.checked && 'text-muted-foreground line-through')}>{task.text}</span>
                {task.noteId !== activeNote.id && <span className="block truncate text-[11px] text-muted-foreground">{task.noteTitle}</span>}
              </span>
            </button>
          ))}
          {activeNoteTasks.length === 0 && openTasks.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('notes.inspector.noTasks')}</span>
          )}
        </div>
      </section>

      {/* Properties */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">{t('notes.inspector.properties')}</div>
          <span className="text-[11px] text-muted-foreground">{t('notes.inspector.frontmatter')}</span>
        </div>
        <div className="space-y-1.5">
          {propertyEntries.length > 0 ? propertyEntries.map(([key, value]) => (
            <div key={key} className="rounded-[6px] bg-background/80 px-2 py-1.5 ring-1 ring-border/50">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="truncate text-[11px] text-muted-foreground">{key}</div>
                <button
                  className="grid h-5 w-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onUpdateProperty(key, undefined)}
                  title={t('notes.inspector.removeProperty', { key })}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <input
                key={`${activeNote.id}:${key}:${propertyToInput(value)}`}
                defaultValue={propertyToInput(value)}
                onBlur={(e) => onUpdateProperty(key, inputToProperty(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="h-7 w-full rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.none')}</span>}
        </div>
        <div className="mt-2 rounded-[6px] border border-dashed border-border/70 bg-background/50 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Plus className="h-3 w-3" />
            {t('notes.inspector.addProperty')}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newPropertyKey}
              onChange={(e) => onNewPropertyKeyChange(e.target.value)}
              placeholder={t('notes.inspector.propertyKey')}
              className="h-7 min-w-0 flex-1 rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <input
              value={newPropertyValue}
              onChange={(e) => onNewPropertyValueChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddProperty() }}
              placeholder={t('notes.inspector.propertyValue')}
              className="h-7 min-w-0 flex-1 rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={onAddProperty} title={t('notes.inspector.addProperty')}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Assets */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            {t('notes.inspector.assets')}
          </div>
          <button
            className="h-6 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]"
            onClick={onOpenAssetDialog}
          >
            {t('notes.inspector.manage')}
          </button>
        </div>
        <div className="space-y-1">
          {currentNoteAssets.length ? currentNoteAssets.map(asset => (
            <button
              key={asset.relativePath}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(asset.path)}
            >
              <AssetThumbnail asset={asset} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs">{asset.name}</span>
              <span className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</span>
            </button>
          )) : activeNote.assetRefs.length ? activeNote.assetRefs.map(ref => (
            <button
              key={ref}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(resolveNoteAssetPath(activeNote, ref))}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{ref}</span>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noAssets')}</span>}
        </div>
      </section>
        </>
      )}

      {panel === 'links' && (
        <>
      {/* Uncreated links */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          {t('notes.inspector.uncreatedLinks')}
        </div>
        <div className="space-y-1">
          {uncreatedLinks.length ? uncreatedLinks.map(target => (
            <button
              key={target}
              onClick={() => onMissingLink(target)}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{target}</span>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.allLinksResolve')}</span>}
        </div>
      </section>

      {/* Backlinks */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          {t('notes.inspector.backlinks')}
        </div>
        <div className="space-y-1">
          {activeNote.backlinks.length ? activeNote.backlinks.map((backlink, index) => (
            <button
              key={`${backlink.noteId}-${index}`}
              onClick={() => onOpenNote(backlink.noteId)}
              className="w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <div className="truncate text-xs font-medium">{backlink.title}</div>
              <div className="line-clamp-2 text-[11px] text-muted-foreground">{backlink.preview}</div>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noBacklinks')}</span>}
        </div>
      </section>

      {/* Outgoing links */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          {t('notes.inspector.outgoingLinks')}
        </div>
        <div className="space-y-1">
          {activeNote.links.length ? activeNote.links.map((link, index) => (
            <button
              key={`${link.target}-${index}`}
              onClick={() => {
                // Prefer open by resolved note if caller has it; otherwise missing-link flow
                onMissingLink(link.target)
              }}
              className="w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <div className="truncate text-xs font-medium">[[{link.target}]]</div>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noOutgoingLinks')}</span>}
        </div>
      </section>
        </>
      )}

      {panel === 'comments' && (
        <section className="space-y-3">
          {pendingCommentAnchor && (
            <div className="rounded-[9px] border border-primary/30 bg-primary/[0.06] p-2.5 shadow-minimal">
              <div className="mb-2 flex items-start gap-2">
                <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">{t('notes.comments.selectionTitle')}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    “{pendingCommentAnchor.selectedText}”
                  </div>
                </div>
              </div>
              <textarea
                value={commentDraft}
                onChange={(event) => onCommentDraftChange(event.target.value)}
                placeholder={t('notes.comments.draftPlaceholder')}
                className="min-h-[72px] w-full resize-none rounded-[7px] border border-border/60 bg-background/95 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-primary/50"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="h-7 rounded-[6px] px-2 text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  onClick={() => onCommentDraftChange('')}
                >
                  {t('notes.comments.clear')}
                </button>
                <button
                  type="button"
                  className="h-7 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={onCreateComment}
                  disabled={!commentDraft.trim()}
                >
                  {t('notes.comments.add')}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('notes.comments.title')}
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {t('notes.comments.openCount', { count: unresolvedComments.length })}
            </span>
          </div>

          {orderedComments.length > 0 ? (
            <div className="space-y-2">
              {orderedComments.map(comment => {
                const resolved = commentAnchorStates[comment.id]
                const isActive = activeCommentId === comment.id
                const isResolved = Boolean(comment.resolvedAt)
                const isEditing = editingCommentId === comment.id
                return (
                  <article
                    key={comment.id}
                    className={cn(
                      'rounded-[9px] border bg-background/85 p-2.5 shadow-minimal transition-colors',
                      isActive ? 'border-primary/45 ring-1 ring-primary/20' : 'border-border/65',
                      isResolved && 'opacity-70',
                    )}
                  >
                    <button
                      type="button"
                      className="mb-2 w-full rounded-[6px] bg-muted/[0.22] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
                      onClick={() => onSelectComment(comment, resolved)}
                    >
                      <div className="flex items-center gap-1.5">
                        {resolved?.stale ? (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.8} />
                        ) : (
                          <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                          “{comment.anchor.selectedText}”
                        </span>
                      </div>
                      {resolved?.stale && (
                        <div className="mt-1 text-[10px] text-amber-500">{t('notes.comments.staleAnchor')}</div>
                      )}
                    </button>

                    <div className="mb-2 flex items-center gap-2">
                      <div className="grid h-5 w-5 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary">
                        {comment.author.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {comment.author}
                      </div>
                      {isResolved && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-500">
                          {t('notes.comments.resolved')}
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingCommentBody}
                          onChange={(event) => setEditingCommentBody(event.target.value)}
                          className="min-h-[76px] w-full resize-none rounded-[7px] border border-border/60 bg-background px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-primary/50"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="h-7 rounded-[6px] px-2 text-xs text-muted-foreground hover:bg-foreground/[0.06]"
                            onClick={() => {
                              setEditingCommentId(null)
                              setEditingCommentBody('')
                            }}
                          >
                            {t('notes.comments.cancel')}
                          </button>
                          <button
                            type="button"
                            className="h-7 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-45"
                            onClick={commitEditComment}
                            disabled={!editingCommentBody.trim()}
                          >
                            {t('notes.comments.save')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{comment.body}</div>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                      <button
                        type="button"
                        className="h-6 rounded-[5px] px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.06]"
                        onClick={() => onSelectComment(comment, resolved)}
                      >
                        {t('notes.comments.goToText')}
                      </button>
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <button
                            type="button"
                            className="h-6 rounded-[5px] px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.06]"
                            onClick={() => beginEditComment(comment)}
                          >
                            {t('notes.comments.edit')}
                          </button>
                        )}
                        {isResolved ? (
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06]"
                            onClick={() => onReopenComment(comment.id)}
                            title={t('notes.comments.reopen')}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500"
                            onClick={() => onResolveComment(comment.id)}
                            title={t('notes.comments.resolve')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="grid h-6 w-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDeleteComment(comment.id)}
                          title={t('notes.comments.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="rounded-[9px] border border-dashed border-border/70 bg-muted/[0.12] p-3 text-xs leading-relaxed text-muted-foreground">
              {t('notes.comments.emptyHint')}
            </div>
          )}
        </section>
      )}
    </aside>
  )
}
