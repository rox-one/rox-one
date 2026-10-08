/**
 * W1-08 (#1505) — «Связать элемент Rox…» picker (UI-SPEC §4.3).
 *
 * 560 px dialog: search input, kind filter chips, then Recent / Results
 * groups. ↑↓ move, Enter links, Esc closes. Search comes from the entity
 * data source (STUB(#1504) until W1-07 registers a provider); typing a full
 * `kind:id` ref offers it as a literal row (unless its literal cannot be
 * written inside `[[…]]`, e.g. an id with `|` or `]`). Nothing is created
 * here: the caller decides what "link" means (Notes inserts a mention node)
 * and can hide refs it cannot link with `accept`.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import {
  formatEntityRef,
  parseEntityRef,
  type EntityKind,
  type EntityRef,
} from '@rox/core/entities'
import { FOCUS_RING, MOTION_FAST, SELECTED_TINT } from '@rox/ui/primitives'
import { isWikilinkSafeRefLiteral } from '@rox/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { EntityKindIcon } from './kind-icons'
import { entityKindLabel } from './entity-format'
import { getEntityDataSource, recentEntities, rememberRecentEntity, type EntitySearchHit } from './entity-data-source'

export const ENTITY_PICKER_KIND_FILTERS: readonly EntityKind[] = ['task', 'note', 'project', 'goal', 'calendar-event', 'channel', 'file', 'person']
const SEARCH_DEBOUNCE_MS = 120
const RESULT_LIMIT = 20

export interface EntityPickerItem extends EntitySearchHit {
  section: 'literal' | 'recent' | 'results'
}

/** Build the visible rows (pure; exported for tests). */
export function buildEntityPickerItems(input: {
  query: string
  kind: EntityKind | null
  recents: readonly EntitySearchHit[]
  results: readonly EntitySearchHit[]
  /** Hide refs the caller cannot link (e.g. Notes: not writable as `[[…]]`). */
  accept?: (ref: EntityRef) => boolean
}): EntityPickerItem[] {
  const query = input.query.trim()
  const lower = query.toLowerCase()
  const items: EntityPickerItem[] = []
  const seen = new Set<string>()
  const push = (hit: EntitySearchHit, section: EntityPickerItem['section']) => {
    if (input.kind && hit.ref.kind !== input.kind) return
    if (input.accept && !input.accept(hit.ref)) return
    const key = formatEntityRef(hit.ref)
    if (seen.has(key)) return
    seen.add(key)
    items.push({ ...hit, section })
  }
  if (query) {
    const literal = parseEntityRef(query)
    if (literal.ok && isWikilinkSafeRefLiteral(formatEntityRef(literal.value))) {
      push({ ref: literal.value, title: formatEntityRef(literal.value) }, 'literal')
    }
  }
  for (const hit of input.recents) {
    if (!lower || hit.title.toLowerCase().includes(lower) || formatEntityRef(hit.ref).includes(lower)) push(hit, 'recent')
  }
  for (const hit of input.results) push(hit, 'results')
  return items
}

export interface EntityPickerPanelProps {
  workspaceId: string | null
  onSelect: (hit: EntitySearchHit) => void
  onCancel?: () => void
  initialQuery?: string
  autoFocus?: boolean
  className?: string
  /** Hide refs the caller cannot link. */
  accept?: (ref: EntityRef) => boolean
}

export function EntityPickerPanel({ workspaceId, onSelect, onCancel, initialQuery = '', autoFocus, className, accept }: EntityPickerPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState(initialQuery)
  const [kind, setKind] = React.useState<EntityKind | null>(null)
  const [results, setResults] = React.useState<EntitySearchHit[]>([])
  const [active, setActive] = React.useState(0)
  const listId = React.useId()
  const recents = React.useMemo(() => (workspaceId ? recentEntities(workspaceId) : []), [workspaceId])

  React.useEffect(() => {
    if (!workspaceId || !query.trim()) { setResults([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      getEntityDataSource()
        .search(workspaceId, query.trim(), { ...(kind ? { kinds: [kind] } : {}), limit: RESULT_LIMIT })
        .then((hits) => { if (!cancelled) setResults(hits) })
        .catch(() => { if (!cancelled) setResults([]) })
    }, SEARCH_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [workspaceId, query, kind])

  const items = React.useMemo(
    () => buildEntityPickerItems({ query, kind, recents, results, ...(accept ? { accept } : {}) }),
    [query, kind, recents, results, accept],
  )
  React.useEffect(() => { setActive(0) }, [query, kind])

  const choose = (item: EntityPickerItem | undefined) => {
    if (!item) return
    if (workspaceId) rememberRecentEntity(workspaceId, { ref: item.ref, title: item.title })
    onSelect({ ref: item.ref, title: item.title })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    // IME composition (ja/ko/zh-*): Enter commits the composed text, not a row.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0))) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(items[active]) }
    else if (event.key === 'Escape') { event.preventDefault(); onCancel?.() }
  }

  const sectionLabel = (section: EntityPickerItem['section']) =>
    section === 'recent' ? t('entities.ui.picker.recent') : t('entities.ui.picker.results')
  const activeId = items[active] ? `${listId}-${active}` : undefined

  return (
    <div className={cn('flex flex-col', className)} data-entity-picker="">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search aria-hidden="true" className="size-4 text-text-muted" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('entities.ui.picker.placeholder')}
          aria-label={t('entities.ui.picker.placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          className="h-8 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-text-muted"
        />
      </div>
      <div role="group" aria-label={t('entities.ui.picker.kindFilter')} className="flex flex-wrap gap-1 px-3 py-2">
        {[null, ...ENTITY_PICKER_KIND_FILTERS].map((value) => (
          <button
            key={value ?? 'all'}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[12px] text-text-secondary hover:bg-foreground/[0.05]',
              kind === value && cn(SELECTED_TINT, 'text-foreground'),
              MOTION_FAST,
              FOCUS_RING,
            )}
          >
            {value ? entityKindLabel(t, value) : t('entities.ui.picker.allKinds')}
          </button>
        ))}
      </div>
      <ul id={listId} role="listbox" aria-label={t('entities.ui.picker.title')} className="max-h-[360px] overflow-y-auto px-1 pb-1">
        {items.length === 0 && (
          <li role="presentation" className="px-3 py-6 text-center text-[13px] text-text-muted">{t('entities.ui.picker.empty')}</li>
        )}
        {items.map((item, index) => {
          const showHeader = item.section !== 'literal' && (index === 0 || items[index - 1]!.section !== item.section)
          return (
            <React.Fragment key={`${item.section}:${formatEntityRef(item.ref)}`}>
              {showHeader && (
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {sectionLabel(item.section)}
                </li>
              )}
              <li
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                data-entity-ref={formatEntityRef(item.ref)}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => { event.preventDefault(); choose(item) }}
                className={cn('flex h-9 cursor-pointer items-center gap-2 rounded-[6px] px-3 text-[13px]', index === active && SELECTED_TINT)}
              >
                <EntityKindIcon kind={item.ref.kind} className="size-4 shrink-0 text-text-muted" />
                <span className="truncate text-foreground">
                  {item.section === 'literal' ? t('entities.ui.picker.literal', { ref: item.title }) : item.title}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-text-muted">{entityKindLabel(t, item.ref.kind)}</span>
              </li>
            </React.Fragment>
          )
        })}
      </ul>
      <p className="border-t border-border px-3 py-1.5 text-[11px] text-text-muted">{t('entities.ui.picker.hint')}</p>
    </div>
  )
}

export interface EntityPickerProps extends Omit<EntityPickerPanelProps, 'onCancel' | 'autoFocus'> {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Dialog wrapper (560 px). */
export function EntityPicker({ open, onOpenChange, onSelect, ...panel }: EntityPickerProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogTitle className="sr-only">{t('entities.ui.picker.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('entities.ui.picker.hint')}</DialogDescription>
        {open && (
          <EntityPickerPanel
            {...panel}
            autoFocus
            onCancel={() => onOpenChange(false)}
            onSelect={(hit) => { onSelect(hit); onOpenChange(false) }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { EntityRef, EntitySearchHit }
