/**
 * Global test isolation for the module-global route gates.
 *
 * `shared/route-parser.ts` and `shared/surface-routes.ts` keep their flags in
 * module-scope variables — three independent gates: entity routes
 * (`route-parser.ts:48`), missions routes (`:91`) and unified surfaces
 * (`surface-routes.ts:81`). `isCompoundRoutePrefix` consults the surface gate
 * FIRST, so an open surface silently overrides the entity gate.
 *
 * Bun runs every test file of one invocation in a SINGLE process, so a file that
 * opens a gate and does not close it leaks into whatever runs next. The victim
 * therefore depends on file order, which differs between a dev machine and a
 * CI runner — the same suite passes locally and fails in CI, on a different test
 * each run (`route-parser-entities-flag`, `route-parser-entities`,
 * `deep-link-parse`, `meetings-catalog-deeplink`, `entities-flags`, …).
 *
 * Resetting centrally means no suite has to remember all three gates. Registered
 * through `bunfig.toml` → `[test] preload`, so a `beforeEach` is installed once
 * per process and applies to every test in every file.
 *
 * Production code must never import this.
 */
import { beforeEach } from 'bun:test'
import {
  resetEntityRoutesEnabled,
  resetMissionsRoutesEnabled,
} from '../apps/electron/src/shared/route-parser'
import { resetUnifiedSurfaceRoutes } from '../apps/electron/src/shared/surface-routes'

beforeEach(() => {
  resetEntityRoutesEnabled()
  resetMissionsRoutesEnabled()
  resetUnifiedSurfaceRoutes()
})
