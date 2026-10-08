# @rox/test-harness (W1-10, #1507)

Two-user test harness, migration fixtures, micro-benchmarks and the unified CI
gates for the Rox Unified Suite. CI runs everything in the `unified-gates` job
of `.github/workflows/ci.yml`:

```bash
bun test packages/test-harness            # harness self-tests
bun test apps/workspace-service/test e2e/unified
bun run scripts/check-provenance.ts       # provenance gate
bun run scripts/run-unified-gates.ts      # every other gate
```

## Gate statuses

| Status | Meaning | Exit code |
|---|---|---|
| `pass` | The input exists and holds. | 0 |
| `pending` | The gate's sibling input is **absent**: the file or directory the owner issue will add does not exist yet. The summary names the path and the owner issue. | 0 |
| `warn` | Report-only result. Today only `perf-microbench` over budget without `ROX_BENCH_STRICT=1`. | 0 |
| `fail` | A real violation, **or the input exists but cannot be evaluated** (import throws, expected export missing, wrong shape, nothing parseable, gate threw). | 1 |

**Fail closed.** `pending` is allowed only while the input is absent. Once the
input file exists, the gate must evaluate it. If it cannot, the gate fails
with a message that says what it expected. Pending never hides a broken
wiring.

### Visual, axe and one-rail gates: pending until the wave-2 browser driver

`visual-snapshots`, `axe` and `one-rail-dom` need rendered screens. Only the
wave-2 E2E browser driver (Playwright) produces those. Until it exists:

- these three gates report `pending until the wave-2 browser driver exists…`
  on every run, by design;
- `visual-snapshots` still builds the full deterministic plan (1440×900 and
  1280×800, `rox` and `se` profiles, light/dark, RU/EN, hover / focus-visible /
  motion frames, reduced motion, fixed clock `2026-10-08T09:00:00Z`).
  `ROX_VISUAL_DRIVER=1` **fails**, because wave 1 has no driver to execute
  the plan. It never reports a vacuous pass;
- `axe` audits only explicitly injected HTML, using the built-in rule set
  (`src/axe.ts`). axe-core needs a live DOM, so it runs only inside the browser
  driver against the rendered page and never in Bun.

The wave-2 driver package turns these gates on by passing screens and
documents to `checkVisualGate`, `checkAxeGate` and `checkOneRailGate`.

## Gate inputs and wiring contracts

| Gate | Input (absent → pending) | Owner | Contract once present (else **fail**) |
|---|---|---|---|
| `ddl-zod-parity` | `apps/workspace-service/migrations/5NN-*.sql` and zod modules in `packages/shared/src/domain/*.ts` | #1502, #1503 | Each table pairs with a zod object named after it (`work_item` → `WorkItem` / `WorkItemSchema` / `workItemSchema` / `…Row`), or a `<table>.ts` file. Columns compare case-insensitively against keys (`link_id` = `linkId`). Both inputs present with **zero pairs** fails. |
| `permission-matrix` | `packages/core/src/entities/permissions.ts` | #1501 | `export function generatePermissionMatrix(): { actor, action, ref, allowed }[]`, non-empty, with no duplicate rows. |
| `risk-class` | `packages/core/src/commands/catalogue/*.ts` (besides `index.ts`) | #1500, #1508 | Every definition object (`type: '<module>.<verb>'` or `name: '<module>.<verb>'`) declares `riskClass:`. A module file with no discoverable definition fails. |
| `negative-tests` | same catalogue | #1500 | Each command id has its own non-skipped `test()`/`it()` block, named in the block or an enclosing `describe`, with a negative keyword (denied, forbidden, wrong scope, rate limit, quota, conflict, expired). Only `*.test`/`*.spec` files under `packages`, `apps/workspace-service`, `tests` and `e2e` are read. Symlinks are not followed. |
| `config-paths` | `scripts/check-config-paths.ts` | #1510 | Script exit code decides. |
| `chrome-schema-lint` | `packages/core/src/platform/chrome.ts` | #1512 | Exports `CHROME_SCHEMAS` \| `chromeSchemas` \| `SURFACE_CHROME_SCHEMAS` \| `listChromeSchemas()` \| `getChromeSchemas()` of `{ surface, rightZone \| right, centerControls \| center }`. Optional `CHROME_SURFACES: string[]` lists surfaces that must have a schema. |
| `dock-layout` | `apps/electron/src/renderer/platform/right-dock.ts` | #1512 | Exports `computeDockMode` \| `dockMode` \| `resolveDockMode` `(width, sidebar, inspector, agent) → 'sideBySide' \| 'sharedDock' \| 'overlay'`. Checked against the §18.4 table. |
| `agent-panel-privacy` | `packages/core/src/agent-panel/context.ts` | #1512 | Exports `decideAttach` \| `decideAutoAttach` \| `autoAttachDecision` `(ref) → { attach, redacted }`. Checked against the §18.3 fixtures. |
| `visual-snapshots`, `axe`, `one-rail-dom` | wave-2 browser driver | wave 2 | See above. |
| `perf-microbench` | built in | #1507 | 3 warm-ups, then the median of 7 samples per bench. Report-only (`warn`) unless `ROX_BENCH_STRICT=1`. |
| provenance (`scripts/check-provenance.ts`) | built in | #1507 | Diffs against `ROX_PROVENANCE_BASE`, else `origin/$GITHUB_BASE_REF`, else `origin/main`. Fails closed if git or the base cannot answer (CI uses `fetch-depth: 0`). Only source files are checked for GPL/AGPL licence headers and SPDX ids, and for Operately derivation claims without the provenance header. Every file is checked for Enterprise-Edition source declarations. |

## Postgres fixture

`ensurePostgres()` uses `ROX_TEST_PG_URL` when it is set (in CI, from a
`services: postgres` container) and probes it with `SELECT 1`. If the URL never
answers, the fixture throws.

`ROX_TEST_PG_DOCKER=1` opts in to a throwaway `postgres:16` container. Docker
picks a free loopback port. The fixture returns `live` only after a readiness
probe, and runs `docker rm -f` on every failure path, on `cleanup()` and at
exit.

With neither variable set, the fixture is `skipped` and no image is pulled.
