/**
 * Toggles for the extra workbench screens (`workbench.mode.<id>.v1`).
 * Off = the rail entry disappears and the route shows the «disabled» state;
 * stored screen data is kept.
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { extraScreenFlagAtoms } from '@/atoms/extra-screens'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'
import { EXTRA_SCREENS, type ExtraScreenDef } from '../extra-screens/registry'

function ScreenToggle({ screen }: { screen: ExtraScreenDef }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useAtom(extraScreenFlagAtoms[screen.id])
  return (
    <SettingsToggle
      label={t(screen.labelKey)}
      description={`${t(`extraScreens.${screen.id}.description`)} · ${screen.flag}`}
      checked={enabled}
      onCheckedChange={setEnabled}
    />
  )
}

export function ExtraScreensSettings() {
  const { t } = useTranslation()
  return (
    <SettingsSection title={t('extraScreens.settingsTitle')} description={t('extraScreens.settingsDesc')}>
      <SettingsCard>
        {EXTRA_SCREENS.map((screen) => (
          <ScreenToggle key={screen.id} screen={screen} />
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}
