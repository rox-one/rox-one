/**
 * PrivacySettingsPage — DG-01 consent ledger, local export, remote deletion.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import type { ConsentPurpose, PrivacyDto } from '@craft-agent/shared/privacy'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'privacy',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const PURPOSE_KEYS: Array<{ purpose: ConsentPurpose; label: string; desc: string }> = [
  { purpose: 'accountRecoveryReplica', label: 'settings.privacy.recovery', desc: 'settings.privacy.recoveryDesc' },
  { purpose: 'realtimeSync', label: 'settings.privacy.realtimeSync', desc: 'settings.privacy.realtimeSyncDesc' },
  { purpose: 'aiIndexing', label: 'settings.privacy.aiIndexing', desc: 'settings.privacy.aiIndexingDesc' },
  { purpose: 'cloudInference', label: 'settings.privacy.cloudInference', desc: 'settings.privacy.cloudInferenceDesc' },
  { purpose: 'productImprovement', label: 'settings.privacy.productImprovement', desc: 'settings.privacy.productImprovementDesc' },
]

export default function PrivacySettingsPage() {
  const { t } = useTranslation()
  const [state, setState] = React.useState<PrivacyDto | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      setState(await window.electronAPI.getPrivacyState())
    } catch (error) {
      toast.error(t('settings.privacy.loadFailed', { message: errorMessage(error) }))
    }
  }, [t])

  React.useEffect(() => {
    void load()
    const off = window.electronAPI.onPrivacyChanged?.((next) => {
      setState(next)
    })
    return () => {
      off?.()
    }
  }, [load])

  const setPurpose = async (purpose: ConsentPurpose, granted: boolean) => {
    try {
      setBusy(true)
      setState(await window.electronAPI.setPrivacyPurpose({ purpose, granted }))
    } catch (error) {
      toast.error(t('settings.privacy.loadFailed', { message: errorMessage(error) }))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    try {
      setBusy(true)
      const next = await window.electronAPI.requestPrivacyExport()
      setState(next)
      toast.success(t('settings.privacy.exportDone', { path: next.exportReceipt.path }))
    } catch (error) {
      toast.error(t('settings.privacy.exportFailed', { message: errorMessage(error) }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeletion = async () => {
    try {
      setBusy(true)
      const next = await window.electronAPI.requestPrivacyDeletion()
      setState(next)
      toast.success(t('settings.privacy.deletionQueued'))
    } catch (error) {
      toast.error(t('settings.privacy.loadFailed', { message: errorMessage(error) }))
    } finally {
      setBusy(false)
    }
  }

  const recoveryOn = state?.purposes.accountRecoveryReplica === true
  const latest = state?.latestDeletion
  const deletionLabel = latest
    ? latest.status === 'completed'
      ? t('settings.privacy.deletionCompleted')
      : t('settings.privacy.deletionQueued')
    : t('settings.privacy.none')

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-4 border-b border-border/60">
        <h1 className="text-lg font-semibold">{t('settings.privacy.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.privacy.description')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <SettingsSection title={t('settings.privacy.purposes')}>
          <SettingsCard>
            <p className="px-4 pt-3 text-xs text-muted-foreground">{t('settings.privacy.legalNote')}</p>
            {PURPOSE_KEYS.map((row) => (
              <SettingsToggle
                key={row.purpose}
                label={t(row.label)}
                description={
                  row.purpose === 'realtimeSync' && !recoveryOn
                    ? t('settings.privacy.realtimeRequiresRecovery')
                    : t(row.desc)
                }
                checked={state?.purposes[row.purpose] === true}
                disabled={busy || (row.purpose === 'realtimeSync' && !recoveryOn)}
                onCheckedChange={(checked) => {
                  void setPurpose(row.purpose, checked)
                }}
              />
            ))}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('settings.privacy.requestExport')}>
          <SettingsCard>
            <SettingsRow label={t('settings.privacy.requestExport')} description={t('settings.privacy.excludedHint')}>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleExport()}>
                {t('settings.privacy.requestExport')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('settings.privacy.deleteRemote')}>
          <SettingsCard>
            <SettingsRow
              label={t('settings.privacy.deletionStatus')}
              description={t('settings.privacy.deleteRemoteDesc')}
            >
              <span className="text-sm">{deletionLabel}</span>
            </SettingsRow>
            <SettingsRow label={t('settings.privacy.localKept')} description={t('settings.privacy.localKept')}>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleDeletion()}>
                {t('settings.privacy.requestDeletion')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </div>
    </div>
  )
}
