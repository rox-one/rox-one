import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Highlighter, Link2, Merge, Plus, Quote } from 'lucide-react'
import type {
  NoteEntityMerge,
  NoteFootnoteChrome,
  NoteInsights,
  NoteLinkSuggestion,
} from '../../../shared/types'

export const EMPTY_NOTE_INSIGHTS: NoteInsights = {
  entities: [],
  linkSuggestions: [],
  unlinkedMentions: [],
  brokenLinks: [],
  suggestedMerges: [],
  footnotes: [],
}

export function VaultInsightsPanel({
  insights,
  footnoteDraft,
  onFootnoteDraftChange,
  onApplyLink,
  onApplyMerge,
  onUndoMerge,
  onCreateFootnote,
  onUpdateFootnote,
  onJumpFootnote,
}: {
  insights: NoteInsights
  footnoteDraft: string
  onFootnoteDraftChange(value: string): void
  onApplyLink(suggestion: NoteLinkSuggestion): void
  onApplyMerge(merge: NoteEntityMerge): void
  onUndoMerge(merge: NoteEntityMerge): void
  onCreateFootnote(): void
  onUpdateFootnote(footnote: NoteFootnoteChrome, body: string): void
  onJumpFootnote(footnote: NoteFootnoteChrome): void
}) {
  const { t } = useTranslation()

  return (
    <>
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          {t('notes.inspector.linkSuggestions')}
        </div>
        <div className="space-y-1">
          {insights.linkSuggestions.length ? insights.linkSuggestions.slice(0, 8).map((suggestion) => (
            <div
              key={`${suggestion.targetId}:${suggestion.line}:${suggestion.mention}`}
              className="rounded-[6px] px-2 py-1.5 hover:bg-foreground/[0.04]"
            >
              <div className="truncate text-xs font-medium">[[{suggestion.targetTitle}]]</div>
              <div className="line-clamp-2 text-[11px] text-muted-foreground">{suggestion.preview}</div>
              <button
                type="button"
                className="mt-1 h-6 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]"
                onClick={() => onApplyLink(suggestion)}
              >
                {t('notes.inspector.applyLink')}
              </button>
            </div>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noSuggestions')}</span>}
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Highlighter className="h-3.5 w-3.5" />
          {t('notes.inspector.entities')}
        </div>
        <div className="space-y-1">
          {insights.entities.length ? insights.entities.slice(0, 10).map((entity) => (
            <div key={`${entity.id}:${entity.line}:${entity.name}`} className="rounded-[6px] px-2 py-1.5">
              <div className="truncate text-xs font-medium">{entity.name}</div>
              <div className="text-[11px] text-muted-foreground">{entity.kind} · {entity.evidence}</div>
            </div>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noEntities')}</span>}
        </div>
        {insights.suggestedMerges.length > 0 && (
          <div className="mt-2 space-y-1">
            {insights.suggestedMerges.slice(0, 4).map((merge) => (
              <div key={`${merge.fromId}:${merge.toId}`} className="rounded-[6px] border border-dashed border-border/70 px-2 py-1.5">
                <div className="text-xs">{t('notes.inspector.mergeEntities', { name: merge.toName })}</div>
                <div className="text-[11px] text-muted-foreground">{merge.fromName} → {merge.toName}</div>
                <div className="mt-1 flex gap-1">
                  <button type="button" className="h-6 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]" onClick={() => onApplyMerge(merge)}>
                    <Merge className="mr-1 inline h-3 w-3" />
                    {t('notes.inspector.applyMerge')}
                  </button>
                  <button type="button" className="h-6 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]" onClick={() => onUndoMerge(merge)}>
                    {t('notes.inspector.undoMerge')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Quote className="h-3.5 w-3.5" />
          {t('notes.inspector.footnotes')}
        </div>
        <div className="mb-2 flex gap-1.5">
          <input
            value={footnoteDraft}
            onChange={(event) => onFootnoteDraftChange(event.target.value)}
            placeholder={t('notes.inspector.footnotePlaceholder')}
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-border/60 bg-background px-2 text-xs outline-none focus:border-foreground/30"
          />
          <button type="button" className="h-7 rounded-[5px] px-2 text-xs hover:bg-foreground/[0.06]" onClick={onCreateFootnote}>
            <Plus className="h-3.5 w-3.5" />
            {t('notes.inspector.createFootnote')}
          </button>
        </div>
        <div className="space-y-1">
          {insights.footnotes.length ? insights.footnotes.map((footnote) => (
            <div key={footnote.id} className="rounded-[6px] px-2 py-1.5">
              <button type="button" className="w-full text-left" onClick={() => onJumpFootnote(footnote)}>
                <div className="truncate text-xs font-medium">[^{footnote.id}]</div>
                <div className="line-clamp-2 text-[11px] text-muted-foreground">{footnote.text || t('notes.inspector.footnotePlaceholder')}</div>
                {footnote.orphan ? <div className="text-[11px] text-destructive">{t('notes.inspector.footnoteOrphan')}</div> : null}
                {footnote.unused ? <div className="text-[11px] text-muted-foreground">{t('notes.inspector.footnoteUnused')}</div> : null}
              </button>
              <input
                defaultValue={footnote.text}
                onBlur={(event) => onUpdateFootnote(footnote, event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                className="mt-1 h-7 w-full rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noFootnotes')}</span>}
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {t('notes.inspector.brokenLinks')}
        </div>
        <div className="space-y-1">
          {insights.brokenLinks.length ? insights.brokenLinks.map((link) => (
            <div key={`${link.target}:${link.line}`} className="rounded-[6px] px-2 py-1.5">
              <div className="truncate text-xs font-medium">[[{link.target}]]</div>
              <div className="line-clamp-2 text-[11px] text-muted-foreground">{link.preview}</div>
            </div>
          )) : <span className="text-xs text-muted-foreground">{t('notes.inspector.noBrokenLinks')}</span>}
        </div>
      </section>
    </>
  )
}
