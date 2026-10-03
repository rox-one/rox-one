/**
 * Settings → Import (H5).
 *
 * Chats from supported local sources are imported automatically in the
 * background (see session-foreign-auto-import.ts); this page shows the live
 * status, the on/off switch and "import all". The manual scan → persist list
 * stays available under "Choose manually".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, DownloadCloud, RefreshCw } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner, PremiumMenuSelect } from '@rox/ui'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  FOREIGN_SESSION_KINDS,
  filterForeignIndexEntries,
  type ForeignAutoImportStatus,
  type ForeignIndexEntry,
  type ForeignSessionKind,
} from '@rox/shared/sessions'
import { isClaimableLive } from '@rox/core/rox2'
import BrowserProfileImportPanel from './BrowserProfileImportPanel'
import { settingsPageActionResult } from './settings-rox2-surface'

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
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<ScanEntry[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ForeignSessionKind | 'all'>('all')
  const [manualOpen, setManualOpen] = useState(false)
  const [auto, setAuto] = useState<ForeignAutoImportStatus | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

  const refreshAuto = useCallback(async () => {
    try {
      const next = await window.electronAPI.foreignAutoImportStatus({ workspaceId: workspace?.id })
      setAuto(next)
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : String(err))
    }
  }, [workspace?.id])

  const autoBusy = auto?.state === 'scanning' || auto?.state === 'importing'
  useEffect(() => {
    void refreshAuto()
    const timer = window.setInterval(() => void refreshAuto(), autoBusy ? 1500 : 10_000)
    return () => window.clearInterval(timer)
  }, [refreshAuto, autoBusy])

  const runAuto = useCallback(
    async (all: boolean) => {
      setAutoError(null)
      setAuto((prev) => (prev ? { ...prev, state: 'scanning' } : prev))
      try {
        setAuto(await window.electronAPI.foreignAutoImportRun({ workspaceId: workspace?.id, all }))
      } catch (err) {
        setAutoError(err instanceof Error ? err.message : String(err))
        void refreshAuto()
      }
    },
    [refreshAuto, workspace?.id],
  )

  const setAutoEnabled = useCallback(
    async (enabled: boolean) => {
      setAutoError(null)
      try {
        setAuto(await window.electronAPI.foreignAutoImportSet({ workspaceId: workspace?.id, enabled }))
      } catch (err) {
        setAutoError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspace?.id],
  )

  const autoLine = useMemo(() => {
    if (!auto) return t('settings.import.auto.loading')
    if (auto.state === 'disabled') return t('settings.import.auto.off')
    if (auto.state === 'scanning') return t('settings.import.auto.scanning')
    if (auto.state === 'importing') {
      return t('settings.import.auto.importing', { imported: auto.imported, updated: auto.updated })
    }
    if (auto.state === 'partial') {
      const cause =
        auto.partialReason === 'consent-revoked'
          ? t('settings.import.auto.partialConsentRevoked')
          : auto.partialReason === 'scan-truncated'
            ? t('settings.import.auto.partialScanTruncated')
            : t('settings.import.auto.partialSourceFailure')
      return `${t('settings.import.auto.partial', {
        imported: auto.imported,
        updated: auto.updated,
        failed: auto.failed,
        remaining: auto.remaining,
      })} ${cause}`
    }
    if (auto.state === 'error') return t('settings.import.auto.error', { error: auto.error ?? '' })
    if (!auto.lastRunAt) return t('settings.import.auto.pending')
    return t('settings.import.auto.done', {
      found: auto.found,
      total: auto.alreadyImported,
      imported: auto.imported,
      updated: auto.updated,
      time: new Date(auto.lastRunAt).toLocaleString(i18n.language),
    })
  }, [auto, i18n.language, t])

  const sourceSummary = auto
    ? Object.entries(auto.bySource)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => `${kind} ${count}`)
        .join(' · ')
    : ''

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
    const gate = settingsPageActionResult({
      pageId: 'import',
      action: 'scan',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) {
      setError(t('settings.rox2.grantRequired'))
      return
    }
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
  }, [t, workspace?.id])

  const persist = useCallback(async () => {
    if (!workspace?.id) return
    const sourcePaths = entries.filter((entry) => selected[entry.sourcePath] && !entry.skipReason).map((entry) => entry.sourcePath)
    if (sourcePaths.length === 0) return
    const gate = settingsPageActionResult({
      pageId: 'import',
      action: 'persist',
      source: 'native',
    })
    if (!isClaimableLive(gate)) {
      setError(t('settings.rox2.grantRequired'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const persisted = await window.electronAPI.foreignPersistSessions({
        workspaceId: workspace.id,
        sourcePaths,
        mode: 'skip',
      })
      void refreshAuto()
      const resultLines = persisted.results.map((row) =>
        `${row.action}${row.sessionId ? ` ${row.sessionId}` : ''}${row.reason ? ` (${row.reason})` : ''}`,
      )
      if (persisted.truncated) {
        resultLines.push(t('settings.import.batchTruncated', { omitted: persisted.omitted }))
      }
      setResults(resultLines)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [entries, refreshAuto, selected, t, workspace?.id])

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
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.import.title')}
        actions={<HeaderMenu route={routes.view.settings('import')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
      <ScrollArea className="h-full">
        <div className="px-5 pt-6 pb-24 max-w-3xl mx-auto w-full space-y-6" data-testid="session-import">
          <SettingsSection title={t('settings.import.auto.title')} description={t('settings.import.auto.description')}>
            <SettingsCard>
              <SettingsToggle
                label={t('settings.import.auto.toggle')}
                description={t('settings.import.auto.toggleHint')}
                checked={auto?.enabled ?? false}
                disabled={!auto}
                onCheckedChange={(on) => void setAutoEnabled(on)}
              />
              <SettingsRow
                label={t('settings.import.auto.status')}
                description={autoLine}
                wrapDescription
                action={
                  <div className="flex items-center gap-2" data-testid="session-import-auto">
                    {autoBusy ? <Spinner className="w-4 h-4" /> : null}
                    <Button size="sm" variant="secondary" disabled={autoBusy || !auto?.enabled} onClick={() => void runAuto(false)}>
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      {t('settings.import.auto.runNow')}
                    </Button>
                  </div>
                }
              />
              {sourceSummary ? (
                <SettingsRow label={t('settings.import.auto.sources')} description={sourceSummary} wrapDescription />
              ) : null}
              {auto && auto.remaining > 0 ? (
                <SettingsRow
                  label={t('settings.import.auto.older', { count: auto.remaining })}
                  description={t('settings.import.auto.olderHint')}
                  wrapDescription
                  action={
                    <Button size="sm" variant="secondary" disabled={autoBusy || !auto.enabled} onClick={() => void runAuto(true)}>
                      <DownloadCloud className="w-3.5 h-3.5 mr-1" />
                      {t('settings.import.auto.importAll')}
                    </Button>
                  }
                />
              ) : null}
            </SettingsCard>
            {autoError ? <div className="mt-2 text-xs text-destructive">{autoError}</div> : null}
          </SettingsSection>

          <button
            type="button"
            data-testid="session-import-manual-toggle"
            aria-expanded={manualOpen}
            aria-controls="session-import-manual"
            onClick={() => setManualOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-4 py-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {manualOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {t('settings.import.manual.title')}
          </button>
          {manualOpen ? (
          <div id="session-import-manual" className="space-y-4 rounded-xl border border-border/50 bg-background/30 p-4">
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
          </div>
          ) : null}
          <BrowserProfileImportPanel />
        </div>
      </ScrollArea>
      </div>
    </div>
  )
}
