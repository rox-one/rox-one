/**
 * Experimental workbench chrome flags (ADR-0001). Renderer-only localStorage
 * via jotai; all default OFF so W1 behavior is unchanged until toggled.
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  featureUnifiedShellAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchModeRegistryV1Atom,
  featureWorkbenchStatusBarV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
} from '@/atoms/unified-shell'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'

export function WorkbenchChromeSettings() {
  const { t } = useTranslation()
  const [unifiedShell, setUnifiedShell] = useAtom(featureUnifiedShellAtom)
  const [modeRegistry, setModeRegistry] = useAtom(featureWorkbenchModeRegistryV1Atom)
  const [topChrome, setTopChrome] = useAtom(featureWorkbenchTopChromeV2Atom)
  const [tabGroups, setTabGroups] = useAtom(featureWorkbenchTabGroupsV2Atom)
  const [browserSurface, setBrowserSurface] = useAtom(featureWorkbenchBrowserSurfaceV2Atom)
  const [statusBar, setStatusBar] = useAtom(featureWorkbenchStatusBarV1Atom)

  return (
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
      </SettingsCard>
    </SettingsSection>
  )
}
