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
  LegacyPanelStackEntry,
  OpenSurfaceOptions,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
  WorkbenchLayout,
  WorkbenchTab,
} from './types.ts';
export { DEFAULT_OPEN_SURFACE_OPTIONS } from './types.ts';
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
