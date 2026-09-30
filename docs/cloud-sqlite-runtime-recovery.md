# SQLite runtime recovery for the September cloud snapshot

## Specification

Owner: ROX recovery lead, isolated branch `fix/cloud-sqlite-runtime-20260930`, based on reviewed WebUI bridge `5f0df252`. Original native/compound checkouts are untouched.

Cloud validation of snapshot `0cc0402e` on Bun 1.3.14 reproduced a fatal import: `No such built-in module: node:sqlite`. The server exited before listening. Tests/builds alone did not prove startup. The new native authority and journal synchronously import this Node builtin, which is available to the Node/Electron runtime but unavailable to this pinned Bun.

Use the existing built-in synchronous SQLite provider for each runtime: `bun:sqlite` under Bun and `node:sqlite` under Node. Keep the SQLite schema, SQL, OS ownership/path protections, WAL/full-sync pragmas, authorization, credential fences and journal behavior unchanged. Do not change the pinned runtime, dependencies, credentials or network policy.

The adapter exposes only the consumed `exec`, `prepare` (`get`, `all`, `run`) and `close` operations. Bun strict binding rejects missing parameters; every current caller supplies all parameters. Empty `get` normalizes to Node's undefined. Bun executes each complete synchronous operation using a fresh statement and finalizes it in `finally`, including exceptions. Eager SQL preparation preserves syntax validation; a closed database rejects all operations, including previously retained wrappers. This avoids Bun 1.3.14's retained statement/cache eviction close failures. Safe integer decoding normalizes safe results to numbers and refuses unsafe integers; out-of-range bigint bindings cannot silently wrap. Read-only mode stays read-only for browser profile storage. Providers load lazily through the runtime branch, so Bun does not import unsupported `node:sqlite`.

Scoped follow-up found the same unconditional import in replica outbox, agent budget, automation occurrence ledger and the browser-profile handler. Their imports use the same shared server-side adapter; their SQL and domain logic remain unchanged. This avoids a second startup failure immediately after fixing authority alone.

References: [Bun SQLite](https://bun.sh/docs/runtime/sqlite), [Node SQLite](https://nodejs.org/api/sqlite.html). Current docs inform the subset; actual pinned Bun and Node execution remain the acceptance evidence.

## Plan and acceptance

1. Reproduce the import failure with the exact Bun 1.3.14 binary before editing.
2. Introduce the small runtime adapter and route authority/journal plus their filesystem tests through it.
3. Verify real SQLite binding, transaction rollback, close/reopen persistence and cross-runtime file compatibility; run actual authority/journal authorization, conflict/recovery and native startup tests.
4. Check core/server/WebUI types, rebuild the server/WebUI and perform isolated real health/login/authenticated config/HTML/stop/restart on Bun 1.3.14.
5. Independent review, commit/push/readback and Cloud repeat against the delivered exact revision. Full native/platform/DATA/SHARED acceptance remains separate.

Bounded owned paths: `packages/shared/src/utils/sqlite-runtime.ts`, exact provider imports in authority/journal, browser-profile handler, replica outbox, agent budget and occurrence ledger, their related filesystem tests, and scoped documentation. No shared protocol, locales, lockfile or active source checkout changes.

## Verified local source candidate

Bun 1.3.14 (`0d9b296a`) frozen install; TypeScript 5.9.3. These checks bind to this candidate's exact file manifest in the independent review, then to the delivery commit.

- 47 tests, 0 failures, 511 Bun assertions across adapter/cross-process file exchange, account replica, authority, journal and budget; occurrence ledger separately 4 tests, 0 failures, 10 assertions.
- Core, shared, server-core, server and WebUI typechecks: 0 diagnostics.
- Subprocess build, WebUI build and actual Bun-target server bundle: pass.
- Cross-process Bun/Node file exchange: Unicode/blob persistence, WAL/FULL, rollback, missing-row normalization, repeated bindings, readonly write refusal and missing-file refusal. Unsafe result/binding and 64 retained-statement close controls pass.
- Independent provider probes additionally pass on Node 22.23.2 and Node 26.8.2, including 1/21/64 retained statements, eager invalid SQL, blob lifetime and rollback-on-close. Pinned Bun-target bundle execution passes.

### Exact provider limitation

macOS Bun 1.3.14 uses Apple's SQLite. A readonly WAL file whose `-wal`/`-shm` sidecars were removed by Node on close can fail with `SQLITE_CANTOPEN`. Reopening writable durable stores works and recreates sidecars; the exchange test verifies the production writable-store path and readonly access while a writable holder exists. The adapter does not create missing files, reopen browser cookie databases writable or manufacture sidecars to bypass this failure. Browser profile import can report its existing failure result for this provider condition. This is an observed limitation of the pinned macOS provider; Linux Cloud is tested separately. Per-operation preparation adds SQL compile work under Bun; no performance claim is made.

Independent built-server lifecycle: **2 pass, 0 fail, 31 assertions** using the actual server bundle and WebUI from this source root, with an isolated private configuration. Health/login, unauthenticated rejection/redirect, bad credentials, HttpOnly login cookie, authenticated config/HTML, valid and invalid WebSocket authentication, graceful SIGTERM with an open client, unreachable stopped endpoints, same-profile restart and retained cookie/config pass. The short-token failure control passes. Server logs are checked for token leakage; no inherited production config/credentials are used. CI test helper is commit `06af318b4874a80f3de73ea7bc0f7981cbb3ecaa`; its optional root override points every resource to this source root. Local evidence log SHA256: `af492cddae4f24e030cf740ba87c53cb1cb8e31d022bdaf8112f8bf9c6e96a05`. Adapter reviewed SHA256: `8cd80233dc566a9433cd1b589222ca7cebbcf61ff5a09fff81c29702f5bfc831`.

Exact remote Linux Cloud repeat remains a delivery gate. Full platform/native/DATA/SHARED acceptance is open.

## Remote runtime verification route

Two new-request attempts in the Legacy navigation context rejected with `Unable to determine project root for task`; no repaired-source command executed in those attempts. Returning to Home/Work and reloading the original published-environment onboarding task restored its managed composer and visible GPT-6.1 Sol Ultra selector. A delivered-revision repeat uses that original task; its actual execution must be verified separately. A separate Legacy canary remains in environment setup and is not model-verified execution evidence.

The scoped `SQLite Runtime Recovery` workflow runs on standard GitHub-hosted Ubuntu 24.04 and macOS 15, with Node 24 and pinned Bun 1.3.14. It retains five typechecks, the core/WebUI and SQLite domain tests, actual build plus the reviewed built-server auth/lifecycle gate, and final tracked-source/lockfile refusal. Contents permission is read-only; no external provider credentials, account access changes or native feature acceptance are used. The complete program validation remains a separate CI gate. Node's documented SQLite experimental warning class alone is disabled in the child fixture; every unexpected stderr line and nonzero child exit still fails. Workflow execution/readback must bind to its delivered revision before remote verification is claimed.

Hosted push run `36716644818`, checkout `419189814af5f20502a072df90cc20ec153ddbf7`: Ubuntu 24.04 completed every check, build, lifecycle and clean-diff step successfully. The matching PR run also passed on Ubuntu. macOS 15.7.9 arm64, Bun1.3.14 and Node24.20.0 failed before code checks because the ripgrep install script's GitHub release API request returned 403 after all retries. The script supports the existing ephemeral `GITHUB_TOKEN`; the workflow supplies that token only to frozen install, retaining `contents: read`, all install scripts and every validation gate. The failure is retained; macOS acceptance requires the follow-up revision's actual result.

Revision `eb624e06` verified that install remedy on macOS, then exposed Node24 WebUI typecheck heap exhaustion at its approximately 2GiB default. The scoped typecheck step now uses a 4096MiB Node heap; every compiler target and source assertion remains enabled. Ubuntu passed again; those earlier workflow outcomes are historical rather than final acceptance of the following stricter lifecycle helper.

Independent review found that the old smoke helper returned success for a server already exited before a requested SIGTERM. The exact reviewed helper from `f9b018a890947dc8b1762d848fc817f51da79287` distinguishes graceful stop from cleanup: graceful acceptance requires a live child, SIGTERM and exit0; already-exited0 and17 both refuse, including the restarted process. Cleanup can dispose the intentional short-token failure. Restoring the old early-return behavior makes both adverse controls fail. On this repaired SQLite bundle, pinned Bun1.3.14 actual built lifecycle and controls pass **4/0/37**. Helper SHA256 `f214a1379ca00376aff691229c57f32e83823cd7acb03f713a0ef842b290829e`; the production adapter and all domain source bytes remain unchanged. Final hosted acceptance requires execution of this corrected helper on the new delivered revision.
