export type {
  FeatureFlagDefinition,
} from './flags.ts';
export {
  WORKBENCH_FEATURE_FLAGS,
  WORKBENCH_FLAG,
  isWorkbenchFlagEnabled,
  resolveEnabledFlags,
} from './flags.ts';
export type {
  LayoutMutation,
  LayoutMutationCode,
  LegacyPanelStackEntry,
  OpenSurfaceOptions,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
  WorkbenchLayout,
  WorkbenchTab,
} from './types.ts';
export { DEFAULT_OPEN_SURFACE_OPTIONS, isPinnedSurface } from './types.ts';
export {
  activateTab,
  activeInstance,
  closeSurface,
  describeWorkbenchTab,
  migrateLegacyLayout,
  moveSurface,
  openSurface,
  pinSurface,
  splitGroup,
  workbenchLayoutToPanelEntries,
  workbenchTabKey,
} from './layout.ts';
export {
  flattenWorkbenchLayoutToLegacyEntries,
  parseWorkbenchLayout,
  parseWorkbenchTab,
} from './migrate.ts';
export type { InMemoryWorkbenchLayoutHostOptions, WorkbenchLayoutHost } from './memory-host.ts';
export { createInMemoryWorkbenchLayoutHost } from './memory-host.ts';
