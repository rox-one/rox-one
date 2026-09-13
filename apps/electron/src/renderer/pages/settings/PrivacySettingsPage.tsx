/**
 * PrivacySettingsPage — DG-01 consent ledger, local export, remote deletion.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import { isClaimableLive, normalizeRox2Result } from '@craft-agent/core/rox2'
import type { ConsentPurpose, PrivacyDto } from '@craft-agent/shared/privacy'
import { settingsPageActionResult } from './settings-rox2-surface'

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
    const gate = settingsPageActionResult({
      pageId: 'privacy',
      action: 'export',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) {
      toast.error(t('settings.rox2.grantRequired'))
      return
    }
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
    const gate = settingsPageActionResult({
      pageId: 'privacy',
      action: 'remote-deletion',
      source: 'native',
      granted: true,
      deletionStatus: 'queued',
    })
    if (normalizeRox2Result(gate).code === 'settings.grant-required') {
      toast.error(t('settings.rox2.grantRequired'))
      return
    }
    try {
      setBusy(true)
      const next = await window.electronAPI.requestPrivacyDeletion()
      setState(next)
      const result = settingsPageActionResult({
        pageId: 'privacy',
        action: 'remote-deletion',
        source: 'native',
        granted: true,
        deletionStatus: next.latestDeletion?.status === 'completed' ? 'completed' : 'queued',
      })
      if (isClaimableLive(result)) {
        toast.success(t('settings.privacy.deletionCompleted'))
      } else {
        toast.message(t('settings.privacy.deletionNotLive'))
      }
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
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.privacy.title')}
        actions={<HeaderMenu route={routes.view.settings('privacy')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
            <p className="whitespace-normal break-words text-sm text-muted-foreground">
              {t('settings.privacy.description')}
            </p>
            <SettingsSection title={t('settings.privacy.purposes')}>
              <SettingsCard>
                <p className="px-4 pt-3 text-xs text-muted-foreground">{t('settings.privacy.legalNote')}</p>
                {!state ? (
                  <p className="px-4 pb-3 text-xs text-muted-foreground">{t('common.loading')}</p>
                ) : null}
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
                <SettingsRow label={t('settings.privacy.excludedHint')}>
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
                <SettingsRow label={t('settings.privacy.localKept')}>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleDeletion()}>
                    {t('settings.privacy.requestDeletion')}
                  </Button>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
