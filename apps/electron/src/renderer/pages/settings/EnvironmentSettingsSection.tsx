import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type EnvironmentPrefs,
} from '@craft-agent/shared/environment'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { EnvironmentFields } from '@/components/onboarding/EnvironmentFields'

export function EnvironmentSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<EnvironmentPrefs | null>(null)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getEnvironmentSetup) return
    const payload = await window.electronAPI.getEnvironmentSetup()
    setPrefs(payload.prefs)
  }, [])

  useEffect(() => {
    void reload()
    const off = window.electronAPI.onEnvironmentChanged?.(() => {
      void reload()
    })
    return () => off?.()
  }, [reload])

  const save = useCallback(async (patch: Partial<EnvironmentPrefs>) => {
    const next = await window.electronAPI.saveEnvironmentSetup(patch)
    setPrefs(next.prefs)
    if (patch.notifications?.status === 'answered' && typeof patch.notifications.value === 'boolean') {
      await window.electronAPI.setNotificationsEnabled(patch.notifications.value)
    }
  }, [])

  if (!prefs) return null

  return (
    <SettingsSection
      title={t('settings.environment.title')}
      description={t('settings.environment.description')}
    >
      <SettingsCard>
        <div className="p-3">
          <EnvironmentFields prefs={prefs} onChange={(patch) => void save(patch)} />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
