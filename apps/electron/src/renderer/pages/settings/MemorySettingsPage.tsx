/**
 * Settings → Память — graph-memory (cognee) master toggle + per-source ingest gates.
 * Defaults: graph ON; every source ON when unset.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
} from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { MemoryConfig } from '@rox/shared/memory/types'
import type { MemoryConfigPatch, GraphSourceKey } from '@rox/shared/config/storage'
import { Button } from '@/components/ui/button'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { toErrorMessage } from '@/lib/errors'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'memory',
}

const GRAPH_SOURCES: readonly GraphSourceKey[] = [
  'session',
  'notes',
  'tasks',
  'chats',
  'calls',
  'mail',
  'files',
  'lessons',
] as const

function sourceEnabled(cfg: MemoryConfig | null, key: GraphSourceKey): boolean {
  if (!cfg) return true
  return cfg.graphSources?.[key] !== false
}

export default function MemorySettingsPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<MemoryConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<{ status: string; cursor: number; total: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const activeWorkspace = useActiveWorkspace()

  const load = useCallback(() => {
    const get = window.electronAPI?.getMemoryConfig
    if (typeof get !== 'function') {
      setLoading(false)
      setError(t('settings.memory.unavailable'))
      return
    }
    setLoading(true)
    get()
      .then((c) => {
        setConfig(c)
        setError(null)
      })
      .catch((err) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const refreshImport = useCallback(() => {
    const ws = activeWorkspace?.id
    const get = window.electronAPI?.getGraphImportStatus
    if (!ws || typeof get !== 'function') return
    get(ws)
      .then((s) => setImportStatus({ status: s.status, cursor: s.cursor, total: s.total }))
      .catch(() => {})
  }, [activeWorkspace?.id])

  useEffect(() => {
    refreshImport()
  }, [refreshImport])

  const runImport = useCallback(async () => {
    const ws = activeWorkspace?.id
    const run = window.electronAPI?.runGraphImport
    if (!ws || typeof run !== 'function') {
      setError(t('settings.memory.unavailable'))
      return
    }
    setImporting(true)
    try {
      const s = await run(ws)
      setImportStatus({ status: s.status, cursor: s.cursor, total: s.total })
      setError(null)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }, [activeWorkspace?.id, t])

  const patch = useCallback(
    async (next: MemoryConfigPatch) => {
      const update = window.electronAPI?.updateMemoryConfig
      if (typeof update !== 'function') {
        setError(t('settings.memory.unavailable'))
        return
      }
      setSaving(true)
      try {
        const c = await update(next)
        setConfig(c)
        setError(null)
      } catch (err) {
        setError(toErrorMessage(err))
      } finally {
        setSaving(false)
      }
    },
    [t],
  )

  const graphOn = config?.graph !== false
  const semanticOn = config?.semantic !== false

  return (
    <div data-testid="memory-settings" className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t('settings.memory.title')} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-5">
          <p className="text-sm text-muted-foreground">{t('settings.memory.description')}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <SettingsSection title={t('settings.memory.layersTitle')} description={t('settings.memory.layersDesc')}>
            <SettingsCard>
              <SettingsToggle
                label={t('settings.memory.graph')}
                description={t('settings.memory.graphDesc')}
                checked={graphOn}
                disabled={loading || saving || !config}
                onCheckedChange={(checked) => void patch({ graph: checked })}
              />
              <SettingsToggle
                label={t('settings.memory.semantic')}
                description={t('settings.memory.semanticDesc')}
                checked={semanticOn}
                disabled={loading || saving || !config}
                onCheckedChange={(checked) => void patch({ semantic: checked })}
              />
            </SettingsCard>
          </SettingsSection>
          <SettingsSection
            title={t('settings.memory.sourcesTitle')}
            description={t('settings.memory.sourcesDesc')}
          >
            <SettingsCard>
              {GRAPH_SOURCES.map((key) => (
                <SettingsToggle
                  key={key}
                  label={t(`settings.memory.source.${key}`)}
                  description={t(`settings.memory.sourceDesc.${key}`)}
                  checked={sourceEnabled(config, key)}
                  disabled={loading || saving || !config || !graphOn}
                  onCheckedChange={(checked) =>
                    void patch({ graphSources: { [key]: checked } })
                  }
                />
              ))}
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('settings.memory.importTitle')} description={t('settings.memory.importDesc')}>
            <SettingsCard>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t('settings.memory.importStatus', {
                    status: importStatus?.status ?? 'idle',
                    cursor: importStatus?.cursor ?? 0,
                    total: importStatus?.total ?? 0,
                  })}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || importing || !graphOn || importStatus?.status === 'done'}
                  onClick={() => void runImport()}
                >
                  {importStatus?.status === 'done'
                    ? t('settings.memory.importDone')
                    : importStatus?.status === 'failed' || (importStatus && importStatus.cursor > 0)
                      ? t('settings.memory.importResume')
                      : t('settings.memory.importStart')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
