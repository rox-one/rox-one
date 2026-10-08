import { useCallback, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type { ShellMaterialPreference, ZenShellPatch, ZenShellSnapshot } from '../../../shared/shell-appearance'
import { isRenderProfilePreference, type RenderProfilePreference } from '../../../shared/render-profile'
import { saveDesktopAppearance } from '@/lib/desktop-appearance'
import { subscribeDesktopShellAppearance } from '@/lib/shell-appearance-subscription'
import { readWebChromePreference, saveWebChromePreference, subscribeWebChromePreference } from '@/lib/web-chrome-preference'

const DEFAULT_SNAPSHOT: ZenShellSnapshot = {
  flag: 'shell.zen.v1',
  enabled: false,
  preference: 'system',
  material: 'solid',
  platform: 'web',
  fallbackReason: 'zen-disabled',
}

export function ZenShellSettings() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<ZenShellSnapshot>(DEFAULT_SNAPSHOT)
  const [webPreference, setWebPreference] = useState(readWebChromePreference)
  const [saveFailed, setSaveFailed] = useState(false)
  const [nativeAvailable, setNativeAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  const isWeb = typeof window === 'undefined' || window.electronAPI?.getRuntimeEnvironment?.() !== 'electron'

  useEffect(() => {
    mounted.current = true
    const api = window.electronAPI
    if (isWeb) {
      const unsubscribe = subscribeWebChromePreference(setWebPreference)
      return () => { mounted.current = false; unsubscribe() }
    }
    if (typeof api?.setZenShell === 'function' || typeof api?.getShellSnapshot === 'function') {
      setNativeAvailable(true)
    }
    const unsubscribe = subscribeDesktopShellAppearance(api, next => {
      setSnapshot(next); setNativeAvailable(true)
    }, error => {
      if (typeof api?.setZenShell !== 'function') setNativeAvailable(false)
      if (error) console.warn('Desktop shell settings unavailable:', error)
    })
    return () => { mounted.current = false; unsubscribe() }
  }, [isWeb])

  const persist = useCallback(async (patch: ZenShellPatch) => {
    const api = window.electronAPI
    if (saving) return
    if (isWeb) {
      setSaving(true)
      try {
        const next = saveWebChromePreference(patch)
        if (mounted.current) { setWebPreference(next); setSaveFailed(false) }
      } catch (error) {
        if (mounted.current) setSaveFailed(true)
        console.warn('Failed to save browser chrome settings:', error)
      } finally {
        if (mounted.current) setSaving(false)
      }
      return
    }
    if (!nativeAvailable || api?.getRuntimeEnvironment?.() !== 'electron' || !api.setZenShell) return
    setSaving(true)
    await saveDesktopAppearance(api, () => api.setZenShell(patch), next => {
      if (next) setSnapshot(next)
    }, error => {
      setNativeAvailable(false)
      if (error) console.warn('Failed to save desktop shell settings:', error)
    }, () => !mounted.current)
    if (mounted.current) setSaving(false)
  }, [isWeb, nativeAvailable, saving])

  const enabled = isWeb ? webPreference.enabled : snapshot.enabled
  const preference = isWeb ? webPreference.preference : snapshot.preference
  const available = isWeb || nativeAvailable
  // PERF-07: three-state so the user can return to the automatic default.
  const lowPowerPreference: RenderProfilePreference = snapshot.renderProfilePreference ?? 'auto'

  return (
    <SettingsSection
      title={t('settings.appearance.zenShell')}
      description={isWeb ? undefined : t('settings.appearance.zenShellDesc')}
    >
      <SettingsCard>
        <SettingsToggle
          label={t('settings.appearance.zenShellEnable')}
          description={isWeb ? undefined : t('settings.appearance.zenShellEnableDesc')}
          checked={enabled}
          onCheckedChange={(enabled) => { void persist({ enabled }) }}
          disabled={!available || saving}
        />
        <SettingsRow
          label={t('settings.appearance.zenShellMaterial')}
          description={t('settings.appearance.zenShellMaterialDesc')}
        >
          <SettingsMenuSelect
            value={preference}
            onValueChange={(value) => {
              void persist({ materialPreference: value as ShellMaterialPreference })
            }}
            disabled={!available || saving || !enabled}
            options={[
              { value: 'system', label: t('settings.appearance.zenShellMaterialSystem') },
              { value: 'glass', label: t('settings.appearance.zenShellMaterialGlass') },
              { value: 'opaque', label: t('settings.appearance.zenShellMaterialOpaque') },
            ]}
          />
        </SettingsRow>
        {!isWeb && (
          <SettingsRow
            label={t('settings.appearance.lowPowerMode')}
            description={t('settings.appearance.lowPowerModeDesc')}
          >
            <SettingsMenuSelect
              value={lowPowerPreference}
              onValueChange={(value) => {
                if (isRenderProfilePreference(value)) void persist({ renderProfile: value })
              }}
              disabled={!available || saving}
              options={[
                { value: 'auto', label: t('settings.appearance.lowPowerModeAuto') },
                { value: 'performance', label: t('settings.appearance.lowPowerModeOn') },
                { value: 'standard', label: t('settings.appearance.lowPowerModeOff') },
              ]}
            />
          </SettingsRow>
        )}
        {saveFailed && <p role="alert" className="px-4 py-3 text-sm text-destructive">{t('toast.failedToSaveSetting', { setting: t('settings.appearance.zenShellMaterial') })}</p>}
      </SettingsCard>
    </SettingsSection>
  )
}
