/**
 * DISPATCH C1 — «Темы Zed»: list the themes in the local Zed install and import
 * one into the ROX preset catalog. Filesystem-local (main handler); no network.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ZedThemeEntry } from '../../../shared/types'

type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'imported'; id: string }
  | { kind: 'skipped' }
  | { kind: 'failed' }

export function ZedThemesImportSection() {
  const { t } = useTranslation()
  const [themes, setThemes] = useState<ZedThemeEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (api?.getRuntimeEnvironment?.() !== 'electron' || !api?.listZedThemes) {
      setAvailable(false)
      setLoading(false)
      return
    }
    setAvailable(true)
    try {
      const entries = await api.listZedThemes()
      setThemes(entries)
      setSelected(previous => (previous && entries.some(entry => key(entry) === previous)) ? previous : entries[0] ? key(entries[0]) : null)
    } catch {
      setThemes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selectedEntry = themes.find(entry => key(entry) === selected) ?? null
  const handleImport = useCallback(async () => {
    const api = window.electronAPI
    if (!selectedEntry || !api?.importZedTheme) return
    setStatus({ kind: 'importing' })
    try {
      const result = await api.importZedTheme({ sourcePath: selectedEntry.sourcePath, name: selectedEntry.name })
      if (result.status === 'imported') {
        setStatus({ kind: 'imported', id: result.id })
        void load()
      } else if (result.status === 'skipped') {
        setStatus({ kind: 'skipped' })
      } else {
        setStatus({ kind: 'failed' })
      }
    } catch {
      setStatus({ kind: 'failed' })
    }
  }, [selectedEntry, load])

  if (!available && !loading) {
    return (
      <SettingsSection title={t('settings.appearance.zedThemes.title')} description={t('settings.appearance.zedThemes.description')}>
        <SettingsCard>
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('settings.appearance.zedThemes.unavailable')}</p>
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title={t('settings.appearance.zedThemes.title')} description={t('settings.appearance.zedThemes.description')}>
      <SettingsCard>
        {loading ? (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : themes.length === 0 ? (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('settings.appearance.zedThemes.empty')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('settings.appearance.zedThemes.title')} className="zed-themes-list">
            {themes.map(entry => {
              const id = key(entry)
              return (
                <label key={id} className={cn('zed-theme-row', selected === id && 'zed-theme-row-selected')}>
                  <input
                    type="radio"
                    name="zed-theme"
                    value={id}
                    checked={selected === id}
                    onChange={() => { setSelected(id); setStatus({ kind: 'idle' }) }}
                  />
                  <span className="zed-theme-name">{entry.name}</span>
                  <span className="zed-theme-meta">
                    {entry.appearance === 'light' ? t('settings.appearance.zedThemes.appearanceLight') : t('settings.appearance.zedThemes.appearanceDark')}
                    {entry.alreadyImported ? ` · ${t('settings.appearance.zedThemes.alreadyImported')}` : ''}
                  </span>
                </label>
              )
            })}
          </div>
        )}
        <div className="zed-theme-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!selectedEntry || status.kind === 'importing'}
            onClick={() => { void handleImport() }}
          >
            {status.kind === 'importing' ? t('settings.appearance.zedThemes.importing') : t('settings.appearance.zedThemes.import')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { void load() }}>
            {t('settings.appearance.zedThemes.refresh')}
          </Button>
        </div>
        {status.kind === 'imported' && (
          <p role="status" className="px-4 py-3 text-sm text-success">{t('settings.appearance.zedThemes.imported', { id: status.id })}</p>
        )}
        {status.kind === 'skipped' && (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('settings.appearance.zedThemes.skipped')}</p>
        )}
        {status.kind === 'failed' && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">{t('settings.appearance.zedThemes.failed')}</p>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}

/** Stable list key: one Zed name can repeat across extensions with distinct paths. */
function key(entry: ZedThemeEntry): string {
  return `${entry.sourcePath}\u0000${entry.name}`
}