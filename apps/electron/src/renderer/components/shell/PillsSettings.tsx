/** Connected PillsConfigurator: reads/writes the shared placement + order stores (onboarding + Settings). */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShellModes } from '@/platform/useModes'
import { usePillNav } from '@/platform/usePillNav'
import { PillsConfigurator, type PillOption } from './PillsConfigurator'
import { PillsTopBarConfigurator } from './PillsTopBarConfigurator'
import { applyPillsSelection, currentPillIds } from './pills'
import { usePills } from './shell-prefs'

export function usePillOptions(): { options: PillOption[]; value: string[]; setValue(next: string[]): void } {
  const { t } = useTranslation()
  const { shellFlags } = useShellModes()
  const nav = usePillNav(shellFlags)
  const order = usePills()
  const options = React.useMemo(() => nav.surfaces
    .filter((entry) => entry.id !== 'settings' && !entry.disabled && entry.placement !== 'hidden')
    .map((entry) => ({ id: entry.id, title: t(entry.labelKey), icon: entry.icon, iconOnly: entry.id === 'home' })), [nav.surfaces, t])
  const value = React.useMemo(() => currentPillIds(nav.surfaces, order), [nav.surfaces, order])
  const setValue = React.useCallback((next: string[]) => applyPillsSelection(next, nav.surfaces, nav.placements), [nav.surfaces, nav.placements])
  return { options, value, setValue }
}

export function PillsSettings({ className }: { className?: string }) {
  const { options, value, setValue } = usePillOptions()
  return <PillsConfigurator className={className} options={options} value={value} onChange={setValue} />
}

/** Onboarding variant: a live miniature of the titlebar pills. */
export function PillsTopBarSettings({ className }: { className?: string }) {
  const { options, value, setValue } = usePillOptions()
  return <PillsTopBarConfigurator className={className} options={options} value={value} onChange={setValue} />
}
