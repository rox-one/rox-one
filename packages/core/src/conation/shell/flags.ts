/**
 * Conation shell / inspector flag hooks (WP-Shell / ROX-003).
 *
 * Domain bridges (Soup/Notes/Drive/…) live under CX-Flags separately.
 * All defaults are false — no chrome until Appearance toggles are on.
 */

import type { FeatureFlagDefinition } from '../../platform/workbench/flags.ts';

export const CONATION_SHELL_FLAG = {
  shell: 'workbench.conation.shell',
  inspector: 'workbench.conation.inspector',
  surfacesSkill: 'skills.conation.surfaces',
} as const;

export type ConationShellFlagId =
  (typeof CONATION_SHELL_FLAG)[keyof typeof CONATION_SHELL_FLAG];

/** Stable id bag for Appearance / atoms / registry wiring. */
export const CONATION_SHELL_FLAG_IDS = CONATION_SHELL_FLAG;

export const CONATION_SHELL_FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: CONATION_SHELL_FLAG.shell,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
  {
    id: CONATION_SHELL_FLAG.inspector,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
  {
    id: CONATION_SHELL_FLAG.surfacesSkill,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
];

/** Skill registration gate — no-op stub until a Conation surfaces skill ships. */
export function isConationSurfacesSkillEnabled(
  requested: boolean,
): boolean {
  return requested === true;
}
