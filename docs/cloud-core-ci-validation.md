# Combined main core and CI validation — 2026-09-30

## Revision and scope

- Main base: `f63294ba4fffa7238b46b24e918925a313ad0b12`.
- Final source revision: `2f3d685d5937ef79471fba894134af9b870b95fb`; branch `fix/cloud-core-ci-recovery-20260930`.
- Changed non-document source manifest: [cloud-core-ci-source-manifest.json](cloud-core-ci-source-manifest.json), 63 files, digest `117c14ac5ebdcddd14a9b8e0825ef8df0e5066f11a3a9a46f600c183747d3868`. The digest excludes documentation and binds sorted relative paths plus raw file hashes.
- Dependencies: frozen existing lockfile, Bun1.3.14 (0d9b296a), TypeScript5.9.3. No manifest or lockfile change.

The branch combines the two reviewed core repairs with the CI runner/lifecycle repair, then fixes concrete main-baseline compilation, rendering and locale-order failures exposed by the unchanged gate. Active native worktrees and the September feature union are not part of this source. The native host-control declaration remains optional and type-only on the browser side.

## Verification binding

The unchanged comprehensive `bun run validate:ci` completed with exit0 at `f9b018a890947dc8b1762d848fc817f51da79287`. The final amendment changes only two negative test-child configuration environments and the hosted WebUI build heap; neither is an input to that command. The original three builds were rerun after the Pi reasoning correction at `57edae5306ce8dbcd552c21fb1ec53016a99bab3`; product runtime source is byte-identical through the final revision. The final lifecycle test was executed against those same hashed built artifacts and its final source below. Documentation changes after this receipt do not change those inputs.

| Check | Observed result |
|---|---|
| Unchanged `validate:ci` | Exit0: eight actual package compiler contexts;248 Bun tests and19 Python document tests pass; i18n parity, sort and coverage pass |
| Optional pages-worker target | Existing script skipped because `workers/pages` is absent in this OSS export; no ninth compiled package is claimed |
| Supplementary WebUI typecheck | Exit0, zero diagnostics |
| Agent subprocess, WebUI and standalone server builds | All three exit0; existing WebUI chunk-size warning remains |
| Final built server lifecycle |4 pass,0 fail,37 assertions: HTTP/WS authentication, built HTML, shutdown with connected client, refused post-exit HTTP, persistence/restart, short-token refusal, already-exited0/17 refusal |
| Real helper negative mutant | Restoring the old already-exited early return makes both negative controls fail; source restored byte-identical afterwards |
| Final server package typecheck | Exit0, zero diagnostics |
| Pi model builder + actual private registration callback |16 pass,0 fail,44 assertions; all three canonical APIs, reasoning/thinking mapping and model overrides |
| Actual Projects library SSR |2 pass,0 fail,4 assertions; using the original main component as a negative control fails both tests |
| Optional bridge behavior |2 pass,0 fail,6 assertions for absent and present bridges |
| Shared focused changes |65 pass,0 fail,236 assertions |
| Electron/Pi focused regression set |91 pass,0 fail,761 assertions across18 files; final Pi registration test separately listed above |
| Server/core worker regression set |175 pass,0 fail,985 assertions; memory proposals6 pass,0 fail,26 assertions |
| Core subtree |Byte-identical to reviewed `01889b4a`: its full817/817 core suite and zero-diagnostic typecheck were verified there; this is inherited unchanged-source proof, not a second full-suite execution on final HEAD |
| Locale semantic comparison |All twelve parsed locale maps unchanged versus integration base; the sorter only moves keys. Parity reports6793 required English keys; existing extra Polish/Russian keys remain unchanged |

Run the changed runtime gate with Bun1.3.14 first on PATH:

```sh
bun run validate:ci
bun run webui:typecheck
bun run server:build:subprocess
bun run webui:build
bun build packages/server/src/index.ts --target bun --outdir dist-server --external xlsx
ROX_SERVER_SMOKE_ENTRY=dist-server/index.js ROX_SERVER_SMOKE_WEBUI_DIR=apps/webui/dist bun test packages/server/src/__tests__/smoke.test.ts
```

## Preserved failure and review history

1. The first integrated comprehensive run stopped at16 actual shared TypeScript diagnostics; later packages exposed their own concrete baseline errors. These were repaired with narrow guards/types and existing data sources, with assertions retained.
2. The existing sorter initially rejected all twelve locale files. Semantic maps were compared independently after sorting; translations and duplicate-key state did not change.
3. A preliminary Pi edit removed Responses reasoning because a local protocol type was stale. Independent execution of the actual registration callback reproduced that regression. The canonical shared type and byte-identical main reasoning expression are restored; the final subprocess was rebuilt after the correction.
4. The initial combined shutdown run once returned exit1 after31 assertions without captured child output. Its cause is unestablished; history is retained. Later strict shutdown reports redacted child output, keeps the zero-exit assertion and passes. A separate review found that an already-exited child could previously satisfy graceful-stop proof; the explicit graceful/cleanup modes and actual0/17 controls now prevent that false positive.
5. A real hosted macOS WebUI Vite build on the separately owned SQLite integration exceeded Node's default approximately2GiB heap. This branch sets `NODE_OPTIONS=--max-old-space-size=4096` only on that same WebUI build step. All source and gate commands remain intact. The validation step has no speculative heap amendment.

## Built artifact hashes

| Artifact | SHA256 |
|---|---|
| `packages/pi-agent-server/dist/index.js` | `832804e1b17f5eccc791d526d3d5b1655ba45edf58144561189989d1d0e88873` |
| `dist-server/index.js` | `c61917f76ba869d58007f90458a9af860b55815b92f815a8e06299b2c3650542` |
| `apps/webui/dist/index.html` | `487d1e71b8873fcbd9c44668ca3f87dbdbb6f54c6676b4822b4e36661926af5e` |
| `apps/webui/dist/login.html` | `e2b5ff3b6797dd07fea6edfe32051d8db3461c78ce6244ed00d42669615c5cfa` |

## Evidence hashes

Raw logs are retained in the private recovery archive, separate from source. These basenames and hashes identify the local evidence without publishing terminal/session exports or user profiles.

| Log basename | SHA256 |
|---|---|
| `rox-cloud-core-ci-validate-strict-final-20260930.log` | `6e3af017882ebe2e56419f273e552d0eaa4052e13554c7a2291d33be16e518c4` |
| `rox-cloud-core-ci-built-smoke-isolated-final-20260930.log` | `ac809d811aabc43d5b64c4b4105c5166b80536aacc8a99f51b0e5cfb6a6263d1` |
| `rox-cloud-core-ci-stop-negative-control-20260930.log` | `5135bd9d6c8864a9999eefe4e3cbfb323e12e038bde660fc5f46a468eb3f3ed4` |
| `rox-cloud-core-ci-server-typecheck-strict-20260930.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `rox-cloud-core-ci-subprocess-build-final-20260930.log` | `633ad817cdc8693061bc645d4b2221ef2faa17089bf876805bad591adcb9ace1` |
| `rox-cloud-core-ci-webui-build-final-20260930.log` | `e9d7e21d856255d9ae71e01202e9e391aeb3262fe23581421a7207d566990b46` |
| `rox-cloud-core-ci-server-build-final-20260930.log` | `f659ce197600c4d68b5abac6c7541b4f81cc249b04c960fd483d36fe8fa933d5` |
| `rox-cloud-core-ci-webui-typecheck-final-20260930.log` | `2f81eb99ff92fd33b68966d34e38497fde1c57e3efbc3c0a364442498bc88092` |
| `rox-cloud-core-ci-pi-registration-fixed-20260930.log` | `2cafa4b478df32c5eca0716370116a97ff97a83f2456a2dadf2113d13559408b` |
| `rox-cloud-core-ci-shared-focused-20260930.log` | `c3c8d0145c477e86e2b2610290e3df5556fe2c0294d71b826cc2c4352996a60e` |
| `rox-cloud-core-ci-electron-pi-focused-20260930.log` | `a18d03e09046cb6f3d1629bc087f9df50888a1d4993c06be7089ef5f537c57d1` |
| `rox-cloud-core-ci-projects-home-fixed-20260930.log` | `968cd3ddf64dcc2e110f5ee7d1355365260ac03fe06b69e6bc6a80f28429137d` |
| `rox-cloud-core-ci-bridge-behavior-final-20260930.log` | `1d911d51c04fcb50cf6eca0b6a1953a73e56cb7be68f8460dd567103086233cf` |

Final smoke source raw SHA256: `c02452b78951a13e58e0279191d2be895c7220ce62ab91cf4c8e28b6f9b75e68`.

## Review and delivery

Independent Standards and Spec/runtime reviews accept final source revision `2f3d685d5937ef79471fba894134af9b870b95fb` and source digest `117c14ac5ebdcddd14a9b8e0825ef8df0e5066f11a3a9a46f600c183747d3868`, with zero open findings. The Spec reviewer independently reproduced the final built4/4 lifecycle, zero-diagnostic server compiler and the same source digest. Both actionable findings (Responses reasoning and already-exited graceful stop) were resolved. Independent review Markdown SHA256: `ddd3437510e3c6c03e6d8ac8c1556602d2feb0bc57242630b101543b52262ef5`; its raw report and machine receipt remain in the private archive. A documentation-only delivery commit preserves the63-file source digest.

This local proof does not claim native UI acceptance, provider integrations, the September program's full completion, or success of unrelated self-hosted native/performance/toolchain jobs. Their existing path filters do not match this repair. The existing optional pages-worker skip is explicitly retained. Push, new draft PR to main and actual hosted check readback are separate delivery steps; core-only PR#1292 remains unchanged.
