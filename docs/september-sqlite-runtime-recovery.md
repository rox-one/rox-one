# SQLite portability on the current native publication

## Scope and baseline

Owner: CloudRecovery; isolated branch `fix/september-sqlite-runtime-20260930`. Exact published baseline: `c358bd0ce0670cf6baaf0b3579933956c7009eb5`, remotely verified PR #1293, base `feat/september-program-20260930`. Existing 109-task program and acceptance state remain open. The old WIP-derived SQLite PR #1315 is prior scoped proof, not acceptance of the current native publication.

Five production consumer modules and three original SQLite fixtures remain byte-identical to the reviewed bridge baseline before the portable import change. The sixth browser-profile consumer retains the newer protected-cookie-key deletion import and removal of the former inline implementation from producer c1c81e66; only its SQLite provider import changes. The new transplant changes only those imports, preserving all current creation, authority, journal, outbox, budget, occurrence and browser-profile behavior. The shared adapter originated at `00f05761105c55f83fc7a8c744b094fd51379b2f`; adapter, cross-runtime fixture and test are byte-identical to final `4504549086016dc3b892d17e9855a71afc1925d8`. The cross-runtime Node child suppresses only its documented SQLite ExperimentalWarning class; unexpected stderr and nonzero exits still fail. The strict helper is byte-identical to final450 / main `2f3d685d5937ef79471fba894134af9b870b95fb`. The final scoped workflow changes its push branch and adds eleven existing current-native producer/RPC/host-control/channel boundary test targets described below, retaining all original commands and gates.

Baseline reproduction using immutable Bun 1.3.14: importing the existing agent-budget module exits1 with `No such built-in module: node:sqlite`. The shared adapter uses the existing runtime builtin, with no new package or SQL/schema change. Bun strict bindings, safe integers, per-operation finalization, eager SQL validation, missing-row normalization, closed guards and read-only behavior are preserved. References: [Bun SQLite](https://bun.sh/docs/runtime/sqlite), [Node SQLite](https://nodejs.org/api/sqlite.html). Acceptance is based on exact-version execution.

## Provider limit

Bun 1.3.14 on macOS can refuse read-only external WAL files if Node removed their sidecars. Durable stores legitimately reopen read-write; the read-only fixture retains a writable holder. Browser profile import keeps this condition closed, without creating sidecars or reopening cookie databases writable. Per-operation preparation has a compile cost; no throughput claim is made.

## Verification plan

1. Exact frozen install in this checkout; preserve lockfile and package manifests.
2. Domain adapter/cross-runtime, authority, journal, account-replica, budget, occurrence tests plus core/WebUI regression checks; five package/UI types.
3. Build actual Pi subprocess, WebUI and Bun server bundle from this checkout.
4. Strict real built HTTP/WebSocket auth, live SIGTERM/exit0, unreachable stopped endpoints, persistent restart and actual already-exited0/17 adverse controls. Config aliases and credentials are private disposable test values.
5. Root and independent reviewer inspect frozen source/manifest before commit and push. Publish a draft stack on current native branch, read back exact remote head, then capture Ubuntu/macOS scoped workflow actual-source runtime evidence.

## Candidate result

Current c358 local verification is complete for the scoped candidate. The older 3ea local candidate passed902/0/7188 and strict4/0/37, but is retained only as historical evidence; it does not prove these newer producer changes. No new hosted execution, current native UI behavior or full September acceptance is claimed until the corresponding revision-bound evidence is observed. Earlier final450 scoped hosted proof passed on Ubuntu/macOS for push and PR with885/0/4086 domain assertions and strict4/0/37; it establishes the portable mechanism, while this current-source integration must be verified separately.

A reproduced current-source WebUI typecheck has three TS2339 diagnostics for window.openClawHostControl because its optional interface/global declaration lived in a preload-only module outside the WebUI compilation graph. The previously reviewed type-only repair from main integration 2f3d685d relocates that unchanged declaration to apps/electron/src/shared/openclaw-host-control.ts and imports/re-exports the type from preload. This adds no host capability, bridge exposure or RPC route. The optional property and all preload runtime statements remain unchanged. This narrow prerequisite is included in the independently reviewed candidate.

The current-source hosted domain step additionally executes the existing real native-data/create/self-profile/workspace/startup RPC tests and native host-control/channel-boundary tests. This exercises the latest creation path and the type-only prerequisite, preserving every original gate. No new test implementation or assertion suppression is introduced. The current native preparation test checks absence of file/journal writes and denial of read-only, foreign and revoked principals.

## Locked current producer base

Root authorized this isolated fast-forward from 3ea to exact c358bd0ce0670cf6baaf0b3579933956c7009eb5 after observing non-documentation producer c1c81e66 changes. The candidate preserves native Memory preference filtering, protected-cookie-key deletion/custody and budget process-loss acceptance bytes. The reviewed adapter/import/type/helper patch is reapplied without rebasing published history or changing active original checkouts. Further native publications are separate source revisions and will not silently replace this locked acceptance baseline.

The c358 workflow also retains the four new existing producer acceptance tests for native Memory authorization, protected-cookie-key status, interrupted budget reservations and protected cookie custody recovery. These additive tests exercise the new base; all earlier domain/native targets and all strict built controls remain required.

## Final current-source local proof

Immutable Bun1.3.14 (0d9b296a), Node26.8.2, macOS arm64. Fresh frozen install completed on the new isolated checkout; c358 changes no dependency manifests/lockfile from the installed3ea baseline, and every workspace symlink resolves into this new checkout. Core/shared/server-core/server/WebUI TypeScript checks each exit0 with0diagnostics. The exact expanded workflow domain command passes **914 tests / 0 failures / 7280 assertions / 96 files**, including all eleven current-native producer/RPC/boundary targets. Subprocess, WebUI and actual Bun server builds each exit0. Strict built HTTP/WS auth, required live SIGTERM/exit0, persistent restart and real pre-exited0/17 controls pass **4 tests / 0 failures / 37 assertions**.

Adapter SHA2568cd80233dc566a9433cd1b589222ca7cebbcf61ff5a09fff81c29702f5bfc831; strict helper SHA256c02452b78951a13e58e0279191d2be895c7220ce62ab91cf4c8e28b6f9b75e68. Adapter, fixture, cross-runtime test and helper all exactly match reviewed final450 source; only the cross-runtime Node child ExperimentalWarning class is suppressed, while unexpected stderr/nonzero status still fail. Six production consumer bodies are byte-identical to lockedc358 after normalizing their sole provider import; current Memory/custody/creation/outbox paths are separately byte-compared to c358. Original spec/plan content remains an unchanged prefix of these additive documents.

The initial before-port Bun import failure, three WebUI declaration errors and superseded3ea local source/proof are retained privately. Independent source review and exact new hosted delivery remain pending; local proof does not accept the full109-task program or current native UI/provider criteria.

## Actual PR integration gate after native caller publication

The initial draft #1319 became CONFLICTING/DIRTY when its native base advanced fromc358 to07907f909838253eb011e4e27a510c4ba5b5a9df. Root authorized an ordinary merge into this published recovery branch, preserving history. The only merge conflicts were spec/plan appended sections; each now retains the exact current-native base document as a prefix followed by the recovery addendum. Native App and caller-session-loader production/test bytes are kept exactly as published. Production adapter, six consumer imports, three DB fixtures, strict helper and type-only host-control relocation remain byte-identical to reviewed8f302b20. The existing caller-session-loading test is the twelfth additional current-native workflow target; all earlier gates remain required. Previousc358 local proof and initial8f push outcomes are historical until the new merged source is validated.

Final merged-source local gates: immutable Bun 1.3.14 and Node 26.8.2; five types exit 0, all three actual builds exit 0, exact expanded domain command **919 pass / 0 fail / 7,313 assertions / 97 files**, strict current built lifecycle **4 pass / 0 fail / 37 assertions**. All 15 reviewed implementation files are byte-preserved; incoming App/caller loader/test and native evidence registry files exactly match079. Current source and built artifacts are frozen for bounded independent rebind before the merge commit and new hosted execution. Initial8f push passed both Ubuntu and macOS; no PR merge workflow ran while GitHub reported the real conflict. These earlier successful jobs remain historical, and exact new merge-source hosted acceptance is still required.
