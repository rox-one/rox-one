import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { NotesViewHost, type NotesViewNote } from '@/pages/notes/NotesViewHost'
import { NotesCommandPalette } from '@/pages/notes/NotesDocumentChrome'
import { NotesComments, NotesEditorHeadlineStyles } from '@/pages/notes/NotesReadingChrome'
import { VaultIndexHealthPanel } from '@/pages/notes/VaultIndexHealthPanel'
import { VaultInsightsPanel } from '@/pages/notes/VaultInsightsPanel'
import { defaultNoteCommands } from '@/pages/notes/document-ia'
import { matchWikiLinkCandidates, wikiMatchSubtitle } from '@/pages/notes/wiki-autocomplete'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

const SAMPLE_NOTES: NotesViewNote[] = [
  {
    id: 'ops/alpha',
    title: 'Alpha runbook',
    markdown: '# Alpha\n\nSee [[ops/beta]] and @rox.\n\n- [ ] Ship formula columns\n- [x] Inspector insights\n',
    tags: ['ops'],
    properties: { owner: 'rox' },
    links: [{ target: 'ops/beta' }],
    backlinks: [{ noteId: 'ops/beta', title: 'Beta checklist' }],
  },
  {
    id: 'ops/beta',
    title: 'Beta checklist',
    markdown: '# Beta\n\nBack to [[ops/alpha]].\n\n```\ncomment rail\n```\n',
    tags: ['ops', 'review'],
    links: [{ target: 'ops/alpha' }],
    backlinks: [{ noteId: 'ops/alpha', title: 'Alpha runbook' }],
  },
  {
    id: 'daily/2026-09-13',
    title: 'Daily note',
    markdown: 'Neighborhood graph for [[ops/alpha]].',
    tags: ['daily'],
    links: [{ target: 'ops/alpha' }],
  },
]

function NotesPlayground({ view }: { view: 'table' | 'canvas' | 'graph' | 'outline' }) {
  const [activeNoteId, setActiveNoteId] = React.useState<string | null>('ops/alpha')
  return (
    <div className="h-full min-h-[420px] bg-background" data-testid={`playground-notes-${view}`}>
      <NotesViewHost
        view={view}
        notes={SAMPLE_NOTES}
        activeNoteId={activeNoteId}
        workspaceId="playground-workspace"
        onOpenNote={setActiveNoteId}
        onCreateNote={() => undefined}
        onConvert={() => undefined}
      />
    </div>
  )
}

function NotesEmptyPlayground({ view }: { view: 'table' | 'canvas' | 'graph' | 'outline' }) {
  return (
    <div className="h-full min-h-[420px] bg-background" data-testid={`playground-notes-empty-${view}`}>
      <NotesViewHost
        view={view}
        notes={[]}
        activeNoteId={null}
        workspaceId="playground-workspace"
        onOpenNote={() => undefined}
        onCreateNote={() => undefined}
        onConvert={() => undefined}
      />
    </div>
  )
}

function NotesInspectorPlayground() {
  const [footnoteDraft, setFootnoteDraft] = React.useState('Clarify heatmap empty-day copy')
  return (
    <div className="mx-auto w-[320px] space-y-2 p-4" data-testid="playground-notes-inspector">
      <VaultIndexHealthPanel
        rebuilding={false}
        onRebuild={() => undefined}
        health={{
          ok: true,
          available: true,
          dbPath: '/mock/notes.sqlite',
          schemaVersion: 3,
          documentCount: 42,
          recovered: false,
          indexed: 40,
          unchanged: 2,
          skipped: 0,
          truncated: false,
          watching: true,
          lastExternalChangeAt: Date.now() - 12_000,
        }}
      />
      <VaultInsightsPanel
        footnoteDraft={footnoteDraft}
        onFootnoteDraftChange={setFootnoteDraft}
        onApplyLink={() => undefined}
        onApplyMerge={() => undefined}
        onUndoMerge={() => undefined}
        onCreateFootnote={() => undefined}
        onUpdateFootnote={() => undefined}
        onJumpFootnote={() => undefined}
        insights={{
          entities: [{
            id: 'rox',
            name: 'Rox',
            kind: 'mention',
            documentId: 'ops/alpha',
            evidence: '@rox',
            line: 3,
          }],
          linkSuggestions: [{
            targetId: 'ops/beta',
            targetTitle: 'Beta checklist',
            mention: 'beta',
            preview: 'See beta in the runbook body',
            line: 3,
            score: 2,
            reason: 'prefix',
          }],
          unlinkedMentions: [],
          brokenLinks: [{ target: 'missing-note', line: 8, preview: '[[missing-note]] is unresolved' }],
          suggestedMerges: [],
          footnotes: [{
            id: 'fn-1',
            hasRef: true,
            hasDef: true,
            orphan: false,
            unused: false,
            line: 5,
            text: 'Ship formula columns next.',
          }],
        }}
      />
    </div>
  )
}

function NotesWikiPlayground() {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('be')
  const matches = matchWikiLinkCandidates(SAMPLE_NOTES, query, { excludeId: 'ops/alpha' })
  const showCreate = query.trim().length > 0 && matches.every((note) => note.title.toLowerCase() !== query.trim().toLowerCase())
  return (
    <div className="relative min-h-[280px] p-6" data-testid="playground-notes-wiki">
      <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        [[
        <input
          className="h-8 w-56 rounded-[5px] border border-border/60 bg-background px-2 text-sm text-foreground"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('notes.editor.wikiHint')}
        />
      </label>
      <div
        className="absolute z-20 w-80 rounded-[8px] border border-border/70 bg-popover p-1 shadow-strong"
        data-testid="notes-wiki-menu"
      >
        {matches.map((note, index) => (
          <button
            key={note.id}
            type="button"
            className={cn(
              'w-full rounded-[5px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]',
              index === 0 && 'bg-foreground/[0.08]',
            )}
          >
            <div className="truncate text-xs font-medium">{note.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{wikiMatchSubtitle(note, query)}</div>
          </button>
        ))}
        {showCreate ? (
          <button
            type="button"
            data-testid="notes-wiki-create"
            className="mt-1 flex w-full items-center gap-2 rounded-[5px] border-t border-border/60 px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('notes.editor.wikiCreate', { title: query.trim() })}
          </button>
        ) : null}
        <div className="border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
          {t('notes.editor.wikiHint')}
        </div>
      </div>
    </div>
  )
}

function NotesPalettePlayground() {
  const catalog = defaultNoteCommands({
    sessions: [{ id: 'row-1', title: 'Fix authentication' }],
    agents: [{ id: 'rox', label: 'Rox' }],
    projects: [{ id: 'ops', name: 'Ops' }],
    tasks: [{ id: 'ops/alpha:1', text: 'Ship formula columns' }],
    people: [{ id: 'ada', name: 'Ada' }],
    entities: [{ id: 'heatmap', name: 'Heatmap' }],
  })
  return (
    <div className="relative min-h-[280px] p-6" data-testid="playground-notes-palette">
      <NotesCommandPalette
        query="@"
        items={catalog}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    </div>
  )
}

function NotesCommentsPlayground() {
  return (
    <div className="flex h-[420px] bg-background" data-testid="playground-notes-comments">
      <NotesEditorHeadlineStyles />
      <div className="flex-1 p-4 text-sm">
        <p>Select text in the note and comment here.</p>
      </div>
      <NotesComments
        noteId="ops/alpha"
        draftQuote="heatmap empty-day copy"
        onClearDraft={() => undefined}
        markdownComments={[
          { id: 'c1', quote: 'formula columns', body: 'Keep PremiumMenuSelect here.', createdAt: Date.now() - 60_000 },
        ]}
        onJumpToQuote={() => undefined}
      />
    </div>
  )
}

export const notesComponents: ComponentEntry[] = [
  {
    id: 'notes-table',
    name: 'Notes · formula table',
    category: 'Notes',
    level: 'Screens',
    description: 'Saved layout, group-by and formula columns without native selects',
    component: NotesPlayground,
    props: [{ name: 'view', control: { type: 'select', options: [{ label: 'Table', value: 'table' }] }, defaultValue: 'table' }],
    layout: 'full',
  },
  {
    id: 'notes-table-empty',
    name: 'Notes · table empty',
    category: 'Notes',
    level: 'Screens',
    description: 'Table empty copy when the vault has no matching notes',
    component: NotesEmptyPlayground,
    props: [{ name: 'view', control: { type: 'select', options: [{ label: 'Table', value: 'table' }] }, defaultValue: 'table' }],
    layout: 'full',
  },
  {
    id: 'notes-graph',
    name: 'Notes · graph neighborhood',
    category: 'Notes',
    level: 'Screens',
    description: 'Wikilink / backlink graph with nearby isolation',
    component: NotesPlayground,
    props: [{ name: 'view', control: { type: 'select', options: [{ label: 'Graph', value: 'graph' }] }, defaultValue: 'graph' }],
    layout: 'full',
  },
  {
    id: 'notes-outline',
    name: 'Notes · outline',
    category: 'Notes',
    level: 'Screens',
    description: 'Heading outline empty and populated states',
    component: NotesPlayground,
    props: [{ name: 'view', control: { type: 'select', options: [{ label: 'Outline', value: 'outline' }] }, defaultValue: 'outline' }],
    layout: 'full',
  },
  {
    id: 'notes-outline-empty',
    name: 'Notes · outline empty',
    category: 'Notes',
    level: 'Screens',
    description: 'Outline empty copy when the note has no headings',
    component: NotesEmptyPlayground,
    props: [{ name: 'view', control: { type: 'select', options: [{ label: 'Outline', value: 'outline' }] }, defaultValue: 'outline' }],
    layout: 'full',
  },
  {
    id: 'notes-inspector',
    name: 'Notes · inspector insights',
    category: 'Notes',
    level: 'Patterns',
    description: 'Index health, link suggestions, footnotes',
    component: NotesInspectorPlayground,
    props: [],
    layout: 'top',
  },
  {
    id: 'notes-wiki',
    name: 'Notes · [[ autocomplete',
    category: 'Notes',
    level: 'Patterns',
    description: 'Wikilink candidate menu and create-new row',
    component: NotesWikiPlayground,
    props: [],
    layout: 'top',
  },
  {
    id: 'notes-palette',
    name: 'Notes · @ palette',
    category: 'Notes',
    level: 'Patterns',
    description: 'Grouped @ command palette',
    component: NotesPalettePlayground,
    props: [],
    layout: 'top',
  },
  {
    id: 'notes-comments',
    name: 'Notes · comment rail',
    category: 'Notes',
    level: 'Patterns',
    description: 'Comment rail with quote jump and composer',
    component: NotesCommentsPlayground,
    props: [],
    layout: 'full',
  },
]
