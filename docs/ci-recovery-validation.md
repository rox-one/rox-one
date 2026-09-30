# CI recovery validation receipt — 2026-09-30

Worktree: `/Users/t/Projects/rox-cloud-ci-fixes-20260930`; branch: `fix/cloud-ci-baseline-20260930`; base: `f63294ba4fffa7238b46b24e918925a313ad0b12`.

## Toolchain and reproduction

Pinned executable: `/Users/t/Projects/archive/rox-remaining-20260930/native-ui-20260930/profile/toolchain/bun/1.3.14/bun-darwin-aarch64/bun` (`1.3.14`, `0d9b296a`). Its directory was placed first in PATH for nested build commands. The active toolchain profile was not changed. Dependencies were installed only in this owned worktree, with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --frozen-lockfile --ignore-scripts`; lockfile and manifests stayed unchanged.

Run with Bun1.3.14 first on PATH:

```sh
bun run server:build:subprocess
bun run webui:build
bun build packages/server/src/index.ts --target bun --outdir dist-server --external xlsx
ROX_SERVER_SMOKE_ENTRY=dist-server/index.js ROX_SERVER_SMOKE_WEBUI_DIR=apps/webui/dist bun test packages/server/src/__tests__/smoke.test.ts
bun test packages/server/src/__tests__/smoke.test.ts packages/server-core/src/webui/__tests__/http-server.test.ts packages/server-core/src/transport/__tests__/server-lifecycle.test.ts
bun run validate:ci
```

For a separately built integration checkout, set `ROX_SERVER_SMOKE_REPO_ROOT` to its absolute root along with absolute `ROX_SERVER_SMOKE_ENTRY` and `ROX_SERVER_SMOKE_WEBUI_DIR`. The helper then uses that checkout's config-defaults, bundled resources and working directory. The default remains the test's own checkout. This test-only option keeps runtime proof bound to the source revision that supplied all artifacts.

## Results

| Check | Result | External log |
|---|---|---|
| Frozen isolated install | Exit0 | `/tmp/rox-cloud-ci-install-20260930.log` |
| Agent subprocess build with pinned nested Bun | Exit0 | `/tmp/rox-cloud-ci-subprocess-build-pinned-20260930.log` |
| WebUI build | Exit0; existing chunk-size warning | `/tmp/rox-cloud-ci-webui-build-pinned-20260930.log` |
| Standalone server bundle | Exit0 | `/tmp/rox-cloud-ci-server-build-20260930.log` |
| Real built server + built HTML lifecycle | 2pass,0fail,31assertions | `/tmp/rox-cloud-ci-built-smoke-final-20260930.log` |
| Source server + HTTP handler + transport regressions | 23pass,0fail,97assertions | `/tmp/rox-cloud-ci-related-tests-20260930.log` |
| Missing bundle negative control | Exit1,0pass,2fail | `/tmp/rox-cloud-ci-missing-entry-control-20260930.log` |
| Missing login HTML negative control | Exit1,0pass,2fail | `/tmp/rox-cloud-ci-missing-login-control-20260930.log` |
| Server TypeScript check | Eight existing diagnostics; exact normalized diagnostic comparison matches baseline | `/tmp/rox-cloud-ci-server-typecheck-20260930.log`, `/tmp/rox-cloud-ci-typecheck-comparison-20260930.json` |
| Unchanged comprehensive `validate:ci` | Exit2 at13existing core TypeScript diagnostics | `/tmp/rox-cloud-ci-validate-baseline-20260930.log` |
| Workflow syntax | Both YAML files parsed with installed js-yaml | Tool output records jobs and commands |
| Diff whitespace | `git diff --check` passes | Local command |

The first source smoke correctly exposed that normal startup adds migration receipts on restart. The persistence assertion now checks retention of the saved config object while allowing added migration receipts; it does not require byte identity across legitimate migrations. HTTP/WS negative assertions and shutdown/restart checks remain active.

## Evidence hashes

| Artifact | SHA256 |
|---|---|
| Install log | `ff33b4ae91bbcb0f39039e56d49f337e6ad12685fc79df359902103e57754de1` |
| Pinned subprocess build log | `b0908dcfd630f571c68b4366bfb7921a3cbc32019f59f78d0b322a908e78c1e8` |
| Pinned WebUI build log | `c11988398fbc56bb9a69e6b4c12d661209e6fbe16c2b8d94195d1ac7fb8454d9` |
| Server bundle build log | `9834d3cc8a57d970c13b1e6f93e75a8378ec497856143178eefc1cbddb133fd5` |
| Built lifecycle log | `7eb200009ad6760c2418f1e520e2ad0bdd7b616a7f28c150370d9ce6af2fb93a` |
| Related regressions log | `a3114b7649fbb237a89c05144ef86b7f332c03fc4fc952f90aab5ef1a2dde3ff` |
| Missing server control | `7e17a9722ead9a911164fc828a6cb8a30b5e4b1b8da3927e0123cf215df039a9` |
| Missing login control | `4eb7f786a27cc844aa1ea68f6d964415831e78297bbc2e26f685409e6bbc4c16` |
| Server typecheck log | `bb0259d2ca4d3994b404cf2ad5e1aa5fe428ab7f487f42c46300ff5da69431e9` |
| Comprehensive baseline validation | `54e24a484d9da60bad75058d28b655c05b57cc50a59a746209d17bee6a9604d0` |
| Tested standalone bundle | `38766b052e104dd9edee6532a7469368d85945249a61e43a5ea8cbc73c689469` |
| Pinned agent subprocess bundle | `8ca57ddbcb38dcf1ff9ed15db1ad49dc93176444d8a63bccaeaf595ab1db1f39` |
| Built index HTML | `6b2ddbf46a08627cf7434bc871b98b8b08caea541d97c5d07429976776b0b886` |
| Built login HTML | `e2b5ff3b6797dd07fea6edfe32051d8db3461c78ce6244ed00d42669615c5cfa` |

## Delivery boundary

This receipt proves a local real-runtime gate on the stated base and proposed workflow configuration. It does not prove that an unpushed workflow ran on GitHub or that the separate September bridge snapshot can load under Bun1.3.14. Root owns compatibility repair, integration, final checks and hosted execution readback. Merge the core and CI sections of `docs/spec.md` and `docs/plan.md` when integrating their independent main-based branches.
