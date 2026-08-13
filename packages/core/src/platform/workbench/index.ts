export {
  DEFAULT_OPEN_SURFACE_OPTIONS,
  WORKBENCH_LAYOUT_VERSION,
  createSequentialIdGenerator,
  isPinnedSurface,
} from './types.ts';
export type {
  IdGenerator,
  LayoutMutation,
  LayoutMutationCode,
  OpenSurfaceOptions,
  OpenSurfaceTarget,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
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
  migrateWorkbenchToSurfaceLayoutSnapshot,
  parseWorkbenchLayout,
} from './migrate.ts';
export type {
  MigrateWorkbenchLayoutOptions,
  MigrateWorkbenchToSnapshotOptions,
} from './migrate.ts';
export { createInMemoryWorkspaceSurfaceHost } from './memory-host.ts';
export type { InMemoryWorkspaceSurfaceHostOptions } from './memory-host.ts';
