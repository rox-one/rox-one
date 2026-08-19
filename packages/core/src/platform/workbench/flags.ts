/**
 * Granular workbench feature flags (ADR-0001).
 *
 * Renderer atoms map onto these ids. A flag is treated as enabled only when
 * every dependency is also in the requested set.
 */

export interface FeatureFlagDefinition {
  id: string;
  defaultValue: boolean;
  dependencies: string[];
  incompatibleWith?: string[];
  rollbackSafe: boolean;
  migrationRequired?: boolean;
}

export const WORKBENCH_FLAG = {
  modeRegistryV1: 'workbench.mode-registry.v1',
  topChromeV2: 'workbench.top-chrome.v2',
  tabGroupsV2: 'workbench.tab-groups.v2',
  browserSurfaceV2: 'workbench.browser-surface.v2',
  statusBarV1: 'workbench.status-bar.v1',
  panelRegistryV2: 'workbench.panel-registry.v2',
} as const;

export const WORKBENCH_FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: WORKBENCH_FLAG.modeRegistryV1,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
  {
    id: WORKBENCH_FLAG.topChromeV2,
    defaultValue: false,
    dependencies: [WORKBENCH_FLAG.modeRegistryV1],
    rollbackSafe: true,
  },
  {
    id: WORKBENCH_FLAG.tabGroupsV2,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    migrationRequired: true,
  },
  {
    id: WORKBENCH_FLAG.browserSurfaceV2,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
  {
    id: WORKBENCH_FLAG.statusBarV1,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
  {
    id: WORKBENCH_FLAG.panelRegistryV2,
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
  },
];

export function resolveEnabledFlags(
  requested: ReadonlySet<string>,
  definitions: readonly FeatureFlagDefinition[] = WORKBENCH_FEATURE_FLAGS,
): Set<string> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const enabled = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of requested) {
      if (enabled.has(id)) continue;
      const definition = byId.get(id);
      if (!definition) continue;
      const incompatible = definition.incompatibleWith ?? [];
      if (incompatible.some((other) => requested.has(other) || enabled.has(other))) continue;
      if (!definition.dependencies.every((dep) => enabled.has(dep) || requested.has(dep))) continue;
      // Dependencies must themselves resolve; delay until they are enabled.
      if (!definition.dependencies.every((dep) => enabled.has(dep))) continue;
      enabled.add(id);
      progressed = true;
    }
  }
  return enabled;
}

export function isWorkbenchFlagEnabled(
  id: string,
  requested: ReadonlySet<string>,
  definitions: readonly FeatureFlagDefinition[] = WORKBENCH_FEATURE_FLAGS,
): boolean {
  return resolveEnabledFlags(requested, definitions).has(id);
}
