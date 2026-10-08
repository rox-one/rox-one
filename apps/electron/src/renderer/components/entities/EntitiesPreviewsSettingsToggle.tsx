/**
 * W1-08 (#1505) — Settings toggle for `entities.previews.v1`.
 *
 * Rendered by WorkbenchChromeSettings right under #1499's `entities.links.v1`
 * toggle, with the same persistence (jotai `atomWithStorage`, localStorage
 * `craft-feature-entities-previews-v1`, default OFF). Previews depend on
 * links, so while links is off the switch is disabled, shows off and the
 * description says to turn links on first; the requested value is kept.
 */
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SettingsToggle } from '@/components/settings'
import { entitiesLinksRequestedAtom, entitiesPreviewsRequestedAtom } from './flags'

export function EntitiesPreviewsSettingsToggle() {
  const { t } = useTranslation()
  const linksEnabled = useAtomValue(entitiesLinksRequestedAtom)
  const [previews, setPreviews] = useAtom(entitiesPreviewsRequestedAtom)
  const description = linksEnabled
    ? t('settings.appearance.entitiesPreviewsDesc')
    : `${t('settings.appearance.entitiesPreviewsDesc')} ${t('settings.appearance.entitiesPreviewsNeedsLinks')}`
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
