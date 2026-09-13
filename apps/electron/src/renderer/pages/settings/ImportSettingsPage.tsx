/**
 * Settings → Import (H5). Scan is not persist. Persist writes Rox sessions.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadCloud, RefreshCw } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner, PremiumMenuSelect } from '@craft-agent/ui'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  FOREIGN_SESSION_KINDS,
  filterForeignIndexEntries,
  type ForeignIndexEntry,
  type ForeignSessionKind,
} from '@craft-agent/shared/sessions'
import BrowserProfileImportPanel from './BrowserProfileImportPanel'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'import',
}

type ScanEntry = {
  id: string
  kind: string
  sourcePath: string
  title?: string
  userTurns: number
  skipReason?: string
}

export default function ImportSettingsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<ScanEntry[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ForeignSessionKind | 'all'>('all')

  const visible = useMemo(
    () =>
      filterForeignIndexEntries(entries as ForeignIndexEntry[], {
        query,
        kind: kindFilter,
      }),
    [entries, query, kindFilter],
  )
  const selectable = visible.filter((entry) => !entry.skipReason)
  const selectedCount = selectable.filter((entry) => selected[entry.sourcePath]).length

  const scan = useCallback(async () => {
    if (!workspace?.id) return
    setLoading(true)
    setError(null)
    try {
      const discovered = await window.electronAPI.foreignDiscoverSessions({ workspaceId: workspace.id })
      setEntries(discovered.entries)
      setTruncated(Boolean(discovered.truncated))
      setSelected({})
      setResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspace?.id])

  const persist = useCallback(async () => {
    if (!workspace?.id) return
    const sourcePaths = entries.filter((entry) => selected[entry.sourcePath] && !entry.skipReason).map((entry) => entry.sourcePath)
    if (sourcePaths.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const persisted = await window.electronAPI.foreignPersistSessions({
        workspaceId: workspace.id,
        sourcePaths,
        mode: 'skip',
      })
      setResults(
        persisted.results.map((row) =>
          `${row.action}${row.sessionId ? ` ${row.sessionId}` : ''}${row.reason ? ` (${row.reason})` : ''}`,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [entries, selected, workspace?.id])

  const selectVisible = (on: boolean) => {
    setSelected((prev) => {
      const next = { ...prev }
      for (const entry of selectable) {
        next[entry.sourcePath] = on
      }
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t('settings.import.title', { defaultValue: 'Import chats' })}
        actions={<HeaderMenu route={routes.view.settings('import')} />}
      />
      <ScrollArea className="flex-1">
        <div className="px-5 pt-6 pb-24 max-w-3xl mx-auto w-full space-y-4" data-testid="session-import">
          <p className="text-sm opacity-70">{t('settings.import.scanHint')}</p>
          {truncated ? (
            <p className="text-sm text-amber-600 dark:text-amber-400" data-testid="session-import-truncated">
              {t('settings.import.truncated', { count: entries.length })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void scan()}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <RefreshCw className="w-3 h-3" />
              {t('settings.import.scan')}
            </button>
            <button
              type="button"
              onClick={() => void persist()}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <DownloadCloud className="w-3 h-3" />
              {t('settings.import.persist')}
            </button>
            <button
              type="button"
              data-testid="session-import-select-all"
              onClick={() => selectVisible(true)}
              disabled={selectable.length === 0}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted disabled:opacity-50"
            >
              {t('settings.import.selectAll')}
            </button>
            <button
              type="button"
              data-testid="session-import-clear"
              onClick={() => selectVisible(false)}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted disabled:opacity-50"
            >
              {t('settings.import.clearSelection')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              data-testid="session-import-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.import.searchPlaceholder')}
              className="h-8 min-w-[180px] flex-1 rounded-md border bg-background px-2 text-sm"
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.import.filterKind')}
              <PremiumMenuSelect
                aria-label={t('settings.import.filterKind')}
                className="h-8 max-w-[200px]"
                items={[
                  { id: 'all', label: t('settings.import.filterAll') },
                  ...FOREIGN_SESSION_KINDS.map((kind) => ({ id: kind, label: kind })),
                ]}
                placeholder={t('settings.import.filterKind')}
                selectedId={kindFilter}
                onSelect={(item) => setKindFilter(item.id as ForeignSessionKind | 'all')}
              />
            </label>
          </div>
          {selectedCount > 0 ? (
            <p className="text-xs text-muted-foreground">{t('settings.import.selectedCount', { count: selectedCount })}</p>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 text-sm opacity-70">
              <Spinner className="w-4 h-4" />
            </div>
          ) : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          {entries.length === 0 && !loading ? (
            <p className="text-sm opacity-60">{t('settings.import.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((entry) => (
                <li key={entry.sourcePath} className="border rounded-md px-3 py-2 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={Boolean(entry.skipReason)}
                      checked={Boolean(selected[entry.sourcePath])}
                      onChange={(ev) =>
                        setSelected((prev) => ({ ...prev, [entry.sourcePath]: ev.target.checked }))
                      }
                    />
                    <span>
                      <span className="font-medium">{entry.title ?? entry.sourcePath}</span>
                      <span className="block text-xs opacity-60">
                        {entry.kind} · {entry.userTurns}
                        {entry.skipReason ? ` · ${entry.skipReason}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {results.length > 0 ? (
            <ul className="text-xs opacity-70 space-y-1">
              {results.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          ) : null}
          <BrowserProfileImportPanel />
        </div>
      </ScrollArea>
    </div>
  )
}
