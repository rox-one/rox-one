/**
 * Conation shell / inspector / domain client opt-in toggles (default OFF).
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  featureSkillsConationSurfacesAtom,
  featureWorkbenchConationInspectorAtom,
  featureWorkbenchConationShellAtom,
} from '@/atoms/conation-shell'
import {
  featureWorkbenchConationDssClientAtom,
  featureWorkbenchConationNotesBridgeAtom,
  featureWorkbenchConationSessionApplyAtom,
  featureWorkbenchConationSoupClientAtom,
  featureWorkbenchConationCanvasAtom,
  featureWorkbenchConationBoardAtom,
} from '@/atoms/unified-shell'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'

export function ConationShellSettings() {
  const { t } = useTranslation()
  const [shell, setShell] = useAtom(featureWorkbenchConationShellAtom)
  const [inspector, setInspector] = useAtom(featureWorkbenchConationInspectorAtom)
  const [surfacesSkill, setSurfacesSkill] = useAtom(featureSkillsConationSurfacesAtom)
  const [soupClient, setSoupClient] = useAtom(featureWorkbenchConationSoupClientAtom)
  const [notesBridge, setNotesBridge] = useAtom(featureWorkbenchConationNotesBridgeAtom)
  const [dssClient, setDssClient] = useAtom(featureWorkbenchConationDssClientAtom)
  const [sessionApply, setSessionApply] = useAtom(featureWorkbenchConationSessionApplyAtom)
  const [canvas, setCanvas] = useAtom(featureWorkbenchConationCanvasAtom)
  const [board, setBoard] = useAtom(featureWorkbenchConationBoardAtom)

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
        <SettingsToggle
          label={t('settings.appearance.conationSoupClient')}
          description={t('settings.appearance.conationSoupClientDesc')}
          checked={soupClient}
          onCheckedChange={setSoupClient}
        />
        <SettingsToggle
          label={t('settings.appearance.conationNotesBridge')}
          description={t('settings.appearance.conationNotesBridgeDesc')}
          checked={notesBridge}
          onCheckedChange={setNotesBridge}
        />
        <SettingsToggle
          label={t('settings.appearance.conationDssClient')}
          description={t('settings.appearance.conationDssClientDesc')}
          checked={dssClient}
          onCheckedChange={setDssClient}
        />
        <SettingsToggle
          label={t('settings.appearance.conationSessionApply')}
          description={`${t('settings.appearance.conationSessionApplyDesc')} ${t('settings.appearance.conationSessionApplyHonesty')}`}
          checked={sessionApply}
          onCheckedChange={setSessionApply}
        />
        <SettingsToggle
          label={t('settings.appearance.conationCanvas')}
          description={t('settings.appearance.conationCanvasDesc')}
          checked={canvas}
          onCheckedChange={setCanvas}
        />
        <SettingsToggle
          label={t('settings.appearance.conationBoard')}
          description={t('settings.appearance.conationBoardDesc')}
          checked={board}
          onCheckedChange={setBoard}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
