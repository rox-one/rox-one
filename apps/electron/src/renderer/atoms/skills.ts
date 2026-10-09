/**
 * Skills Atom
 *
 * Simple atom for storing workspace skills.
 * Used by NavigationContext for auto-selection when navigating to skills view.
 */

import { atom } from 'jotai'
import type { LoadedSkill } from '../../shared/types'

/**
 * Atom to store the current workspace's skills.
 * AppShell populates this when skills are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const skillsAtom = atom<LoadedSkill[]>([])

/**
 * Whether the current workspace's skills catalog is still syncing/pending.
 * A slow bundled-skills sync can outlive the client timeout, so non-panel
 * consumers (skills popover, pickers) must not claim "no skills configured"
 * while this is true — same contract the SkillsListPanel already honours.
 * Written from the same call sites that drive AppShell's local flag.
 */
export const skillsSyncingAtom = atom<boolean>(false)
