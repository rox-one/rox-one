/**
 * WP6 (#1533): where each surface shows — top pills, sidebar, «Ещё», or
 * hidden. One dropdown per surface of the primary-nav registry; the same
 * placement drives the titlebar pill, the sidebar and the workbench rail.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { enabledShellFlagsAtom } from '@/platform/unified-flags'
import { SettingsCard, SettingsSection, SettingsSelectRow } from '@/components/settings'
import { resolveNavSurfaces, defaultPlacement } from '@/components/app-shell/primary-nav'
import {
  FIXED_NAV_IDS,
  NAV_PLACEMENTS,
  resetNavPlacements,
  setNavPlacement,
  useNavPlacements,
  type NavPlacement,
} from '@/components/app-shell/nav-placement'

export function NavPlacementSettings() {
  const { t } = useTranslation()
  const shellFlags = useAtomValue(enabledShellFlagsAtom)
  const placements = useNavPlacements()
  const surfaces = React.useMemo(
    () => resolveNavSurfaces({ shellFlags, placements }).filter((entry) => !FIXED_NAV_IDS.has(entry.id)),
    [shellFlags, placements],
  )
  const options = React.useMemo(
    () => NAV_PLACEMENTS.map((value) => ({ value, label: t(`settings.navPlacement.${value}`) })),
    [t],
  )
  const customised = Object.keys(placements).length > 0
  return (
    <SettingsSection
      title={t('settings.navPlacement.title')}
      description={t('settings.navPlacement.desc')}
      action={customised ? (
        <button
          type="button"
          className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={resetNavPlacements}
        >
          {t('settings.navPlacement.reset')}
        </button>
      ) : undefined}
    >
      <SettingsCard>
        {surfaces.map((entry) => {
          const fallback = defaultPlacement(entry, shellFlags)
          return (
            <SettingsSelectRow
              key={entry.id}
              label={t(entry.labelKey)}
              description={placements[entry.id] ? undefined : t('settings.navPlacement.default')}
              value={entry.placement}
              options={options}
              onValueChange={(value) => setNavPlacement(entry.id, value === fallback ? null : (value as NavPlacement))}
            />
          )
        })}
      </SettingsCard>
    </SettingsSection>
  )
}
