# [CANDIDATE-CHECKS] Independently executed assembled-candidate verification

Source: `de805e0dc7103b49d4c7f0a092d88c8b4222367a`. Host: Darwin arm64. Dependencies: Bun1.4.2 frozen-lock install,1817 packages, no tracked lockfile/source change. These are fresh commands from a separate clean checkout, distinct from main-only historical logs and earlier recorded browser/CI receipts.

## [CHECK-WORKSPACES] Every candidate workspace

| Workspace | Exit | Diagnostic occurrences | Exact log |
| --- | ---: | ---: | --- |
| `apps/cli` | 0 | 0 | [log](evidence/candidate-apps-cli.log) |
| `apps/cloud-gateway` | 0 | 0 | [log](evidence/candidate-apps-cloud-gateway.log) |
| `apps/electron` | 0 | 0 | [log](evidence/candidate-apps-electron.log) |
| `apps/viewer` | 2 | 2 | [log](evidence/candidate-apps-viewer.log) |
| `apps/webui` | 0 | 0 | [log](evidence/candidate-apps-webui.log) |
| `apps/workspace-service` | 0 | 0 | [log](evidence/candidate-apps-workspace-service.log) |
| `packages/cloud-runner` | 0 | 0 | [log](evidence/candidate-packages-cloud-runner.log) |
| `packages/core` | 0 | 0 | [log](evidence/candidate-packages-core.log) |
| `packages/messaging-discord-worker` | 0 | 0 | [log](evidence/candidate-packages-messaging-discord-worker.log) |
| `packages/messaging-gateway` | 2 | 123 | [log](evidence/candidate-packages-messaging-gateway.log) |
| `packages/messaging-whatsapp-worker` | 0 | 0 | [log](evidence/candidate-packages-messaging-whatsapp-worker.log) |
| `packages/pi-agent-server` | 0 | 0 | [log](evidence/candidate-packages-pi-agent-server.log) |
| `packages/server` | 0 | 0 | [log](evidence/candidate-packages-server.log) |
| `packages/server-core` | 0 | 0 | [log](evidence/candidate-packages-server-core.log) |
| `packages/session-mcp-server` | 0 | 0 | [log](evidence/candidate-packages-session-mcp-server.log) |
| `packages/session-tools-core` | 0 | 0 | [log](evidence/candidate-packages-session-tools-core.log) |
| `packages/shared` | 0 | 0 | [log](evidence/candidate-packages-shared.log) |
| `packages/ui` | 0 | 0 | [log](evidence/candidate-packages-ui.log) |

**Outcome:** 16 PASS / 2 FAIL. The required root `typecheck:all` separately passes. Its chain omits some workspace gates, so it cannot replace the independent inventory. Diagnostic occurrences can share a root cause and are not counted as independent product defects. Viewer’s first stage fails, so its chained functions compiler stage is not established.

## [CHECK-BEHAVIOR] Actual checks and build/runtime matrix

| Check | Result | Bounded evidence |
| --- | --- | --- |
| `root-typecheck` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-root-typecheck.log) |
| `durability-and-lifecycle-tests` | PASS | 69 pass 0 fail 639 expect() calls [log](evidence/candidate-durability-and-lifecycle-tests.log) |
| `web-transport-tests` | PASS | 34 pass 0 fail 82 expect() calls [log](evidence/candidate-web-transport-tests.log) |
| `web-build` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-web-build.log) |
| `pi-subprocess-build` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-pi-subprocess-build.log) |
| `server-build` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-server-build.log) |
| `built-server-lifecycle` | FAIL | 3 pass 1 fail 7 expect() calls [log](evidence/candidate-built-server-lifecycle.log) |
| `pi-subprocess-build-bun1314` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-pi-subprocess-build-bun1314.log) |
| `server-build-bun1314` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-server-build-bun1314.log) |
| `built-server-lifecycle-bun1314` | PASS | 4 pass 0 fail 37 expect() calls [log](evidence/candidate-built-server-lifecycle-bun1314.log) |
| `pi-subprocess-build-bun1314` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-pi-subprocess-build-bun1314.log) |
| `server-build-bun1314` | PASS | Compiler/build command; see exact output. [log](evidence/candidate-server-build-bun1314.log) |
| `built-server-lifecycle-bun1314` | PASS | 4 pass 0 fail 37 expect() calls [log](evidence/candidate-built-server-lifecycle-bun1314.log) |

The pinned1.3.14 comparison was rerun with its directory prepended to PATH so nested Bun build commands use the same pinned runtime; repeated invocations do not add unique test coverage. The same immutable source and production WebUI were used. Built lifecycle verifies real loopback HTTP/login/static assets, WebSocket authorization, token rejection, graceful shutdown and persistent restart of a fresh fixture profile. It does not exercise actual agents, audio, native installers, all product screens or deployed infrastructure.

## [CHECK-FAILURES] Concrete remaining findings

- **Viewer:** two TS2550 occurrences at core rox2/platform-contract.ts698/700 because the viewer ES library lacks Object.hasOwn. Fix and then execute both compiler stages and actual browser behavior (QA-011.2).
- **Messaging gateway:**123 diagnostic occurrences, including access-mode/reject-reason and binding/RPC contract mismatches. Preserve fail-closed authorization while fixing production/test contracts (QA-011.3).
- **Bun1.4.2 bundled server:** build succeeds but actual startup fails with ReferenceError exports_tmp is not defined in the bundled tmp dependency. Bun1.3.14 built lifecycle passes; supported compiler/runtime versions must be pinned or compatibility repaired (QA-011.4).
- **Product/release:** source and local fixture checks do not close signed installed Windows10/11/macOS, hosted multi-user identity, external provider/OAuth, paid sandbox provisioning, performance/security triage or production deploy/update gates. These remain explicit task acceptance.

## [CHECK-REPRODUCE] Reproducible command ownership

```sh
bun scripts/final-readiness-recheck.ts /absolute/path/to/clean-candidate
bun scripts/final-readiness-recheck.ts /absolute/path/to/clean-candidate --built-lifecycle
bun scripts/final-readiness-recheck.ts /absolute/path/to/clean-candidate --built-lifecycle --runtime /absolute/path/to/bun-1.3.14
```

The scripts record exact command arrays, source SHA, exit code, runtime and log in [candidate-recheck.json](evidence/candidate-recheck.json). Dependencies must first be installed with bun install --frozen-lockfile in the candidate; the installed runtime version is deliberately recorded. The build writes only to the separate candidate checkout, and fixture services use fresh temporary state and loopback ports. Existing user profiles/runtime state are untouched.
