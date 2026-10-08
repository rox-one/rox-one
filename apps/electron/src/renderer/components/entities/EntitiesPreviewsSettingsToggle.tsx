/**
 * W1-08 (#1505) — Settings toggle for `entities.previews.v1`.
 *
 * Rendered by WorkbenchChromeSettings right under #1499's `entities.links.v1`
 * toggle, with the same persistence (jotai `atomWithStorage`, localStorage
 * `craft-feature-entities-previews-v1`, default OFF). Previews depend on the
 * EFFECTIVE links state (env override included), so while links is
 * effectively off the switch is disabled, shows off and the description
 * says why: the env-forced explanation when `CRAFT_FEATURE_ENTITIES_LINKS=0`
 * forces links off, otherwise "turn links on first". The requested value is
 * kept.
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SettingsToggle } from '@/components/settings'
import { useEntitiesLinksEffectiveState } from '@/lib/entities-links-sync'
import { entitiesPreviewsRequestedAtom } from './flags'

export function EntitiesPreviewsSettingsToggle() {
  const { t } = useTranslation()
  const linksState = useEntitiesLinksEffectiveState()
  const linksEnabled = linksState.enabled
  const [previews, setPreviews] = useAtom(entitiesPreviewsRequestedAtom)
  const base = t('settings.appearance.entitiesPreviewsDesc')
  const description = linksEnabled
    ? base
    : `${base} ${t(linksState.envOverride === false ? 'settings.appearance.entitiesEnvForcedOff' : 'settings.appearance.entitiesPreviewsNeedsLinks')}`
  return (
    <SettingsToggle
      label={t('settings.appearance.entitiesPreviews')}
      description={description}
      checked={linksEnabled && previews}
      disabled={!linksEnabled}
      onCheckedChange={setPreviews}
    />
  )
}
