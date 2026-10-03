export * from './surface-types.ts'
export {
  TABLE_SURFACE_MAX_BYTES, TableSurfaceValidationError, createTableSurface,
  decodeTableSurface, encodeTableSurface, retargetTableSurface, tableSourceKey, tableQueryKey,
} from './table-surface.ts'
export { getTableCapabilityAvailability } from './surface-capabilities.ts'
