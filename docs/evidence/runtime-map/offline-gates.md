# Runtime-map offline release gates

Inspected package acceptance document 04 against integrated root HEAD `5fc80f66af102c95bae53ac7025423d68d8f0377`, Linux x64, Bun 1.3.14. Subsequently observed HEAD `cd5a5e8aff9330a414392cd719e0731de210e50d` changes only the native-loop probe, not the locale, channel inventory or workflow sources tested here. The checks below are offline and read-only on repository sources. No full test, typecheck or build was repeated by this worker.

`bun` denotes `/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun`; commands ran from the coordinator root. Logs are in [offline-gates](offline-gates/).

| Command | Exit | Result | Log |
|---|---:|---|---|
| `bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts apps/electron/src/renderer/__tests__/i18n-keys-coverage.test.ts` | 0 | 22 pass, 0 fail, 22 assertions; corrected channel inventory and latestWindow key | `runtime-final-ipc-i18n.log` |
| `bun run scripts/check-i18n-parity.ts` (`lint:i18n:parity`) | 0 | 11 non-English locales match 8204 English keys, permitted plural variants retained | `runtime-final-i18n-parity.log` |
| `bun scripts/sort-locales.ts --check` (`lint:i18n:sorted`) | 0 | All current locale files sorted and formatting exact | `runtime-final-i18n-sorted.log` |
| `bun run scripts/check-i18n-coverage.ts` (`lint:i18n:coverage`) | 0 | 7913 literal references, 5661 unique keys, valid interpolation | `runtime-final-i18n-coverage.log` |
| `bun test packages/shared/src/i18n/__tests__/locale-parity.test.ts packages/shared/src/i18n/__tests__/locale-registry.test.ts` | 0 | 109 pass, 0 fail, 143 assertions | `runtime-final-i18n-registry.log` |
| `bun /workspace/scratch/d0a9c1c6c094/runtime-i18n-manifest-check.ts` | 0 | All 293 manifest values match actual locale resources; i18next resolves three representative new keys in every language | `runtime-final-i18n-manifest.json` |
| `bun run test:connection-fabric` | 0 | 249 pass, 0 fail, 1917 assertions; mocked provider HTTP and isolated credential/grant stores | `runtime-final-connection-fabric.log` |
| `bun run lint:ipc-sends` | 127 | package script references absent `scripts/check-raw-sends.sh` | `runtime-final-ipc-sends.log` |
| `bun run lint:tool-name-checks` | 127 | package script references absent `scripts/check-task-tool-checks.sh` | `runtime-final-tool-names.log` |

Both absent script paths are also absent from baseline `3342fad30166bdf005d296e0d5fe24d36d4df5fb`; these are existing repository entrypoint gaps, not successful gates. No substitute command is claimed as passing either guard.

## Locale coverage and fallback

The original package referred to ten locales. Latest main has **twelve** registered locale files: ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans and zh-Hant. All 293 new `runtimeMap.*`, `capabilityCatalog.*` and `starterPrompts.*` keys are present in every current locale, including newly integrated Arabic and Hungarian. Russian matches every manifest RU value; English matches every EN value. The other ten languages intentionally contain the exact English fallback values for these new keys; they are not claimed as fully translated native-language copy. Full parity tolerates each language's pre-existing plural forms.

The manifest check read `docs/runtime-map/i18n-manifest.json` and the actual locale JSON resources, checked each value against RU or EN according to language, then initialized the production `setupI18n` registry and resolved `runtimeMap.mode.editor`, `starterPrompts.welcome` and `capabilityCatalog.allCategories` for all twelve languages. It made no provider calls or network requests.

## Acceptance command mapping and remaining scope

Document 04 requires commands to be reconciled with package.json before execution. The implemented native journal/collector lives at `packages/server-core/src/sessions/runtime-trace`, not the proposed `packages/server-core/src/runtime-trace`; RPC registration is `packages/server-core/src/handlers/rpc/runtime-trace.ts`, with RPC tests at `packages/server-core/src/handlers/rpc/__tests__/runtime-trace.test.ts` and service/journal tests under the sessions runtime-trace folder. The core, renderer, catalog and starter-prompt test locations exist. The three i18n scripts exist and passed. The two legacy lint entrypoints above do not exist.

This report covers the stated offline locale/RPC gates and the [workflow compatibility evidence](workflow-compatibility.md). It does not assert completion of `typecheck:all`, connection-fabric/MCP/perf suites, full root test, packaging build, native worker loop or installed desktop smoke. Those are separate coordinator/W8 evidence classes. The earlier broad root test was incomplete and then automatically rejected for an unrequested Context7 operation; this worker did not repeat or bypass it. Representative baseline failures and the subsequently corrected four runtime-map gates are recorded in [baseline-test-triage.md](baseline-test-triage.md).

## Historical guard inspection

The missing scripts exist in unmerged historical commit `39ff7a37941342a5fff959d7b04ed03789fb564c` but have no current equivalent under scripts. Their bodies were replayed from scratch with only `repo_root` redirected to the current coordinator checkout; repository source was not restored or modified. Both historical checks exited **1**. The raw-send checker reports five existing main-process sites for project-authority configuration, browser-panel focus, mail, voice-overlay and meetings. The task-name checker reports two intentional native-policy fixtures using the actual OMP `task` tool name in `omp-worker-policy.test.ts`; restoring that obsolete checker blindly would reject valid test inputs. These are diagnostics of old guard behavior, not substitutes for the configured missing gates. Logs are `runtime-final-historical-check-raw-sends.log` and `runtime-final-historical-check-task-tool-checks.log`.

A separate read-only inspection of added lines in main/preload against the exact origin/main hash recorded in `runtime-final-raw-send-delta.json` found **zero new raw renderer sends**. The runtime trace client methods are mapped in `apps/electron/src/transport/channel-map.ts` and constructed by the shared `buildClientApi` facade from `apps/electron/src/transport/build-api.ts`; registration is imported by `packages/server-core/src/handlers/rpc/index.ts` from `./runtime-trace`. The registered `runtimeTrace:*` channels are covered by the passing exact inventory tests. This narrower delta result is not a full historical lint pass.

## MCP command boundary

The exact `test:mcp-onboarding` package command is **not executed as a passing gate**: `packages/server-core/src/sessions/workspace-mcp-defaults.test.ts` invokes real `SessionManager.setupConfigWatcher`, which unconditionally starts `builtinMcpStartup.ensureWorkspace`; a fresh fixture workspace may therefore contact seeded external Context7. `first-session-welcome-persistence.test.ts` also enters the real SessionManager creation/storage boundary and is conservatively excluded from the audited isolated subset. The failed automatic review of the general suite is not bypassed by re-running these tests. Audited MCP pools/clients use injected fake transports or owned loopback servers; remaining static catalog, source lifecycle, fake OMP CLI and handler seams are isolated separately. Exact subset commands/results are recorded separately when completed.

The audited MCP subset completed successfully across three isolated test processes: **103 pass / 401 assertions**, **378 pass / 1837 assertions**, and **6 pass / 19 assertions**, all exits **0**, totaling **487 pass / 2257 assertions**. Exact file lists and excluded boundaries are in `offline-gates/runtime-final-mcp-safe-commands.json`; logs are `runtime-final-mcp-safe-1.log` through `runtime-final-mcp-safe-3.log`. The exact full `test:mcp-onboarding` remains **BLOCKED / not run**, since the two excluded files could start background probes rather than only deterministic fixtures.

The general root source continued integrating main during the audit; no changes to the locale, workflow codec/editor or channel-inventory fixture surfaces were observed between tested HEAD `5fc80f66a` and completion HEAD `d4935b2216eefe52fee8238bc6b67fa7acf2a923`. Per-run source hashes are explicit where captured, and these isolated checks do not replace a full test of the eventual final commit. Bundled log copies trim trailing whitespace only; original process output remains in the captured scratch logs.
