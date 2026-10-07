import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { seAutoHideSidebarsAtom, seLeftSidebarLayoutAtom } from '@/atoms/workbench-layout'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'

export function SuperEngineeringAppearanceSettings() {
  const { t } = useTranslation()
  const se = useSuperEngineeringProfile()
  const [layout, setLayout] = useAtom(seLeftSidebarLayoutAtom)
  const [autoHide, setAutoHide] = useAtom(seAutoHideSidebarsAtom)

  if (!se) return null

  return (
    <SettingsSection
      title={t('settings.appearance.seProfile')}
      description={t('settings.appearance.seProfileDesc')}
      data-testid="se-appearance-settings"
    >
      <SettingsCard>
        <SettingsRow label={t('settings.appearance.seLeftSidebarLayout')} description={t('settings.appearance.seLeftSidebarLayoutDesc')}>
          <SettingsMenuSelect
            value={layout}
            onValueChange={(value) => setLayout(value as 'compact' | 'detailed')}
            options={[
              { value: 'compact', label: t('settings.appearance.seLayoutCompact') },
              { value: 'detailed', label: t('settings.appearance.seLayoutDetailed') },
            ]}
          />
        </SettingsRow>
        <SettingsToggle
          label={t('settings.appearance.seAutoHideSidebars')}
          description={t('settings.appearance.seAutoHideSidebarsDesc')}
          checked={autoHide}
          onCheckedChange={setAutoHide}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
