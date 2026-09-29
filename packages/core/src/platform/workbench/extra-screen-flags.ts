/**
 * Flags for the extra workbench screens (Досье, Радар, Решения, Центр агентов,
 * Фокус). One flag per screen, `workbench.mode.<id>.v1`, default ON,
 * rollback-safe (turning a flag off only hides the rail entry and shows the
 * «screen disabled» state; stored data is kept).
 */
import type { FeatureFlagDefinition } from './flags.ts';

export const EXTRA_SCREEN_FLAG = {
  dossier: 'workbench.mode.dossier.v1',
  radar: 'workbench.mode.radar.v1',
  decisions: 'workbench.mode.decisions.v1',
  agents: 'workbench.mode.agents.v1',
} as const;

export type ExtraScreenFlagId = (typeof EXTRA_SCREEN_FLAG)[keyof typeof EXTRA_SCREEN_FLAG];

export const EXTRA_SCREEN_FEATURE_FLAGS: readonly FeatureFlagDefinition[] = Object.values(
  EXTRA_SCREEN_FLAG,
).map((id) => ({
  id,
  defaultValue: true,
  dependencies: [],
  rollbackSafe: true,
}));
