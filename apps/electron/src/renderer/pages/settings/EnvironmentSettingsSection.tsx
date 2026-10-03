import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type EnvironmentPrefs,
} from '@rox/shared/environment'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { EnvironmentFields } from '@/components/onboarding/EnvironmentFields'
import { createDesktopSettingsSession } from './desktop-settings-session'

export function EnvironmentSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<EnvironmentPrefs | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const session = useRef<ReturnType<typeof createDesktopSettingsSession<EnvironmentPrefs>> | null>(null)

  useEffect(() => {
    const current = createDesktopSettingsSession<EnvironmentPrefs>(window.electronAPI,
      value => { setPrefs(value); setState('ready') },
      error => { setState(error ? 'error' : 'unavailable') })
    session.current = current
    const reload = () => { void current.run(async () => (await window.electronAPI.getEnvironmentSetup()).prefs) }
    reload()
    current.subscribe(onChange => window.electronAPI.onEnvironmentChanged?.(onChange), reload)
    return () => { current.dispose(); if (session.current === current) session.current = null }
  }, [])

  const save = useCallback(async (patch: Partial<EnvironmentPrefs>) => {
    if (state !== 'ready') return
    await session.current?.run(async isCurrent => {
      const next = await window.electronAPI.saveEnvironmentSetup(patch)
      if (isCurrent() && patch.notifications?.status === 'answered' && typeof patch.notifications.value === 'boolean') {
        await window.electronAPI.setNotificationsEnabled(patch.notifications.value)
      }
      return next.prefs
    })
  }, [state])

  return (
    <SettingsSection
      title={t('settings.environment.title')}
      description={t('settings.environment.description')}
    >
      <SettingsCard>
        <div className="p-3">
          {state === 'ready' && prefs ? (
            <EnvironmentFields prefs={prefs} onChange={(patch) => void save(patch)} />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {state === 'loading' ? t('common.loading') : state === 'error' ? t('common.errorLoadingContent') : t('common.unavailable')}
            </p>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
