/**
 * Rox History panel: header (title + counts), История/Избранное tabs, search,
 * kind/tag filters, the entry list with paging/prefetch, empty/error/unavailable
 * states, the quick-look modal, the tag editor and the settings dialog.
 *
 * The surface is an in-shell panel only — no floating window, blob or tray.
 */
import * as React from 'react'
import { RefreshCw, Search, Settings, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEntrySummary } from '@rox/shared/clipboard-history'
import { Button, Chip, EmptyState, Tabs } from '@/components/mode-screen/ModeScreen'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePanelKeyboardGuard } from '@/lib/usePanelKeyboardGuard'
import { formatHotkeyDisplay } from '@/lib/platform'
import { cn } from '@/lib/utils'
import {
  type ClipFormatFilter,
  emptyStateKind,
  formatKeysHint,
  hasActiveFilters,
  mapClipboardKey,
  moveSelection,
  type ClipboardKeyAction,
} from './clipboard-history-model'
import { ClipboardCard } from './ClipboardCard'
import { ClipboardQuickLook } from './ClipboardQuickLook'
import { ClipboardHistorySettings } from './ClipboardHistorySettings'
import { ClipboardTagBar, ClipboardTagEditor } from './ClipboardTagBar'
import { useClipboardHistory } from './use-clipboard-history'

const INPUT = 'h-7 rounded-[var(--radius-card)] bg-foreground/[0.05] px-2 text-sm outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]'
const KINDS = ['all', 'text', 'image'] as const
const FORMATS: ReadonlyArray<{ value: ClipFormatFilter; label: string }> = [
  { value: 'all', label: 'clipboard.filter.formatAll' },
  { value: 'png', label: 'PNG' },
  { value: 'gif', label: 'GIF' },
  { value: 'jpg', label: 'JPG' },
]

export function ClipboardHistoryPanel() {
  const { t } = useTranslation()
  const h = useClipboardHistory()
  const canHandleKeyboard = usePanelKeyboardGuard()
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  const [tagsEntry, setTagsEntry] = React.useState<ClipEntrySummary | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [clearOpen, setClearOpen] = React.useState(false)
  const [deleteTargetId, setDeleteTargetId] = React.useState<number | null>(null)

  const overlayOpen = h.quickLookId !== null || settingsOpen || clearOpen || tagsEntry !== null || deleteTargetId !== null
  const selectedEntry = h.entries.find((entry) => entry.id === h.selectedId) ?? null

  const runAction = React.useCallback((action: ClipboardKeyAction) => {
    switch (action) {
      case 'focus-search':
        searchRef.current?.focus()
        break
      case 'clear-search':
        h.dispatch({ type: 'query', query: '' })
        break
      case 'close-overlay':
        h.closeQuickLook()
        setSettingsOpen(false)
        setClearOpen(false)
        setTagsEntry(null)
        setDeleteTargetId(null)
        break
      case 'select-next':
      case 'select-prev': {
        const index = h.entries.findIndex((entry) => entry.id === h.selectedId)
        const next = moveSelection(index, action === 'select-next' ? 1 : -1, h.entries.length)
        if (next >= 0) h.setSelectedId(h.entries[next]!.id)
        break
      }
      case 'copy':
        if (h.selectedId !== null) h.copy(h.selectedId)
        break
      case 'quick-look':
        if (h.selectedId !== null) h.openQuickLook(h.selectedId)
        break
      case 'delete':
        if (h.selectedId !== null) setDeleteTargetId(h.selectedId)
        break
      case 'star':
        if (selectedEntry) h.toggleStar(selectedEntry)
        break
    }
  }, [h, selectedEntry])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !canHandleKeyboard(event.target)) return
      const target = event.target
      const inField = target instanceof Element
        && target.closest('input, textarea, select, [contenteditable="true"]') !== null
      const action = mapClipboardKey(
        event.key,
        { metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey },
        {
          overlayOpen,
          hasQuery: h.filters.query !== '',
          hasSelection: h.selectedId !== null,
          inField,
        },
      )
      if (!action) return
      event.preventDefault()
      runAction(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Prefetch the next page shortly before the sentinel scrolls into view.
  React.useEffect(() => {
    const node = sentinelRef.current
    if (!node || !h.hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (records) => { if (records.some((record) => record.isIntersecting)) h.loadMore() },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [h.hasMore, h.loadMore, h.entries.length])

  const counts = [
    t('clipboard.counts.total', { count: h.total }),
    t('clipboard.counts.starred', { count: h.counts.starred }),
  ].join(' · ')
  const isEmpty = !h.loading && h.entries.length === 0
  const kind = emptyStateKind(h.filters)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="clipboard-history-panel">
      <header className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-2 px-3 pt-2">
        <h2 className="text-title-sm font-semibold">{t('clipboard.title')}</h2>
        <span className="min-w-0 truncate text-small text-text-muted" data-testid="clipboard-counts">{counts}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
          <Button variant="ghost" className="px-2" aria-label={t('clipboard.action.refresh')} title={t('clipboard.action.refresh')} data-testid="clipboard-refresh" onClick={h.refresh}>
            <RefreshCw aria-hidden className={cn('icon-caption', h.loading && 'animate-spin')} />
          </Button>
          {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
          <Button variant="ghost" className="px-2" aria-label={t('clipboard.action.settings')} title={t('clipboard.action.settings')} data-testid="clipboard-settings-button" onClick={() => setSettingsOpen(true)}>
            <Settings aria-hidden className="icon-caption" />
          </Button>
          {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
          <Button variant="ghost" className="px-2" aria-label={t('clipboard.action.clearAll')} title={t('clipboard.action.clearAll')} data-testid="clipboard-clear-button" onClick={() => setClearOpen(true)}>
            <Trash2 aria-hidden className="icon-caption" />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2 px-3 pb-2">
        <div className="flex items-center gap-2">
          <Tabs
            label={t('clipboard.title')}
            value={h.filters.tab}
            onChange={(tab) => h.dispatch({ type: 'tab', tab })}
            tabs={[
              { id: 'history', label: t('clipboard.tab.history'), count: h.counts.total },
              { id: 'starred', label: t('clipboard.tab.starred'), count: h.counts.starred },
            ]}
          />
        </div>
        <label className="relative flex min-w-0 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 icon-caption text-text-muted" />
          <input
            ref={searchRef}
            value={h.filters.query}
            onChange={(event) => h.dispatch({ type: 'query', query: event.target.value })}
            placeholder={t('clipboard.search.placeholder')}
            aria-label={t('clipboard.search.placeholder')}
            data-testid="clipboard-search"
            className={cn(INPUT, 'w-full pl-7 pr-7')}
          />
          {h.filters.query !== '' ? (
            <button
              type="button"
              aria-label={t('clipboard.search.clear')}
              // eslint-disable-next-line rox/prefer-primitives -- native icon button with no forwarded ref for a Radix Tooltip trigger; keep the native title for parity
              title={t('clipboard.search.clear')}
              data-testid="clipboard-search-clear"
              onClick={() => h.dispatch({ type: 'query', query: '' })}
              className="absolute right-1 grid size-5 place-items-center rounded-[var(--radius-control)] text-text-muted outline-none hover:text-foreground"
            >
              <X aria-hidden className="icon-caption" />
            </button>
          ) : null}
        </label>
        <div className="flex flex-wrap items-center gap-1" data-testid="clipboard-kind-filter">
          {KINDS.map((option) => (
            <Chip key={option} active={h.filters.kind === option} onClick={() => h.dispatch({ type: 'kind', kind: option })}>
              {t(`clipboard.filter.${option}`)}
            </Chip>
          ))}
          {hasActiveFilters(h.filters) ? (
            <button
              type="button"
              data-testid="clipboard-filter-reset"
              onClick={() => h.dispatch({ type: 'reset' })}
              className="ml-auto text-caption text-text-muted underline-offset-2 outline-none hover:text-foreground hover:underline"
            >
              {t('clipboard.filter.reset')}
            </button>
          ) : null}
        </div>
        {h.counts.image > 0 ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('clipboard.filter.format')} data-testid="clipboard-format-filter">
            {FORMATS.map((option) => (
              <Chip key={option.value} active={h.filters.format === option.value} onClick={() => h.dispatch({ type: 'format', format: option.value })}>
                {option.value === 'all' ? t(option.label) : option.label}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <ClipboardTagBar
        counts={h.tagCounts}
        activeTag={h.filters.tag}
        onToggle={(tag) => h.dispatch({ type: 'tag', tag })}
      />

      {h.error ? (
        <div role="alert" title={h.error} className="mx-3 mb-1 rounded-[var(--radius-control)] bg-destructive/10 px-2 py-1 text-small text-destructive" data-testid="clipboard-error">
          {t('clipboard.error')}
        </div>
      ) : null}

      <div data-testid="clipboard-list" className="min-h-0 flex-1 overflow-y-auto pb-3">
        {h.unavailable ? (
          <EmptyState title={t('clipboard.unavailable')} testId="clipboard-unavailable" />
        ) : h.loading && h.entries.length === 0 ? (
          <div className="px-4 py-6 text-small text-text-muted" role="status" data-testid="clipboard-loading">
            {t('clipboard.title')}…
          </div>
        ) : isEmpty ? (
          <EmptyState
            testId="clipboard-empty"
            title={kind === 'search' ? t('clipboard.empty.search') : t('clipboard.empty.title')}
            body={kind === 'search' ? t('clipboard.empty.searchBody') : t('clipboard.empty.body')}
          />
        ) : (
          <div role="list" aria-label={t('clipboard.a11y.list')}>
            {h.entries.map((entry) => (
              <ClipboardCard
                key={entry.id}
                entry={entry}
                selected={entry.id === h.selectedId}
                now={h.now}
                onSelect={h.setSelectedId}
                onCopy={h.copy}
                onToggleStar={h.toggleStar}
                onDelete={setDeleteTargetId}
                onPreview={h.openQuickLook}
                onEditTags={setTagsEntry}
              />
            ))}
          </div>
        )}
        {h.hasMore && !h.unavailable ? <div ref={sentinelRef} className="h-8" aria-hidden data-testid="clipboard-sentinel" /> : null}
      </div>

      <p className="shrink-0 px-3 py-1 text-caption text-text-muted" data-testid="clipboard-keys-hint">
        {formatKeysHint(t, formatHotkeyDisplay('mod+f'))}
      </p>

      <ClipboardQuickLook
        entry={selectedForOverlay(h.entries, h.quickLookId)}
        detail={h.detail}
        loading={h.quickLookLoading}
        now={h.now}
        onClose={h.closeQuickLook}
        onCopy={h.copy}
        onToggleStar={h.toggleStar}
        onEditTags={setTagsEntry}
      />

      <ClipboardTagEditor
        entry={tagsEntry}
        open={tagsEntry !== null}
        onOpenChange={(open) => { if (!open) setTagsEntry(null) }}
        onChange={(tags) => { if (tagsEntry) h.setTags(tagsEntry.id, tags) }}
      />

      <ClipboardHistorySettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={h.settings}
        saving={h.savingSettings}
        onSave={h.updateSettings}
      />

      <Dialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}>
        <DialogContent data-testid="clipboard-delete-dialog" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('clipboard.action.delete')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" data-testid="clipboard-delete-confirm" onClick={() => { if (deleteTargetId !== null) h.remove(deleteTargetId); setDeleteTargetId(null) }}>
              {t('clipboard.action.delete')}
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setDeleteTargetId(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent data-testid="clipboard-clear-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('clipboard.action.clearAll')}</DialogTitle>
          </DialogHeader>
          <p className="text-small text-text-muted" data-testid="clipboard-clear-body">{t('clipboard.clear.body')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" data-testid="clipboard-clear-all" onClick={() => { h.clear(false); setClearOpen(false) }}>
              {t('clipboard.action.clearAll')}
            </Button>
            <Button variant="secondary" data-testid="clipboard-clear-unstarred" onClick={() => { h.clear(true); setClearOpen(false) }}>
              {t('clipboard.action.clearUnstarred')}
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setClearOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The quick-look entry is resolved from the loaded page by id. */
function selectedForOverlay(entries: ClipEntrySummary[], id: number | null): ClipEntrySummary | null {
  if (id === null) return null
  return entries.find((entry) => entry.id === id) ?? null
}