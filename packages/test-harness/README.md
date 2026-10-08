# @rox/test-harness (W1-10, #1507)

Two-user test harness, migration fixtures, micro-benchmarks and the unified CI
gates for the Rox Unified Suite. CI runs everything in the `unified-gates` job
of `.github/workflows/ci.yml`, with a `postgres:16` service container and
`ROX_TEST_PG_URL` set, so the live-database paths run instead of skipping:

```bash
bun test packages/test-harness            # harness self-tests
bun test apps/workspace-service/test e2e/unified
bun run scripts/check-provenance.ts       # provenance gate
bun run scripts/run-unified-gates.ts      # every other gate (--only <gate>[,<gate>] for a subset)
```

Strict perf budgets run separately in `.github/workflows/bench-strict.yml` (see
[Perf micro-benchmarks](#perf-micro-benchmarks)).

## Gate statuses

| Status | Meaning | Exit code |
|---|---|---|
| `pass` | The input exists and holds. | 0 |
| `pending` | The gate's sibling input is **absent**: the file or directory the owner issue will add does not exist yet. The summary names the path and the owner issue. Two scoped cases (owner decisions): `risk-class` / `negative-tests` while no catalogue command is gated yet, and `ddl-zod-parity` before #1503's zod modules while every table is allowlisted. | 0 |
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
| `ddl-zod-parity` | `apps/workspace-service/migrations/5NN-*.sql` and zod modules in `packages/shared/src/domain/*.ts` | #1502, #1503 | Tables are every `CREATE TABLE` in the 5NN files **plus every table they extend with `ALTER TABLE … ADD [COLUMN]`** (added columns join the column list). Each table pairs with a zod object named after it (`work_item` → `WorkItem` / `WorkItemSchema` / `workItemSchema` / `…Row`), or a `<table>.ts` file. Columns compare case-insensitively against keys (`link_id` = `linkId`). **An unpaired table fails** unless it is in the shrink-only allowlist `allowlists/ddl-unpaired-tables.json` (see below). Zod modules present with **zero pairs** fails. Before #1503 the gate is pending only while every table is allowlisted. |
| `permission-matrix` | `packages/core/src/entities/permissions.ts` | #1501 | `export function generatePermissionMatrix()` returning #1501's frozen rows `{ action, role, tags, championAbsent, hasChildren, kind, effectiveRole, allowed, reason? }`. The gate checks the shape (role lattice `minimal < viewer < commenter < editor < manager < owner` or `null`, known tags), no duplicate rows (keyed on kind, action, role, tags, championAbsent, hasChildren), and DATA-MODEL §8 against its own transcription: `effectiveRole` from the §8.2.2 tag roles, no access without a tag, viewer/minimal never edit, minimal only sees titles, only the owner transfers, a denied row has a `reason`, and every `allowed` equals the §8.3 rule (champion/reviewer grants, reviewer check-in only while the champion is absent, no goal deletion while children exist). An action the transcription does not know fails. |
| `risk-class` | `packages/core/src/commands/catalogue/index.ts` (`COMMAND_CATALOGUE`) and, when present, `packages/server-core/src/commands/registry.ts` (`createCommandRegistry()`) | #1500, #1508 | The **runtime** catalogue is imported (tuple-form `moduleCatalogue(…)` entries included); bindings and `riskClass` are read from the registry, because #1508 sets `riskClass` through `bindSchema`. Every **gated** command (bound handler or `schemaBound: true`) has a `riskClass` function. Unbound placeholders are reported as pending, never as failures. Exceptions: `allowlists/command-gates.json#riskClass`. |
| `negative-tests` | same catalogue / registry | #1500 | Each gated command has its own non-skipped `test()`/`it()` block that names the command id (block, title or enclosing `describe`) and shows a negative outcome: a whole-word keyword in a title (denied, forbidden, wrong scope, rate limit, quota, conflict, expired) or an exact error-code literal (`'FORBIDDEN'`, `'RATE_LIMITED'`, `'conflict'`, …) / 403·409·429 status assertion in the body. Identifiers such as `resolveConflict` do not count. Only `*.test`/`*.spec` files under `packages`, `apps/workspace-service`, `tests` and `e2e` are read; `packages/test-harness` (self-test fixtures) is skipped and symlinks are not followed. Exceptions: `allowlists/command-gates.json#negativeTests`. |
| `config-paths` | `scripts/check-config-paths.ts` | #1510 | Script exit code decides. |
| `chrome-schema-lint` | `packages/core/src/platform/chrome.ts` | #1512 | Exports `CHROME_SCHEMAS` \| `chromeSchemas` \| `SURFACE_CHROME_SCHEMAS` \| `listChromeSchemas()` \| `getChromeSchemas()` of `{ surface, rightZone \| right, centerControls \| center }`. Optional `CHROME_SURFACES: string[]` lists surfaces that must have a schema. |
| `dock-layout` | `apps/electron/src/renderer/platform/right-dock.ts` | #1512 | Exports `computeDockMode` \| `dockMode` \| `resolveDockMode` `(width, sidebar, inspector, agent) → mode` or `{ mode, … }`, mode ∈ `'sideBySide' \| 'sharedDock' \| 'overlay'`. `sidebar` is the **pre-collapse** width: per §18.4 the engine tries the expanded sidebar, then the auto-collapsed one (56 px), before falling back to sharedDock (W ≥ 1280) / overlay. Example: W=1280, S=280, I=328, A=0 → `sideBySide` with the sidebar auto-collapsed. Checked against the §18.4 table. |
| `agent-panel-privacy` | `packages/core/src/agent-panel/context.ts` | #1512 | Exports `decideAttach` \| `decideAutoAttach` \| `autoAttachDecision` `(candidate: PrivacyCandidate, actor: PrivacyActor) → { attach, redacted }`. The candidate carries every fact the decision needs (`ref`, `entityKind`, `authority`, `isFocus`, `isDm`, `isOpenDm`, `canRead`); the actor is `{ principalId, workspaceId }`. Checked against the §18.3 fixtures. |
| `visual-snapshots`, `axe`, `one-rail-dom` | wave-2 browser driver | wave 2 | See above. |
| `perf-microbench` | built in | #1507 | See [Perf micro-benchmarks](#perf-micro-benchmarks). |
| provenance (`scripts/check-provenance.ts`) | built in | #1507 | Diffs against `ROX_PROVENANCE_BASE`, else `origin/$GITHUB_BASE_REF`, else `origin/main`. Fails closed if git or the base cannot answer (CI uses `fetch-depth: 0`). All rules apply to **source files only** (docs, NOTICE and JSON inventories may quote the rules): GPL/AGPL licence headers and SPDX ids; Operately derivation claims without the provenance header; and Enterprise-Edition origin declarations in comments: a `Source:` line naming the Operately EE tree, a §6.1 `file:` line pointing into the EE app directory, or a GitHub `operately/operately` blob/tree URL into it. Only the gate's own fixture files (listed in `FIXTURE_FILES`) are exempt from the first two rules; nothing is exempt from the EE rule. |

## Shrink-only allowlists

Owner decisions (#1507 review 2) allow a few checked-in exceptions in
`packages/test-harness/allowlists/`:

| File | Key | Gate | Seeded with |
|---|---|---|---|
| `ddl-unpaired-tables.json` | `tables` | `ddl-zod-parity` | every table of #1502's 5NN migrations (none had a zod schema when the gate landed) |
| `command-gates.json` | `riskClass`, `negativeTests` | `risk-class`, `negative-tests` | nothing (the only gated command on #1500, `system.ping`, passes both) |

The lists may only shrink:

- a **stale** entry fails: the table now pairs with a schema or is no longer a
  5NN table; the command is unknown, not gated yet, or now passes. Delete the
  entry in the change that fixes it;
- an entry that was **not in the list at the merge-base** with the base branch
  (same base as the provenance check) fails, so new exceptions are never
  accepted silently. The change that first adds a list file has nothing to
  grow from;
- a missing or malformed list, or a base git cannot resolve, fails (fail closed).

## Perf micro-benchmarks

Budgets (TECH-SPEC §7): batch resolve of 100 refs < 40 ms, Work Map 1,000 rows
< 300 ms, list filter over 10k items < 50 ms. Each bench does 3 warm-ups, then 7
timed samples, and takes the median. `ROX_BENCH_RUNS=N` repeats the whole
measurement and reports the median of the N run medians.

Every result is labelled `real` (times product code) or `synthetic` (a
stand-in shaped like it), and the gate summary shows the label:

- `resolve`: **real**, the `@rox/core/entities` ref codec;
- `work-map`, `list-view`: **synthetic** until wave 2 lands the work-map
  projection and the task list filter. Wire them through
  `runMicroBenchmarks({ implementations: { 'work-map': fn } })`, which flips the
  label to `real`.

On PRs the gate is report-only (`warn` when over budget). Strict mode
(`ROX_BENCH_STRICT=1`, over budget = `fail`) runs in
`.github/workflows/bench-strict.yml` on push to `main`, nightly (02:17 UTC) and
on manual dispatch, with `ROX_BENCH_RUNS=3`.

## Postgres fixture

`ensurePostgres()` uses `ROX_TEST_PG_URL` when it is set and probes it with
`SELECT 1`. If the URL never answers, the fixture throws. In CI the
`unified-gates` job sets it from its `postgres:16` service container
(`postgres://postgres:postgres@127.0.0.1:5432/postgres`).

`ROX_TEST_PG_DOCKER=1` opts in to a throwaway `postgres:16` container. Docker
picks a free loopback port. The fixture returns `live` only after a readiness
probe, and runs `docker rm -f` on every failure path, on `cleanup()`, at exit
and on SIGINT / SIGTERM (the handler removes the container, then re-raises the
signal).

A SIGKILLed or crashed test worker runs no handler. Every container carries
the label `rox.test-harness=w1-10`, so remove leftovers with:

```bash
docker rm -f $(docker ps -aq --filter label=rox.test-harness=w1-10)
```

With neither variable set, the fixture is `skipped` and no image is pulled.
