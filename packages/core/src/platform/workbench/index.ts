export {
  DEFAULT_OPEN_SURFACE_OPTIONS,
  WORKBENCH_LAYOUT_VERSION,
} from './types.ts';
export type {
  IdGenerator,
  OpenSurfaceOptions,
  OpenSurfaceTarget,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
  WorkbenchApi,
  WorkbenchLayout,
} from './types.ts';
export {
  activateGroup,
  activateTab,
  closeSurface,
  createEmptyWorkbenchLayout,
  findSurfaceLocation,
  getActiveSurface,
  markSurfaceDirty,
  moveSurface,
  moveSurfaceToNewGroup,
  normalizeGroupProportions,
  openSurface,
  pinSurface,
} from './layout.ts';
export type {
  MoveToNewGroupResult,
  OpenSurfaceResult,
  SurfaceLocation,
} from './layout.ts';
export {
  migrateSurfaceLayoutSnapshotToWorkbench,
  parseWorkbenchLayout,
} from './migrate.ts';
export type { MigrateWorkbenchLayoutOptions } from './migrate.ts';
