import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type { ShellMaterialPreference, ZenShellSnapshot } from '../../../shared/shell-appearance'

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

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getShellSnapshot) return undefined
    void api.getShellSnapshot().then((next) => {
      if (next) setSnapshot(next)
    })
    return api.onShellChanged?.((next) => setSnapshot(next))
  }, [])

  const persist = useCallback(async (patch: { enabled?: boolean; materialPreference?: ShellMaterialPreference }) => {
    const api = window.electronAPI
    if (!api?.setZenShell) return
    const next = await api.setZenShell(patch)
    if (next) setSnapshot(next)
  }, [])

  const nativeAvailable = Boolean(
    typeof window.electronAPI?.getShellSnapshot === 'function'
      && typeof window.electronAPI?.setZenShell === 'function',
  )

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
          disabled={!nativeAvailable}
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
            disabled={!nativeAvailable || !snapshot.enabled}
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
