/**
 * W1 entity-surface route matcher.
 *
 * Thin re-export of the single shared grammar in `@rox/core/entities`
 * (`parse-route.ts`): kind-first entity routes ONLY (`docs/file/{id}`,
 * `goals/goal/{id}`, `base/{id}/{table}` …). Legacy routes
 * (`tasks/task/{id}`, `notes/note/{id}`, `settings/{subpage}` …) are
 * deliberately outside this entry point so they keep parsing byte-identically
 * in `route-parser.ts`. The link extractor uses `parseEntityRouteOrLegacy`
 * from the same module instead.
 */

export { isEntityCompoundRoute, parseEntityRoute, type ParsedEntityRoute } from '@rox/core/entities'
