/**
 * Память → Репозиторий → ⌘K-поиск.
 *
 * One overlay, three groups, no new channels:
 *   • Файлы репозитория — instant client-side filter over the already loaded
 *     tree paths (substring, case-insensitive). Capped at `RESULT_CAP` rows,
 *     with the real total shown in the group header (`N`, no silent hiding).
 *   • Заметки — `notes:search` (`searchNotes`), debounced ~200 ms.
 *   • Сообщения — `sessions:searchContent` (`searchSessionContent`), same
 *     debounce.
 *
 * Notes/sessions queries share one request generation: when the query changes
 * while a request is in flight, the older response is dropped, so an
 * out-of-order resolve can never clobber newer results.
 *
 * Opens on ⌘K / Ctrl-K while mounted, Esc closes, ↑/↓ navigate, Enter opens
 * the highlighted row through the callbacks supplied by the shell.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Loader2, MessageSquare, Search, StickyNote } from 'lucide-react'
import type { MemoryRepoTreeNode } from '@rox/shared/memory/repo'
import type { NoteSummary, SessionSearchResult } from '../../../../shared/types'
import { cn } from '@/lib/utils'
import { formatHotkeyDisplay } from '@/lib/platform'

export interface MemoryRepoSearchOverlayProps {
  workspaceId?: string
  tree: MemoryRepoTreeNode[]
  onOpenFile(path: string): void
  onOpenNote?(noteId: string): void
  onOpenSession?(sessionId: string): void
}

/** Rows shown per group; the header still reports the true total. */
export const RESULT_CAP = 8
/** Debounce before a notes/sessions channel request leaves the renderer. */
export const SEARCH_DEBOUNCE_MS = 200

type GroupStatus = 'idle' | 'loading' | 'done' | 'error'

interface GroupState<T> {
  status: GroupStatus
  items: T[]
}

type ResultRow =
  | { kind: 'file'; path: string; node: MemoryRepoTreeNode }
  | { kind: 'note'; note: NoteSummary }
  | { kind: 'session'; session: SessionSearchResult }

function filterFiles(tree: MemoryRepoTreeNode[], query: string): MemoryRepoTreeNode[] {
  if (!query) return []
  return tree.filter((node) => node.type === 'file' && node.path.toLowerCase().includes(query))
}

export function MemoryRepoSearchOverlay({
  workspaceId,
  tree,
  onOpenFile,
  onOpenNote,
  onOpenSession,
}: MemoryRepoSearchOverlayProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const [notes, setNotes] = React.useState<GroupState<NoteSummary>>({ status: 'idle', items: [] })
  const [sessions, setSessions] = React.useState<GroupState<SessionSearchResult>>({ status: 'idle', items: [] })

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const requestGeneration = React.useRef(0)

  const trimmed = query.trim()
  const normalised = trimmed.toLowerCase()
  const fileMatches = React.useMemo(() => filterFiles(tree, normalised), [tree, normalised])

  // Global ⌘K / Ctrl-K while the repository screen is mounted.
  React.useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [])

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Debounced notes + sessions search with a shared generation guard so a
  // slow older response never overwrites a newer one.
  React.useEffect(() => {
    if (!open) return
    if (!trimmed || !workspaceId) {
      setNotes({ status: 'idle', items: [] })
      setSessions({ status: 'idle', items: [] })
      return
    }
    const canSearchNotes = typeof window.electronAPI.searchNotes === 'function'
    const canSearchSessions = typeof window.electronAPI.searchSessionContent === 'function'
    setNotes({ status: canSearchNotes ? 'loading' : 'error', items: [] })
    setSessions({ status: canSearchSessions ? 'loading' : 'error', items: [] })
    const generation = ++requestGeneration.current
    const timer = window.setTimeout(() => {
      if (canSearchNotes) {
        window.electronAPI.searchNotes(workspaceId, trimmed).then(
          (items) => { if (generation === requestGeneration.current) setNotes({ status: 'done', items }) },
          () => { if (generation === requestGeneration.current) setNotes({ status: 'error', items: [] }) },
        )
      }
      if (canSearchSessions) {
        window.electronAPI.searchSessionContent(workspaceId, trimmed).then(
          (items) => { if (generation === requestGeneration.current) setSessions({ status: 'done', items }) },
          () => { if (generation === requestGeneration.current) setSessions({ status: 'error', items: [] }) },
        )
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer) }
  }, [open, trimmed, workspaceId])

  const close = React.useCallback(() => {
    requestGeneration.current++
    setOpen(false)
    setQuery('')
    setNotes({ status: 'idle', items: [] })
    setSessions({ status: 'idle', items: [] })
    setActive(0)
  }, [])

  const openRow = React.useCallback((row: ResultRow) => {
    if (row.kind === 'file') {
      onOpenFile(row.path)
    } else if (row.kind === 'note') {
      if (onOpenNote) onOpenNote(row.note.id)
      else return
    } else if (onOpenSession) {
      onOpenSession(row.session.sessionId)
    } else {
      return
    }
    close()
  }, [close, onOpenFile, onOpenNote, onOpenSession])

  const visibleNotes = notes.items.slice(0, RESULT_CAP)
  const visibleSessions = sessions.items.slice(0, RESULT_CAP)
  const visibleFiles = fileMatches.slice(0, RESULT_CAP)

  const rows: ResultRow[] = [
    ...visibleFiles.map((node): ResultRow => ({ kind: 'file', path: node.path, node })),
    ...visibleNotes.map((note): ResultRow => ({ kind: 'note', note })),
    ...visibleSessions.map((session): ResultRow => ({ kind: 'session', session })),
  ]

  // Reset the highlight whenever the result set changes shape.
  const resultKey = `${trimmed}|${visibleFiles.length}|${notes.items.length}|${sessions.items.length}|${notes.status}|${sessions.status}`
  React.useEffect(() => { setActive(0) }, [resultKey])

  if (!open) return null

  const loading = notes.status === 'loading' || sessions.status === 'loading'
  const searchError = notes.status === 'error' || sessions.status === 'error'
  const hasAnyResult = fileMatches.length + notes.items.length + sessions.items.length > 0
  const showNothingFound = trimmed.length > 0 && !loading && !searchError && !hasAnyResult

  const move = (delta: number) => {
    if (rows.length === 0) return
    setActive((current) => (current + delta + rows.length) % rows.length)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[active]
      if (row) openRow(row)
    }
  }

  const groupHeader = (testId: string, label: string, shown: number, total: number) => (
    <div data-testid={testId} className="flex items-center gap-2 px-3 pb-1 pt-3 text-caption font-semibold uppercase caps-label text-text-muted">
      <span>{label}</span>
      {total > 0 ? <span className="numeric font-normal">({total > shown ? `${total}` : total})</span> : null}
    </div>
  )

  const renderRow = (row: ResultRow, index: number) => {
    const isActive = index === active
    const testId = `memory-repo-search-result-${index}`
    if (row.kind === 'file') {
      return (
        <button
          key={testId}
          type="button"
          role="option"
          aria-selected={isActive}
          data-testid={testId}
          data-kind="file"
          onMouseEnter={() => setActive(index)}
          onClick={() => openRow(row)}
          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-small', isActive ? 'bg-surface-pressed' : 'hover:bg-surface-hover')}
        >
          <FileText aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono" title={row.path}>{row.path}</span>
          {row.node.badges?.map((badge) => (
            <span key={badge} className="shrink-0 rounded-[var(--radius-control)] border border-border-subtle px-1 text-caption text-text-muted">{t(`memory.repo.file.badge${badge === 'edited' ? 'Edited' : 'Dreamed'}`)}</span>
          ))}
        </button>
      )
    }
    if (row.kind === 'note') {
      const label = (
        <>
          <span className="min-w-0 flex-1 truncate" title={row.note.title}>{row.note.title}</span>
          <span className="shrink-0 truncate font-mono text-caption text-text-muted" title={row.note.path}>{row.note.path}</span>
        </>
      )
      return onOpenNote ? (
        <button
          key={testId}
          type="button"
          role="option"
          aria-selected={isActive}
          data-testid={testId}
          data-kind="note"
          onMouseEnter={() => setActive(index)}
          onClick={() => openRow(row)}
          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-small', isActive ? 'bg-surface-pressed' : 'hover:bg-surface-hover')}
        >
          <StickyNote aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
          {label}
        </button>
      ) : (
        <div key={testId} data-testid={testId} data-kind="note" className="flex select-text items-center gap-2 px-3 py-1.5 text-small">
          <StickyNote aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
          {label}
        </div>
      )
    }
    const snippet = row.session.matches[0]?.snippet
    const sessionLabel = (
      <>
        <span className="shrink-0 truncate font-mono" title={row.session.sessionId}>{row.session.sessionId}</span>
        <span className="shrink-0 text-caption text-text-muted numeric">×{row.session.matchCount}</span>
        {snippet ? <span className="min-w-0 flex-1 truncate text-text-muted">{snippet}</span> : null}
      </>
    )
    return onOpenSession ? (
      <button
        key={testId}
        type="button"
        role="option"
        aria-selected={isActive}
        data-testid={testId}
        data-kind="session"
        onMouseEnter={() => setActive(index)}
        onClick={() => openRow(row)}
        className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-small', isActive ? 'bg-surface-pressed' : 'hover:bg-surface-hover')}
      >
        <MessageSquare aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
        {sessionLabel}
      </button>
    ) : (
      <div key={testId} data-testid={testId} data-kind="session" className="flex select-text items-center gap-2 px-3 py-1.5 text-small">
        <MessageSquare aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
        {sessionLabel}
      </div>
    )
  }

  return (
    // eslint-disable-next-line rox/prefer-primitives -- inline ⌘K palette: it mounts inside its host and owns ↑/↓/Enter/Esc; a portaled Dialog/Sheet would move the DOM out of the mount container the overlay suite queries and add a focus trap this keyboard-first palette does not use
    <div className="fixed inset-0 z-modal flex justify-center bg-black/30 pt-[10vh]" role="dialog" aria-modal="true" aria-label={t('memory.repo.search.placeholder')} data-testid="memory-repo-search" onKeyDown={onKeyDown}>
      <div className="absolute inset-0" onClick={close} aria-hidden="true" />
      <div className="relative m-0 h-fit w-[min(640px,92vw)] overflow-hidden rounded-[var(--radius-control)] border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border/60 px-3">
          <Search aria-hidden="true" className="icon-toolbar shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            data-testid="memory-repo-search-input"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('memory.repo.search.placeholder')}
            className="h-10 min-w-0 flex-1 bg-transparent text-body outline-none"
          />
        </div>

        <div role="listbox" className="max-h-[55vh] overflow-y-auto pb-2">
          {!trimmed ? (
            <div data-testid="memory-repo-search-hint" className="px-3 py-4 text-small text-text-muted">
              {t('memory.repo.search.hint', { shortcut: formatHotkeyDisplay('mod+k') })}
            </div>
          ) : (
            <>
              {fileMatches.length > 0 ? (
                <div data-testid="memory-repo-search-group-files">
                  {groupHeader('memory-repo-search-group-files-header', t('memory.repo.search.groupFiles'), visibleFiles.length, fileMatches.length)}
                  {rows.slice(0, visibleFiles.length).map((row, index) => renderRow(row, index))}
                </div>
              ) : null}

              {notes.status === 'loading' ? (
                <div data-testid="memory-repo-search-loading-notes" className="flex items-center gap-2 px-3 py-1.5 text-small text-text-muted">
                  <Loader2 aria-hidden="true" className="icon-caption animate-spin" />{t('memory.repo.state.loading')}
                </div>
              ) : null}
              {notes.status === 'error' ? (
                <div role="alert" data-testid="memory-repo-search-error-notes" className="px-3 py-1.5 text-small text-destructive">
                  {t('memory.repo.search.error')}
                </div>
              ) : null}
              {notes.items.length > 0 ? (
                <div data-testid="memory-repo-search-group-notes">
                  {groupHeader('memory-repo-search-group-notes-header', t('memory.repo.search.groupNotes'), visibleNotes.length, notes.items.length)}
                  {rows.slice(visibleFiles.length, visibleFiles.length + visibleNotes.length).map((row, index) => renderRow(row, visibleFiles.length + index))}
                </div>
              ) : null}

              {sessions.status === 'loading' ? (
                <div data-testid="memory-repo-search-loading-sessions" className="flex items-center gap-2 px-3 py-1.5 text-small text-text-muted">
                  <Loader2 aria-hidden="true" className="icon-caption animate-spin" />{t('memory.repo.state.loading')}
                </div>
              ) : null}
              {sessions.status === 'error' ? (
                <div role="alert" data-testid="memory-repo-search-error-sessions" className="px-3 py-1.5 text-small text-destructive">
                  {t('memory.repo.search.error')}
                </div>
              ) : null}
              {sessions.items.length > 0 ? (
                <div data-testid="memory-repo-search-group-sessions">
                  {groupHeader('memory-repo-search-group-sessions-header', t('memory.repo.search.groupSessions'), visibleSessions.length, sessions.items.length)}
                  {rows.slice(visibleFiles.length + visibleNotes.length).map((row, index) => renderRow(row, visibleFiles.length + visibleNotes.length + index))}
                </div>
              ) : null}

              {showNothingFound ? (
                <div data-testid="memory-repo-search-empty" className="px-3 py-4 text-small text-text-muted">
                  {t('memory.repo.search.empty')}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}