import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { seAutoHideSidebarsAtom, seEditorZoomPercentAtom, seLeftSidebarLayoutAtom } from '@/atoms/workbench-layout'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'

export function SuperEngineeringAppearanceSettings() {
  const { t } = useTranslation()
  const se = useSuperEngineeringProfile()
  const [layout, setLayout] = useAtom(seLeftSidebarLayoutAtom)
  const [autoHide, setAutoHide] = useAtom(seAutoHideSidebarsAtom)
  const [editorZoom, setEditorZoom] = useAtom(seEditorZoomPercentAtom)

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
        <SettingsRow
          label={t('settings.appearance.seEditorZoom')}
          description={t('settings.appearance.seEditorZoomDesc')}
        >
          <input
            type="range"
            min={80}
            max={140}
            step={5}
            value={editorZoom}
            onChange={(e) => setEditorZoom(Number(e.target.value))}
            aria-label={t('settings.appearance.seEditorZoom')}
            className="w-full max-w-[200px]"
          />
          <span className="text-xs text-muted-foreground tabular-nums">{editorZoom}%</span>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
