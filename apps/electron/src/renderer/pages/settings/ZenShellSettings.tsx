import { useCallback, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type { ShellMaterialPreference, ZenShellSnapshot } from '../../../shared/shell-appearance'
import { readDesktopAppearance, saveDesktopAppearance } from '@/lib/desktop-appearance'

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
  const [nativeAvailable, setNativeAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const api = window.electronAPI
    if (!api?.getShellSnapshot || api.getRuntimeEnvironment?.() !== 'electron') return () => { mounted.current = false }
    let cancelled = false
    const cancelRead = readDesktopAppearance(api, () => api.getShellSnapshot(), next => {
      if (next) { setSnapshot(next); setNativeAvailable(true) }
    }, error => { setNativeAvailable(false); if (error) console.warn('Desktop shell settings unavailable:', error) })
    const unsubscribe = api.onShellChanged?.((next) => {
      if (!cancelled) { setSnapshot(next); setNativeAvailable(true) }
    })
    return () => { mounted.current = false; cancelled = true; cancelRead(); unsubscribe?.() }
  }, [])

  const persist = useCallback(async (patch: { enabled?: boolean; materialPreference?: ShellMaterialPreference }) => {
    const api = window.electronAPI
    if (!nativeAvailable || saving || api?.getRuntimeEnvironment?.() !== 'electron' || !api.setZenShell) return
    setSaving(true)
    await saveDesktopAppearance(api, () => api.setZenShell(patch), next => {
      if (next) setSnapshot(next)
    }, error => {
      setNativeAvailable(false)
      if (error) console.warn('Failed to save desktop shell settings:', error)
    }, () => !mounted.current)
    if (mounted.current) setSaving(false)
  }, [nativeAvailable, saving])

  return (
    <SettingsSection
      title={t('settings.appearance.zenShell')}
      description={t('settings.appearance.zenShellDesc')}
    >
      <SettingsCard>
        <SettingsToggle
          label={t('settings.appearance.zenShellEnable')}
          description={t('settings.appearance.zenShellEnableDesc')}
          checked={snapshot.enabled}
          onCheckedChange={(enabled) => { void persist({ enabled }) }}
          disabled={!nativeAvailable || saving}
        />
        <SettingsRow
          label={t('settings.appearance.zenShellMaterial')}
          description={t('settings.appearance.zenShellMaterialDesc')}
        >
          <SettingsMenuSelect
            value={snapshot.preference}
            onValueChange={(value) => {
              void persist({ materialPreference: value as ShellMaterialPreference })
            }}
            disabled={!nativeAvailable || saving || !snapshot.enabled}
            options={[
              { value: 'system', label: t('settings.appearance.zenShellMaterialSystem') },
              { value: 'glass', label: t('settings.appearance.zenShellMaterialGlass') },
              { value: 'opaque', label: t('settings.appearance.zenShellMaterialOpaque') },
            ]}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
