export type {
  FeatureFlagDefinition,
  FeatureFlagOverrides,
  FeatureFlagRegistry,
  FeatureFlagResolution,
  FeatureFlagResolutionSource,
} from './types.ts';
export {
  isWorkbenchNamespace,
  resolveFlagWithUnifiedShellFallback,
} from './types.ts';
export { createFeatureFlagRegistry } from './registry.ts';
export {
  WORKBENCH_FEATURE_FLAGS,
  createWorkbenchFeatureFlagRegistry,
} from './workbench-flags.ts';
export type { WorkbenchFeatureFlagId } from './workbench-flags.ts';
