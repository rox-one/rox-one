/**
 * Experimental workbench chrome flags (ADR-0001). Renderer-only localStorage
 * via jotai; all default OFF so W1 behavior is unchanged until toggled.
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  featureUnifiedShellAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchHarnessAgentIntelV1Atom,
  featureWorkbenchHarnessChatChromeV1Atom,
  featureWorkbenchHarnessExtCenterV1Atom,
  featureWorkbenchHarnessAgentTeamsAtom,
  featureWorkbenchHarnessInspectorV1Atom,
  featureWorkbenchModeRegistryV1Atom,
  featureWorkbenchStatusBarV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
} from '@/atoms/unified-shell'
import { HARNESS_SKIP_LIST } from '@craft-agent/core/platform'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings'

export function WorkbenchChromeSettings() {
  const { t } = useTranslation()
  const [unifiedShell, setUnifiedShell] = useAtom(featureUnifiedShellAtom)
  const [modeRegistry, setModeRegistry] = useAtom(featureWorkbenchModeRegistryV1Atom)
  const [topChrome, setTopChrome] = useAtom(featureWorkbenchTopChromeV2Atom)
  const [tabGroups, setTabGroups] = useAtom(featureWorkbenchTabGroupsV2Atom)
  const [browserSurface, setBrowserSurface] = useAtom(featureWorkbenchBrowserSurfaceV2Atom)
  const [statusBar, setStatusBar] = useAtom(featureWorkbenchStatusBarV1Atom)
  const [harnessInspector, setHarnessInspector] = useAtom(featureWorkbenchHarnessInspectorV1Atom)
  const [harnessChatChrome, setHarnessChatChrome] = useAtom(featureWorkbenchHarnessChatChromeV1Atom)
  const [harnessAgentIntel, setHarnessAgentIntel] = useAtom(featureWorkbenchHarnessAgentIntelV1Atom)
  const [harnessExtCenter, setHarnessExtCenter] = useAtom(featureWorkbenchHarnessExtCenterV1Atom)
  const [harnessAgentTeams, setHarnessAgentTeams] = useAtom(featureWorkbenchHarnessAgentTeamsAtom)

  return (
    <>
    <SettingsSection
      title={t('settings.appearance.workbench')}
      description={t('settings.appearance.workbenchDesc')}
    >
      <SettingsCard>
        <SettingsToggle
          label={t('settings.appearance.workbenchUnifiedShell')}
          description={t('settings.appearance.workbenchUnifiedShellDesc')}
          checked={unifiedShell}
          onCheckedChange={setUnifiedShell}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchModeBar')}
          description={t('settings.appearance.workbenchModeBarDesc')}
          checked={modeRegistry}
          onCheckedChange={setModeRegistry}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchTopChrome')}
          description={t('settings.appearance.workbenchTopChromeDesc')}
          checked={topChrome}
          onCheckedChange={setTopChrome}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchTabGroups')}
          description={t('settings.appearance.workbenchTabGroupsDesc')}
          checked={tabGroups}
          onCheckedChange={setTabGroups}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchBrowserSurface')}
          description={t('settings.appearance.workbenchBrowserSurfaceDesc')}
          checked={browserSurface}
          onCheckedChange={setBrowserSurface}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchStatusBar')}
          description={t('settings.appearance.workbenchStatusBarDesc')}
          checked={statusBar}
          onCheckedChange={setStatusBar}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchHarnessInspector')}
          description={t('settings.appearance.workbenchHarnessInspectorDesc')}
          checked={harnessInspector}
          onCheckedChange={(checked) => {
            setHarnessInspector(checked)
            if (!checked) setHarnessAgentIntel(false)
          }}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchHarnessChatChrome')}
          description={t('settings.appearance.workbenchHarnessChatChromeDesc')}
          checked={harnessChatChrome}
          onCheckedChange={setHarnessChatChrome}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchHarnessAgentIntel')}
          description={t('settings.appearance.workbenchHarnessAgentIntelDesc')}
          checked={harnessAgentIntel}
          onCheckedChange={(checked) => {
            setHarnessAgentIntel(checked)
            if (checked) setHarnessInspector(true)
          }}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchHarnessExtCenter')}
          description={t('settings.appearance.workbenchHarnessExtCenterDesc')}
          checked={harnessExtCenter}
          onCheckedChange={setHarnessExtCenter}
        />
        <SettingsToggle
          label={t('settings.appearance.workbenchHarnessAgentTeams')}
          description={t('settings.appearance.workbenchHarnessAgentTeamsDesc')}
          checked={harnessAgentTeams}
          onCheckedChange={setHarnessAgentTeams}
        />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection
      title={t('settings.appearance.harnessSkipTitle')}
      description={t('settings.appearance.harnessSkipDesc')}
    >
      <div data-testid="harness-skip-list">
        <SettingsCard>
          {HARNESS_SKIP_LIST.map((item) => (
            <SettingsRow
              key={item.id}
              label={t(`settings.appearance.harnessSkip.${item.id}`)}
              description={t(`settings.appearance.harnessSkip.${item.id}Desc`)}
            >
              <span className="text-xs opacity-60">{t('settings.appearance.harnessSkipNotInstalled')}</span>
            </SettingsRow>
          ))}
        </SettingsCard>
      </div>
    </SettingsSection>
    </>
  )
}
