import * as React from 'react'
import { History, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NoteHistoryEntry, NoteHistoryRevision } from '@rox/shared/protocol'
import { Button } from '@/components/ui/button'
import { previewDiff } from './version-history-diff'

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function actorLabel(actor: string | null, t: (key: string) => string): string {
  if (!actor) return t('notes.history.unknownAuthor')
  try {
    const parsed = JSON.parse(actor) as unknown
    if (Array.isArray(parsed) && typeof parsed[1] === 'string' && parsed[1]) return parsed[1]
  } catch {
    // plain principal string
  }
  if (actor.startsWith('local-uid:')) return t('notes.history.localAuthor')
  return actor.length > 48 ? `${actor.slice(0, 45)}…` : actor
}

export function VersionHistoryPanel({
  workspaceId,
  noteId,
  currentContent,
  currentRevision,
  width,
  onRestored,
}: {
  workspaceId: string
  noteId: string
  currentContent: string
  currentRevision: string | null | undefined
  width?: number
  onRestored: (note: { content: string; revision?: string }) => void
}) {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = React.useState<NoteHistoryEntry[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<NoteHistoryRevision | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [restoring, setRestoring] = React.useState(false)
  const [confirmRestore, setConfirmRestore] = React.useState(false)

  const reload = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.electronAPI.listNoteRevisions(workspaceId, noteId)
      setEntries(list)
      if (list[0] && !selectedId) setSelectedId(list[0].revisionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, noteId, selectedId])

  React.useEffect(() => {
    setSelectedId(null)
    setPreview(null)
    setConfirmRestore(false)
    void reload()
  }, [workspaceId, noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!selectedId) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const body = await window.electronAPI.getNoteRevision(workspaceId, noteId, selectedId)
        if (!cancelled) setPreview(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId, noteId, selectedId])

  const diffRows = React.useMemo(
    () => (preview ? previewDiff(currentContent, preview.content) : []),
    [currentContent, preview],
  )

  const restore = React.useCallback(async () => {
    if (!selectedId || !currentRevision) return
    setRestoring(true)
    setError(null)
    try {
      const note = await window.electronAPI.restoreNoteRevision(
        workspaceId,
        noteId,
        selectedId,
        currentRevision,
      )
      onRestored(note)
      setConfirmRestore(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }, [selectedId, currentRevision, workspaceId, noteId, onRestored, reload])

  return (
    <aside
      className="notes-side-surface relative flex shrink-0 flex-col"
      style={{ width: width ?? 280 }}
      data-testid="notes-history-rail"
      data-glass-slot="panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold uppercase caps-label text-muted-foreground">
        <History className="icon-caption" aria-hidden />
        {t('notes.history.title')}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-border/50 px-2 py-2">
          {loading ? <p className="px-1 text-xs text-muted-foreground">{t('notes.history.loading')}</p> : null}
          {!loading && entries.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t('notes.history.empty')}</p>
          ) : null}
          {entries.map((entry) => {
            const active = entry.revisionId === selectedId
            return (
              <button
                key={entry.revisionId}
                type="button"
                data-glass-slot="row"
                data-testid="notes-history-entry"
                aria-pressed={active}
                className={`mb-1 flex w-full flex-col rounded-[var(--radius-card)] px-2.5 py-2 text-left ${
                  active ? 'bg-muted ring-1 ring-border' : 'bg-muted/40 hover:bg-muted'
                }`}
                onClick={() => { setSelectedId(entry.revisionId); setConfirmRestore(false) }}
              >
                <span className="text-sm text-foreground">{formatWhen(entry.committedAt, i18n.language)}</span>
                <span className="text-xs text-muted-foreground">
                  {actorLabel(entry.actorPrincipalId, t)} · {formatBytes(entry.byteSize)}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex min-h-[40%] flex-col overflow-hidden px-3 py-2" data-testid="notes-history-preview">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{t('notes.history.preview')}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!preview || !currentRevision || restoring}
              data-testid="notes-history-restore"
              onClick={() => setConfirmRestore(true)}
            >
              <RotateCcw className="icon-caption mr-1" aria-hidden />
              {t('notes.history.restore')}
            </Button>
          </div>
          {confirmRestore ? (
            <div className="mb-2 rounded-[var(--radius-card)] bg-muted p-2 text-xs" data-glass-slot="card">
              <p className="mb-2 text-foreground">{t('notes.history.restoreConfirm')}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={restoring} onClick={() => void restore()} data-testid="notes-history-restore-confirm">
                  {restoring ? t('notes.history.restoring') : t('notes.history.restore')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={restoring} onClick={() => setConfirmRestore(false)}>
                  {t('notes.history.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="mb-2 text-xs text-destructive" role="alert">{error}</p> : null}
          <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] bg-background p-2 font-mono text-xs leading-relaxed ring-1 ring-border">
            {!preview ? (
              <p className="text-muted-foreground">{t('notes.history.selectVersion')}</p>
            ) : (
              diffRows.map((row, index) => (
                <div
                  key={`${row.type}:${index}:${row.text.slice(0, 24)}`}
                  className={
                    row.type === 'add'
                      ? 'bg-success/15 text-success'
                      : row.type === 'del'
                        ? 'bg-destructive/15 text-destructive line-through'
                        : 'text-muted-foreground'
                  }
                >
                  <span className="mr-2 inline-block w-3 select-none opacity-60">
                    {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
                  </span>
                  {row.text || ' '}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
