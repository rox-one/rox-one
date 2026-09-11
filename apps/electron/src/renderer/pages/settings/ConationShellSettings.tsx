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
          label={t('settings.appearance.conationSoupClient', 'Soup client')}
          description={t(
            'settings.appearance.conationSoupClientDesc',
            'Read-only Conation Soup GraphQL client (workbench.conation.soupClient). Default off.',
          )}
          checked={soupClient}
          onCheckedChange={setSoupClient}
        />
        <SettingsToggle
          label={t('settings.appearance.conationNotesBridge', 'Notes bridge')}
          description={t(
            'settings.appearance.conationNotesBridgeDesc',
            'Read-only Conation Notes bridge (workbench.conation.notesBridge). Default off.',
          )}
          checked={notesBridge}
          onCheckedChange={setNotesBridge}
        />
        <SettingsToggle
          label={t('settings.appearance.conationDssClient', 'DSS client')}
          description={t(
            'settings.appearance.conationDssClientDesc',
            'Read-only Conation DSS/Drive HTTP client (workbench.conation.dssClient). Default off.',
          )}
          checked={dssClient}
          onCheckedChange={setDssClient}
        />
        <SettingsToggle
          label={t('settings.appearance.conationSessionApply', 'SessionApply (Conation)')}
          description={t(
            'settings.appearance.conationSessionApplyDesc',
            'SessionApply consumer stub linked to AgentTeamsStore (workbench.conation.sessionApply). Default off. Not Cordis.',
          )}
          checked={sessionApply}
          onCheckedChange={setSessionApply}
        />
        <SettingsToggle
          label={t('settings.appearance.conationCanvas', 'Fund canvas deep-link')}
          description={t(
            'settings.appearance.conationCanvasDesc',
            'Open Fund canvas on Conation via deep-link (workbench.conation.canvas). Default off. No live in-pane until Perf.',
          )}
          checked={canvas}
          onCheckedChange={setCanvas}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
