/**
 * Settings → Import (H5). Scan is not persist. Persist writes Rox sessions.
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadCloud, RefreshCw } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner } from '@craft-agent/ui'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useActiveWorkspace } from '@/context/AppShellContext'

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

  const scan = useCallback(async () => {
    if (!workspace?.id) return
    setLoading(true)
    setError(null)
    try {
      const discovered = await window.electronAPI.foreignDiscoverSessions({ workspaceId: workspace.id })
      setEntries(discovered.entries)
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

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t('settings.import.title', { defaultValue: 'Import chats' })}
        actions={<HeaderMenu route={routes.view.settings('import')} />}
      />
      <ScrollArea className="flex-1">
        <div className="px-5 pt-6 pb-10 max-w-3xl mx-auto w-full space-y-4" data-testid="session-import">
          <p className="text-sm opacity-70">{t('settings.import.scanHint')}</p>
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
          </div>
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
              {entries.map((entry) => (
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
        </div>
      </ScrollArea>
    </div>
  )
}
