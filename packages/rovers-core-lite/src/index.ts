/**
 * @rox/rovers-core-lite — read-only Rovers service catalog (catalog.json v1).
 *
 * Environment-agnostic core shared by the rovers_* session tools and the
 * `rovers:list` RPC: zod validation, injected signature verification, and the
 * list/search/show query API. No node built-ins, no `@rox/shared` — hosts inject
 * the catalog provider and the integrity seam.
 */

export type {
  RoversCardSummary,
  RoversCatalog,
  RoversCatalogListQuery,
  RoversCatalogListResult,
  RoversCatalogSourceInfo,
  RoversDeployDescriptor,
  RoversEntryFull,
  RoversLocalizedText,
} from './types.ts'

export { parseRoversCatalog, roversCatalogSchema, roversEntrySchema, RoversCatalogValidationError } from './schema.ts'

export {
  createRoversCatalogQuery,
  ROVERS_LIST_DEFAULT_LIMIT,
  ROVERS_LIST_MAX_LIMIT,
  RoversCatalogError,
  roversList,
  roversSearch,
  roversShow,
  toRoversCardSummary,
} from './query.ts'
export type { RoversCatalogErrorCode, RoversCatalogQuery } from './query.ts'

export {
  joinRoversPath,
  loadRoversCatalog,
  resolveRoversCatalogLocation,
} from './loader.ts'
export type {
  RoversCatalogEnv,
  RoversCatalogIntegrity,
  RoversCatalogLocation,
  RoversCatalogOrigin,
  RoversCatalogProvider,
} from './loader.ts'