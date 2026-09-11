/**
 * Conation shell / inspector opt-in toggles (default OFF).
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  featureSkillsConationSurfacesAtom,
  featureWorkbenchConationInspectorAtom,
  featureWorkbenchConationShellAtom,
} from '@/atoms/conation-shell'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'

export function ConationShellSettings() {
  const { t } = useTranslation()
  const [shell, setShell] = useAtom(featureWorkbenchConationShellAtom)
  const [inspector, setInspector] = useAtom(featureWorkbenchConationInspectorAtom)
  const [surfacesSkill, setSurfacesSkill] = useAtom(featureSkillsConationSurfacesAtom)

  return (
    <SettingsSection
      title={t('settings.appearance.conationShell')}
      description={t('settings.appearance.conationShellDesc')}
    >
      <SettingsCard>
        <SettingsToggle
          label={t('settings.appearance.conationShellFlag')}
          description={t('settings.appearance.conationShellFlagDesc')}
          checked={shell}
          onCheckedChange={(checked) => {
            setShell(checked)
            if (!checked) setInspector(false)
          }}
        />
        <SettingsToggle
          label={t('settings.appearance.conationInspectorFlag')}
          description={t('settings.appearance.conationInspectorFlagDesc')}
          checked={inspector}
          onCheckedChange={(checked) => {
            setInspector(checked)
            if (checked) setShell(true)
          }}
        />
        <SettingsToggle
          label={t('settings.appearance.conationSurfacesSkill')}
          description={t('settings.appearance.conationSurfacesSkillDesc')}
          checked={surfacesSkill}
          onCheckedChange={setSurfacesSkill}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
