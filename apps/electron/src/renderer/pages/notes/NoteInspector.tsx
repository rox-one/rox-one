import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { FrontmatterProjection, PropertyBinding, PropertyValue } from '@rox/core/docs'
import { Check, CheckSquare2, ChevronLeft, ChevronRight, FileText, Link2, ListChecks, Paperclip, Plus, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NoteAsset, NoteDocument, NoteEntityMerge, NoteFootnoteChrome, NoteIndexHealth, NoteInsights, NoteLinkSuggestion, NoteSummary } from '../../../shared/types'
import { VaultInsightsPanel } from './VaultInsightsPanel'
import { VaultIndexHealthPanel } from './VaultIndexHealthPanel'

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
  propertyProjection: FrontmatterProjection
  propertiesWritable: boolean
  onUpdateScalarProperty(path: string[], value: PropertyValue): Promise<boolean>
  newPropertyKey: string
  newPropertyValue: string
  currentNoteAssets: NoteAsset[]
  uncreatedLinks: string[]
  activeNoteTasks: NoteTask[]
  openTasks: NoteTask[]
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
  insights?: NoteInsights
  footnoteDraft?: string
  onFootnoteDraftChange?(value: string): void
  onApplyLink?(suggestion: NoteLinkSuggestion): void
  onApplyMerge?(merge: NoteEntityMerge): void
  onUndoMerge?(merge: NoteEntityMerge): void
  onCreateFootnote?(): void
  onUpdateFootnote?(footnote: NoteFootnoteChrome, body: string): void
  onJumpFootnote?(footnote: NoteFootnoteChrome): void
  indexHealth?: NoteIndexHealth
  indexRebuilding?: boolean
  onRebuildIndex?(): void
  collapsed?: boolean
  onToggleCollapsed?(): void
}

function propertyToInput(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')
}

function ScalarPropertyField({ binding, writable, onSave }: {
  binding: PropertyBinding
  writable: boolean
  onSave(path: string[], value: PropertyValue): Promise<boolean>
}) {
  const { t } = useTranslation()
  const labelId = React.useId()
  const helpId = React.useId()
  const original = binding.value === null ? 'null' : String(binding.value ?? '')
  const [draft, setDraft] = React.useState(original)
  const [pending, setPending] = React.useState(false)
  const [invalid, setInvalid] = React.useState(false)
  const originalType = binding.value === null ? 'null' : typeof binding.value
  const [type, setType] = React.useState(originalType)
  const readOnly = !writable || Boolean(binding.readOnly) || !binding.range
  const save = async () => {
    if (readOnly || pending || (draft === original && type === originalType)) return
    let value: PropertyValue
    if (type === 'string') value = draft
    else if (type === 'number' && draft.trim() && Number.isFinite(Number(draft))) value = Number(draft)
    else if (type === 'boolean' && (draft === 'true' || draft === 'false')) value = draft === 'true'
    else if (type === 'null' && draft === 'null') value = null
    else { setInvalid(true); return }
    setPending(true)
    try { setInvalid(!await onSave(binding.keyPath, value)) }
    finally { setPending(false) }
  }
  return (
    <div className="space-y-1" data-note-property={binding.keyPath.join('.')}>
      <label id={labelId} className="block truncate text-[11px] text-muted-foreground">{binding.keyPath.join('.')}</label>
      <select
        value={type}
        disabled={readOnly || pending}
        aria-label={t('notes.content.propertyTypeLabel', { key: binding.keyPath.join('.') })}
        onChange={event => {
          setType(event.target.value)
          if (event.target.value === 'null') setDraft('null')
          setInvalid(false)
        }}
        className="h-6 rounded-[var(--radius-control)] border border-border/50 bg-background px-1 text-[10px]"
      >
        {['string', 'number', 'boolean', 'null'].map(kind => <option key={kind} value={kind}>{t(`notes.content.propertyTypes.${kind}`)}</option>)}
        {originalType === 'undefined' && <option value="undefined">{t('notes.content.propertyReadOnly.unsupportedValue')}</option>}
      </select>
      <input
        value={draft}
        onChange={event => { setDraft(event.target.value); setInvalid(false) }}
        onBlur={() => { void save() }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }}
        readOnly={readOnly || pending}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        aria-invalid={invalid || undefined}
        aria-busy={pending || undefined}
        className="h-7 w-full rounded-[var(--radius-card)] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30 read-only:text-muted-foreground"
      />
      <p id={helpId} className={cn('text-[10px] leading-4 text-muted-foreground', invalid && 'text-destructive')}>
        {invalid ? t('notes.content.propertyTypeInvalid', { type }) : binding.readOnly
          ? t(`notes.content.propertyReadOnly.${binding.readOnly}`)
          : t('notes.content.propertyTypeHelp', { type })}
      </p>
    </div>
  )
}

export function NoteInspector({
  activeNote,
  allAssets: _allAssets,
  selectedTag,
  tagDraft,
  propertyEntries,
  propertyProjection,
  propertiesWritable,
  onUpdateScalarProperty,
  newPropertyKey,
  newPropertyValue,
  currentNoteAssets,
  uncreatedLinks,
  activeNoteTasks,
  openTasks,
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
  insights,
  footnoteDraft = '',
  onFootnoteDraftChange,
  onApplyLink,
  onApplyMerge,
  onUndoMerge,
  onCreateFootnote,
  onUpdateFootnote,
  onJumpFootnote,
  indexHealth,
  indexRebuilding = false,
  onRebuildIndex,
  collapsed = false,
  onToggleCollapsed,
}: NoteInspectorProps) {
  const { t } = useTranslation()
  void _allAssets

  if (collapsed) {
    return (
      <aside className="w-8 shrink-0 bg-muted/[0.12] flex flex-col items-center pt-2">
        <button
          className="h-7 w-7 rounded-[var(--radius-control)] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
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
            className="h-7 w-7 rounded-[var(--radius-control)] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
            onClick={onToggleCollapsed}
            title={t('notes.inspector.collapse')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-[var(--radius-card)] border border-dashed border-border/70 bg-background/50 p-4 text-center">
          <div className="text-sm font-medium">{t('notes.inspector.title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('notes.inspector.emptyHint')}</div>
        </div>
        {indexHealth && onRebuildIndex ? (
          <div className="mt-4">
            <VaultIndexHealthPanel health={indexHealth} rebuilding={indexRebuilding} onRebuild={onRebuildIndex} />
          </div>
        ) : null}
      </aside>
    )
  }

  const suggestedPresets = presetTags.filter(
    tag => !activeNote.tags.some(existing => existing.toLowerCase() === tag.toLowerCase()),
  ).slice(0, 12)

  return (
    <aside className="w-[320px] shrink-0 border-l border-border/60 overflow-y-auto bg-muted/[0.12] p-3">
      <div className="mb-3 flex items-center justify-end">
        <button
          className="h-7 w-7 rounded-[var(--radius-control)] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onToggleCollapsed}
          title={t('notes.inspector.collapse')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {indexHealth && onRebuildIndex ? (
        <VaultIndexHealthPanel health={indexHealth} rebuilding={indexRebuilding} onRebuild={onRebuildIndex} />
      ) : null}
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
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] border border-border/60 bg-background px-2 text-xs outline-none focus:border-foreground/30"
          />
          <button className="h-7 rounded-[var(--radius-control)] px-2 text-xs hover:bg-foreground/[0.06]" onClick={onApplyTags}>
            {t('notes.inspector.apply')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeNote.tags.length ? activeNote.tags.map(tag => (
            <button
              key={tag}
              className={cn(
                'rounded-[var(--radius-control)] bg-foreground/[0.06] px-2 py-1 text-[11px] hover:bg-foreground/[0.1]',
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
                  className="rounded-[var(--radius-control)] border border-dashed border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06]"
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
              className="flex w-full items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <span className={cn(
                'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border/80',
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
          {propertyProjection.status === 'readOnly' && <p role="status" className="text-xs text-muted-foreground">{t('notes.content.propertySourceReadOnly')}</p>}
          {propertyProjection.status === 'ok' && propertyProjection.properties.filter(binding => binding.keyPath[0] !== 'tags').map(binding => (
            <div key={`${activeNote.id}:${JSON.stringify(binding.keyPath)}:${typeof binding.value}:${String(binding.value)}`} className="rounded-[var(--radius-card)] bg-background/80 px-2 py-1.5 ring-1 ring-border/50">
              <ScalarPropertyField binding={binding} writable={propertiesWritable} onSave={onUpdateScalarProperty} />
              {binding.keyPath.length === 1 && !binding.readOnly && propertiesWritable && <button
                type="button"
                className="mt-1 text-[10px] text-muted-foreground hover:text-destructive"
                onClick={() => onUpdateProperty(binding.keyPath[0] ?? '', undefined)}
              >{t('notes.inspector.removeProperty', { key: binding.keyPath[0] })}</button>}
            </div>
          ))}
          {propertyEntries.filter(([key]) => propertyProjection.status === 'ok' && !propertyProjection.properties.some(binding => binding.keyPath[0] === key)).map(([key, value]) => (
            <div key={key} className="rounded-[var(--radius-card)] bg-background/80 px-2 py-1.5 ring-1 ring-border/50">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="truncate text-[11px] text-muted-foreground">{key}</div>
                <button
                  className="grid h-5 w-5 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  disabled={!propertiesWritable}
                  onClick={() => onUpdateProperty(key, undefined)}
                  title={t('notes.inspector.removeProperty', { key })}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <input
                key={`${activeNote.id}:${key}:${propertyToInput(value)}`}
                defaultValue={propertyToInput(value)}
                readOnly
                aria-label={key}
                title={t('notes.content.propertyReadOnly.unsupportedValue')}
                className="h-7 w-full rounded-[var(--radius-card)] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
          ))}
          {propertyEntries.length === 0 && propertyProjection.status === 'ok' && propertyProjection.properties.length === 0 && <span className="text-xs text-muted-foreground">{t('notes.inspector.none')}</span>}
        </div>
        <div className="mt-2 rounded-[var(--radius-card)] border border-dashed border-border/70 bg-background/50 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Plus className="h-3 w-3" />
            {t('notes.inspector.addProperty')}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newPropertyKey}
              disabled={!propertiesWritable || propertyProjection.status === 'readOnly'}
              aria-label={t('notes.inspector.propertyKey')}
              onChange={(e) => onNewPropertyKeyChange(e.target.value)}
              placeholder={t('notes.inspector.propertyKey')}
              className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <input
              value={newPropertyValue}
              disabled={!propertiesWritable || propertyProjection.status === 'readOnly'}
              aria-label={t('notes.inspector.propertyValue')}
              onChange={(e) => onNewPropertyValueChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddProperty() }}
              placeholder={t('notes.inspector.propertyValue')}
              className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <button disabled={!propertiesWritable || propertyProjection.status === 'readOnly'} className="h-7 w-7 rounded-[var(--radius-control)] hover:bg-foreground/[0.06] grid place-items-center" onClick={onAddProperty} title={t('notes.inspector.addProperty')}>
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
            className="h-6 rounded-[var(--radius-control)] px-2 text-[11px] hover:bg-foreground/[0.06]"
            onClick={onOpenAssetDialog}
          >
            {t('notes.inspector.manage')}
          </button>
        </div>
        <div className="space-y-1">
          {currentNoteAssets.length ? currentNoteAssets.map(asset => (
            <button
              key={asset.relativePath}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(asset.path)}
            >
              <AssetThumbnail asset={asset} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs">{asset.name}</span>
              <span className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</span>
            </button>
          )) : activeNote.assetRefs.length ? activeNote.assetRefs.map(ref => (
            <button
              key={ref}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(resolveNoteAssetPath(activeNote, ref))}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{ref}</span>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noAssets')}</span>}
        </div>
      </section>

      {insights && onApplyLink && onApplyMerge && onUndoMerge && onCreateFootnote && onUpdateFootnote && onJumpFootnote && onFootnoteDraftChange ? (
        <VaultInsightsPanel
          insights={insights}
          footnoteDraft={footnoteDraft}
          onFootnoteDraftChange={onFootnoteDraftChange}
          onApplyLink={onApplyLink}
          onApplyMerge={onApplyMerge}
          onUndoMerge={onUndoMerge}
          onCreateFootnote={onCreateFootnote}
          onUpdateFootnote={onUpdateFootnote}
          onJumpFootnote={onJumpFootnote}
        />
      ) : null}

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
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
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
              className="w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
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
              className="w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <div className="truncate text-xs font-medium">[[{link.target}]]</div>
            </button>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noOutgoingLinks')}</span>}
        </div>
      </section>
    </aside>
  )
}
