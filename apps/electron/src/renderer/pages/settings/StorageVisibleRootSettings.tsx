/**
 * W1-13 (#1510): Settings → Storage → "Visible Rox folder" toggle for the
 * `storage.visible-root.v1` workbench flag (default OFF). The main process
 * persists `workbench-flags.json`; the config dir is resolved once per launch,
 * so the change applies after a restart (banner + "Restart now").
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'
import {
  storageMigrationStatusMessageKey,
  type StorageVisibleRootState,
} from '../../../shared/storage-visible-root'

export function StorageVisibleRootSettings() {
  const { t } = useTranslation()
  const [state, setState] = useState<StorageVisibleRootState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.getStorageVisibleRoot?.()
      .then((next) => { if (!cancelled) setState(next) })
      .catch(() => { /* not available (web / remote client): hide the toggle */ })
    return () => { cancelled = true }
  }, [])

  const onChange = useCallback(async (enabled: boolean) => {
    setSaving(true)
    try {
      setState(await window.electronAPI.setStorageVisibleRoot(enabled))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('storage.settings.saveFailed', { message }))
    } finally {
      setSaving(false)
    }
  }, [t])

  if (!state) return null
  // Settings only (no popup): why the toggle is ON but files stay in ~/.rox.
  const statusKey = storageMigrationStatusMessageKey(state)

  return (
    <SettingsSection title={t('storage.settings.title')} description={t('storage.settings.description')}>
      <SettingsCard>
        <SettingsToggle
          label={t('storage.settings.visibleRoot')}
          description={state.locked ? t('storage.settings.locked') : t('storage.settings.visibleRootDesc')}
          checked={state.locked ? state.activeAtLaunch : state.enabled}
          disabled={state.locked || saving}
          onCheckedChange={(checked) => { void onChange(checked) }}
        />
      </SettingsCard>
      {statusKey && (
        <div
          data-testid="storage-visible-root-last-migration"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{t(statusKey)}</span>
        </div>
      )}
      {state.restartRequired && (
        <div
          data-testid="storage-visible-root-restart"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning"
        >
          <RotateCw className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{t('storage.settings.restartRequired')}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => { void window.electronAPI.relaunchApp() }}
          >
            {t('storage.settings.restartNow')}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
