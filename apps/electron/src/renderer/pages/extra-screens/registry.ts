/**
 * Registry of the extra workbench screens shown in the ActivityRail «Ещё»
 * group (spec: rox-shots/screens-spec2). Order = rail order.
 */
import { Contact, Gavel, Radar, type LucideIcon } from 'lucide-react'
import { EXTRA_SCREEN_FLAG } from '@craft-agent/core/platform'
import type { ExtraScreenId } from '../../../shared/extra-screens'

export interface ExtraScreenDef {
  id: ExtraScreenId
  icon: LucideIcon
  /** i18n key for the screen title (rail tooltip, page header). */
  labelKey: string
  /** `workbench.mode.<id>.v1` */
  flag: string
}

export const EXTRA_SCREENS: readonly ExtraScreenDef[] = [
  { id: 'dossier', icon: Contact, labelKey: 'extraScreens.dossier.title', flag: EXTRA_SCREEN_FLAG.dossier },
  { id: 'radar', icon: Radar, labelKey: 'extraScreens.radar.title', flag: EXTRA_SCREEN_FLAG.radar },
  { id: 'decisions', icon: Gavel, labelKey: 'extraScreens.decisions.title', flag: EXTRA_SCREEN_FLAG.decisions },
]

export function extraScreenDef(id: ExtraScreenId): ExtraScreenDef | undefined {
  return EXTRA_SCREENS.find((screen) => screen.id === id)
}

/** Screens visible in navigation for a given set of enabled ids (keeps registry order). */
export function visibleExtraScreens(enabled: readonly ExtraScreenId[]): ExtraScreenDef[] {
  const on = new Set(enabled)
  return EXTRA_SCREENS.filter((screen) => on.has(screen.id))
}
