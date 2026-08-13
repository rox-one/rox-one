/**
 * Granular feature flags — ADR-0001 decision 16.
 *
 * Replaces the single `featureUnifiedShellAtom` wave gate for new work: every
 * workbench/workgraph capability ships behind its own flag so components can
 * roll out (and roll back) independently. Pure TS; persistence and renderer
 * atoms bind in apps/electron.
 */

import type { Disposable } from '../types.ts';

/**
 * One flag. `dependencies` must all be enabled for this flag to resolve
 * enabled; `incompatibleWith` lists flags whose enabled state force-disables
 * THIS flag (the flag declaring the incompatibility yields).
 */
export interface FeatureFlagDefinition {
  /** Globally unique, dotted, versioned: `workbench.tab-groups.v2`. */
  id: string;
  defaultValue: boolean;
  dependencies: string[];
  incompatibleWith?: string[];
  /** Safe to turn OFF after it has been ON (no persisted-format migration). */
  rollbackSafe: boolean;
  /** Turning ON requires a one-time data migration to have run. */
  migrationRequired?: boolean;
  description?: string;
}

/** User/dev overrides; absence of a key means "use the definition default". */
export type FeatureFlagOverrides = Readonly<Record<string, boolean>>;

export type FeatureFlagResolutionSource =
  | 'default'
  | 'override'
  | 'disabled-by-dependency'
  | 'disabled-by-incompatibility'
  /** The flag is part of a dependency cycle; treated as disabled. */
  | 'disabled-by-cycle';

export interface FeatureFlagResolution {
  id: string;
  enabled: boolean;
  source: FeatureFlagResolutionSource;
}

export interface FeatureFlagRegistry {
  /** Duplicate id: throw + log (same discipline as PanelRegistry). */
  register(definition: FeatureFlagDefinition): Disposable;
  get(id: string): FeatureFlagDefinition | undefined;
  /** Registration order. */
  list(): FeatureFlagDefinition[];
  /** Unknown id: throw (a flag reference is a programming error). */
  isEnabled(id: string, overrides?: FeatureFlagOverrides): boolean;
  resolve(id: string, overrides?: FeatureFlagOverrides): FeatureFlagResolution;
  resolveAll(overrides?: FeatureFlagOverrides): Record<string, boolean>;
  /** Configuration problems: unknown refs and dependency cycles. */
  validate(): string[];
  onDidChange(listener: () => void): Disposable;
}

/**
 * Unified-shell OR-fallback applies only to `workbench.*` flags.
 * Domain / workgraph flags never inherit the wave gate.
 */
export function isWorkbenchNamespace(id: string): boolean {
  return id.startsWith('workbench.');
}

export function resolveFlagWithUnifiedShellFallback(
  registry: FeatureFlagRegistry,
  id: string,
  overrides: FeatureFlagOverrides = {},
  unifiedShellFallback = false,
): boolean {
  if (registry.isEnabled(id, overrides)) return true;
  return unifiedShellFallback && isWorkbenchNamespace(id);
}
