/**
 * Experimental workbench chrome flags (ADR-0001). Renderer-only localStorage
 * via jotai. Granular experimental flags default ON (P35-08); the unified-shell
 * master stays off. Conation flags stay off.
 */
import { useState } from 'react'
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
import { HARNESS_SKIP_LIST, type HarnessSkipId } from '@rox/core/platform'
import { navigate, routes } from '@/lib/navigate'
import { BUILT_MODE_SCREENS, MODE_SCREEN_FLAG_ATOMS, type ModeScreenId } from '@/atoms/mode-flags'
import { featureEntitiesLinksV1Atom } from '@/atoms/entities-links'
import { useEntitiesLinksEffectiveState } from '@/lib/entities-links-sync'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ExtraScreensSettings } from './ExtraScreensSettings'

function ModeScreenToggle({ id }: { id: ModeScreenId }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useAtom(MODE_SCREEN_FLAG_ATOMS[id])
  return (
    <SettingsToggle
      label={t(`settings.appearance.workbenchModeScreen.${id}`)}
      description={t('settings.appearance.workbenchModeScreenDesc')}
      checked={enabled}
      onCheckedChange={setEnabled}
    />
  )
}

/**
 * Where the first-party replacement for a skipped runtime lives, when it is a
 * concrete surface. Rows with a target get an "open" button in the dialog.
 */
const HARNESS_SKIP_TARGETS: Partial<Record<HarnessSkipId, () => void>> = {
  sessionBuddy: () => navigate(routes.view.settings('app')),
  agentTeamsRuntime: () => navigate(routes.view.settings('appearance')),
  visionCliPlugin: () => navigate(routes.view.settings('ai')),
  searchCliPlugin: () => navigate(routes.view.settings('workspace')),
  extraAutomationRuntime: () => navigate(routes.view.automations()),
}

/**
 * Frozen skip-list row: label + a "Why?" button explaining why the runtime is
 * out and what Rox offers instead. No install control — the list is frozen
 * (docs/specs/.../03-anti-goals.md §9).
 */
function HarnessSkipRow({ id }: { id: HarnessSkipId }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const target = HARNESS_SKIP_TARGETS[id]
  const base = `settings.appearance.harnessSkip.${id}`
  return (
    <>
      <SettingsRow
        label={t(base)}
        description={t(`${base}Desc`)}
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {t('settings.appearance.harnessSkipWhy')}
          </Button>
        }
      >
        <span className="text-xs opacity-60">{t('settings.appearance.harnessSkipNotInstalled')}</span>
      </SettingsRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(base)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">{t('settings.appearance.harnessSkipWhyLabel')}</p>
              <p className="text-muted-foreground">{t(`${base}Why`)}</p>
            </div>
            <div>
              <p className="font-medium">{t('settings.appearance.harnessSkipInsteadLabel')}</p>
              <p className="text-muted-foreground">{t(`${base}Instead`)}</p>
            </div>
          </div>
          {target ? (
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  target()
                }}
              >
                {t('settings.appearance.harnessSkipGo')}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

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
  const [entitiesLinks, setEntitiesLinks] = useAtom(featureEntitiesLinksV1Atom)
  // Main owns the effective state: CRAFT_FEATURE_ENTITIES_LINKS overrides the
  // toggle in both directions, so show the forced value and lock the switch.
  const entitiesLinksState = useEntitiesLinksEffectiveState()
  const entitiesLinksForced = entitiesLinksState.envOverride !== undefined

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
        <SettingsToggle
          label={t('settings.appearance.entitiesLinks')}
          description={entitiesLinksForced
            ? t(entitiesLinksState.envOverride ? 'settings.appearance.entitiesEnvForcedOn' : 'settings.appearance.entitiesEnvForcedOff')
            : t('settings.appearance.entitiesLinksDesc')}
          checked={entitiesLinksForced ? entitiesLinksState.enabled : entitiesLinks}
          disabled={entitiesLinksForced}
          onCheckedChange={setEntitiesLinks}
        />
      </SettingsCard>
    </SettingsSection>
    <ExtraScreensSettings />
    <SettingsSection
      title={t('settings.appearance.workbenchModeScreens')}
      description={t('settings.appearance.workbenchModeScreensDesc')}
    >
      <SettingsCard>
        {BUILT_MODE_SCREENS.map((id) => <ModeScreenToggle key={id} id={id} />)}
      </SettingsCard>
    </SettingsSection>
    <SettingsSection
      title={t('settings.appearance.harnessSkipTitle')}
      description={t('settings.appearance.harnessSkipDesc')}
    >
      <div data-testid="harness-skip-list">
        <SettingsCard>
          {HARNESS_SKIP_LIST.map((item) => (
            <HarnessSkipRow key={item.id} id={item.id} />
          ))}
        </SettingsCard>
      </div>
    </SettingsSection>
    </>
  )
}
