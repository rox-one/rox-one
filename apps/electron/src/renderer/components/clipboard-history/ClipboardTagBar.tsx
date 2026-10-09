/**
 * Tag surfaces for Rox History: the filter chip bar (hidden classification tags
 * never appear) and the per-entry tag editor dialog used from a card.
 */
import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEntrySummary, ClipTagCount } from '@rox/shared/clipboard-history'
import { Button, Chip } from '@/components/mode-screen/ModeScreen'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { visibleEntryTags, visibleTagCounts } from './clipboard-history-model'

export function ClipboardTagBar({
  counts,
  activeTag,
  onToggle,
}: {
  counts: readonly ClipTagCount[]
  activeTag: string | null
  onToggle: (tag: string | null) => void
}) {
  const { t } = useTranslation()
  const chips = visibleTagCounts(counts)
  if (chips.length === 0 && activeTag === null) return null
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-2" data-testid="clipboard-tag-bar">
      <span className="pr-1 text-caption text-text-muted">{t('clipboard.filter.tags')}</span>
      {chips.map(({ tag, count }) => (
        <Chip key={tag} active={activeTag === tag} onClick={() => onToggle(activeTag === tag ? null : tag)}>
          #{tag} · {count}
        </Chip>
      ))}
      {activeTag !== null && !chips.some((chip) => chip.tag === activeTag) ? (
        <Chip active onClick={() => onToggle(null)}>#{activeTag}</Chip>
      ) : null}
    </div>
  )
}

export function ClipboardTagEditor({
  entry,
  open,
  onOpenChange,
  onChange,
}: {
  entry: ClipEntrySummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (tags: string[]) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState<string[]>([])
  const [value, setValue] = React.useState('')

  React.useEffect(() => {
    if (!open || !entry) return
    setDraft(visibleEntryTags(entry.tags))
    setValue('')
  }, [open, entry])

  const commit = (next: string[]) => {
    setDraft(next)
    onChange(next)
  }
  const addTag = () => {
    const tag = value.trim().toLowerCase()
    if (!tag || draft.includes(tag)) { setValue(''); return }
    setValue('')
    commit([...draft, tag])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="clipboard-tag-editor" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clipboard.action.tags')}</DialogTitle>
        </DialogHeader>
        {draft.length === 0 ? (
          <p className="text-small text-text-muted">{t('clipboard.tag.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {draft.map((tag) => (
              <li key={tag} className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-surface-pressed px-1.5 py-0.5 text-small">
                #{tag}
                <button
                  type="button"
                  aria-label={t('clipboard.tag.remove')}
                  // eslint-disable-next-line rox/prefer-primitives -- native icon button with no forwarded ref for a Radix Tooltip trigger; keep the native title for parity
                  title={t('clipboard.tag.remove')}
                  onClick={() => commit(draft.filter((item) => item !== tag))}
                  className="grid size-4 place-items-center rounded outline-none hover:bg-surface-pressed"
                >
                  <X aria-hidden className="icon-status" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }}
            placeholder={t('clipboard.tag.placeholder')}
            aria-label={t('clipboard.tag.placeholder')}
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] bg-surface-hover px-2 text-small outline-none placeholder:text-text-muted focus:bg-surface-pressed"
          />
          <Button variant="primary" onClick={addTag}>
            <Plus aria-hidden className="icon-caption" />
            {t('clipboard.tag.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}