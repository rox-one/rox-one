Actual fresh durable/restart case readback at source `010fa8c040e3a84cd40cd8195473f52d8582f159`.

Read actual final raw logs; preserve every printed pass/fail/skip/todo case. Parse source with TypeScript AST, including nested describe prefixes and template/parameterized declarations. Source templates match actual printed substitutions; source is never executed by this parser.

`fresh-workflow-durable`: 1002 passed, 0 failed, 7441 assertions, 1002 tests across 101 files. All 1002 printed cases reconcile with the Bun summary.

Raw log: `/workspace/rox-r15-evidence-20260930/checkpoint-20261001/fresh-durable/fresh-workflow-durable.log`; SHA256 `49c016f7a8dcb4a1101bd45ac0937e051b052f15464b6f6c6ab960fcd8d9775f`.

| Source file | Passed | Failed | Skipped | Declaration rows resolved |
|---|---:|---:|---:|---:|
| `apps/electron/src/preload/openclaw-host-control.test.ts` | 2 | 0 | 0 | 2 |
| `packages/shared/src/automations/occurrence-ledger.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/calendar/calendar.test.ts` | 28 | 0 | 0 | 28 |
| `apps/electron/src/transport/__tests__/channel-map-parity.test.ts` | 4 | 0 | 0 | 4 |
| `packages/shared/src/utils/__tests__/sqlite-runtime.test.ts` | 1 | 0 | 0 | 1 |
| `packages/shared/src/browser/__tests__/profile-import-key-custody-recovery.test.ts` | 3 | 0 | 0 | 3 |
| `packages/shared/src/account-replica/__tests__/account-replica.test.ts` | 11 | 0 | 0 | 11 |
| `packages/server-core/src/webui/__tests__/oauth-callback.test.ts` | 2 | 0 | 0 | 2 |
| `packages/server-core/src/webui/__tests__/http-server.test.ts` | 11 | 0 | 0 | 11 |
| `packages/server-core/src/handlers/rpc/native-data.test.ts` | 6 | 0 | 0 | 6 |
| `packages/server-core/src/authority/__tests__/native-journal.test.ts` | 20 | 0 | 0 | 20 |
| `packages/server-core/src/authority/__tests__/native-authority.test.ts` | 10 | 0 | 0 | 10 |
| `packages/core/src/types/__tests__/error-code-omp.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/tasks/personal/things.test.ts` | 18 | 0 | 0 | 18 |
| `packages/core/src/tasks/personal/personal.test.ts` | 12 | 0 | 0 | 12 |
| `packages/core/src/rox2/__tests__/surface-context.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/rox2/__tests__/project-membership.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/rox2/__tests__/platform-contract.test.ts` | 193 | 0 | 0 | 193 |
| `packages/core/src/rox2/__tests__/onboarding-first-result.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/rox2/__tests__/notes-repository.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/rox2/__tests__/notes-engine.test.ts` | 14 | 0 | 0 | 14 |
| `packages/core/src/rox2/__tests__/meeting-conation-shell.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/rox2/__tests__/map-reduce.test.ts` | 7 | 0 | 0 | 7 |
| `packages/core/src/rox2/__tests__/conation-api.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/research/__tests__/rank.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/research/__tests__/planner.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/research/__tests__/cost-cap.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/research/__tests__/citations.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/research/__tests__/cache-policy.test.ts` | 1 | 0 | 0 | 1 |
| `packages/core/src/platform/session-apply/link-agent-teams.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/platform/session-apply/client.test.ts` | 12 | 0 | 0 | 12 |
| `packages/core/src/platform/identity/workgraph.test.ts` | 7 | 0 | 0 | 7 |
| `packages/core/src/platform/identity/store.test.ts` | 16 | 0 | 0 | 16 |
| `packages/core/src/platform/identity/revalidation.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/platform/identity/p0-adapters.test.ts` | 11 | 0 | 0 | 11 |
| `packages/core/src/platform/identity/os-discovery-host.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/platform/identity/infisical-fabric-provider.test.ts` | 6 | 0 | 0 | 6 |
| `packages/core/src/platform/identity/import-session.test.ts` | 7 | 0 | 0 | 7 |
| `packages/core/src/platform/identity/import-service.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/platform/identity/grants.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/platform/identity/github-vertical.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/platform/identity/credential-types.test.ts` | 34 | 0 | 0 | 34 |
| `packages/core/src/platform/identity/broker.test.ts` | 7 | 0 | 0 | 7 |
| `packages/core/src/platform/identity/attach-credential-ref.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/platform/agent-teams/store.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/platform/__tests__/workbench-migrate.test.ts` | 10 | 0 | 0 | 10 |
| `packages/core/src/platform/__tests__/workbench-memory-host.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/platform/__tests__/workbench-layout.test.ts` | 17 | 0 | 0 | 17 |
| `packages/core/src/platform/__tests__/workbench-flags.test.ts` | 6 | 0 | 0 | 6 |
| `packages/core/src/platform/__tests__/surfaces-registry.test.ts` | 12 | 0 | 0 | 12 |
| `packages/core/src/platform/__tests__/resources-registry.test.ts` | 9 | 0 | 0 | 9 |
| `packages/core/src/platform/__tests__/panels-registry.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/platform/__tests__/modes-registry.test.ts` | 9 | 0 | 0 | 9 |
| `packages/core/src/platform/__tests__/m3-ac-coverage.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/platform/__tests__/harness-skip-list.test.ts` | 1 | 0 | 0 | 1 |
| `packages/core/src/platform/__tests__/context-keys.test.ts` | 16 | 0 | 0 | 16 |
| `packages/core/src/platform/__tests__/commands-registry.test.ts` | 9 | 0 | 0 | 9 |
| `packages/core/src/mindmap/__tests__/session-variables.test.ts` | 1 | 0 | 0 | 1 |
| `packages/core/src/mindmap/__tests__/session-scene-graph.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/mindmap/__tests__/session-map-pin.test.ts` | 11 | 0 | 0 | 11 |
| `packages/core/src/mindmap/__tests__/session-digest.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/mindmap/__tests__/pinned-edit.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/mindmap/__tests__/pin.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/mindmap/__tests__/outline.test.ts` | 5 | 0 | 0 | 5 |
| `packages/core/src/mindmap/__tests__/materialize.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/mindmap/__tests__/layout.test.ts` | 6 | 0 | 0 | 6 |
| `packages/core/src/mindmap/__tests__/hash.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/mindmap/__tests__/enrich.test.ts` | 6 | 0 | 0 | 6 |
| `packages/core/src/mindmap/__tests__/derive-session.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/mindmap/__tests__/derive-note.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/mindmap/__tests__/derive-knowledge.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/mindmap/__tests__/barrel-renderer-exports.test.ts` | 1 | 0 | 0 | 1 |
| `packages/core/src/meetings/__tests__/model.test.ts` | 6 | 0 | 0 | 6 |
| `packages/core/src/knowledge/__tests__/refs.test.ts` | 22 | 0 | 0 | 22 |
| `packages/core/src/knowledge/__tests__/publications.test.ts` | 8 | 0 | 0 | 8 |
| `packages/core/src/knowledge/__tests__/mutations.test.ts` | 30 | 0 | 0 | 30 |
| `packages/core/src/knowledge/__tests__/inmemory-provider.test.ts` | 28 | 0 | 0 | 28 |
| `packages/core/src/knowledge/__tests__/errors.test.ts` | 13 | 0 | 0 | 13 |
| `packages/core/src/env/__tests__/blocked-subprocess-env.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/calendar/__tests__/occurrences.test.ts` | 7 | 0 | 0 | 7 |
| `packages/core/src/bases/__tests__/table-surface.test.ts` | 42 | 0 | 0 | 42 |
| `packages/core/src/bases/__tests__/surface-capabilities.test.ts` | 12 | 0 | 0 | 12 |
| `packages/core/src/bases/__tests__/programmatic-boundary.test.ts` | 18 | 0 | 0 | 18 |
| `apps/electron/src/renderer/lib/__tests__/caller-session-loading.test.ts` | 5 | 0 | 0 | 5 |
| `packages/shared/src/agent/core/__tests__/budget-process-loss-acceptance.test.ts` | 3 | 0 | 0 | 3 |
| `packages/shared/src/agent/core/__tests__/agent-budget.test.ts` | 5 | 0 | 0 | 5 |
| `packages/server-core/src/handlers/rpc/__tests__/native-workspace-startup.test.ts` | 1 | 0 | 0 | 1 |
| `packages/server-core/src/handlers/rpc/__tests__/native-startup-runtime.test.ts` | 1 | 0 | 0 | 1 |
| `packages/server-core/src/handlers/rpc/__tests__/native-self-profile.test.ts` | 1 | 0 | 0 | 1 |
| `packages/server-core/src/handlers/rpc/__tests__/native-create.test.ts` | 2 | 0 | 0 | 2 |
| `packages/server-core/src/handlers/rpc/__tests__/memory-native-acceptance.test.ts` | 3 | 0 | 0 | 3 |
| `packages/server-core/src/handlers/rpc/__tests__/browser-protected-cookie-key.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/tasks/personal/__tests__/cloud-clock-integration.test.ts` | 2 | 0 | 0 | 2 |
| `packages/core/src/conation/soup/__tests__/soup-client.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/conation/shell/__tests__/flags.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/conation/notes/__tests__/bridge.test.ts` | 13 | 0 | 0 | 13 |
| `packages/core/src/conation/dss/__tests__/dss-client.test.ts` | 4 | 0 | 0 | 4 |
| `packages/core/src/knowledge/providers/siyuan/__tests__/mutation-adapter.test.ts` | 27 | 0 | 0 | 27 |
| `packages/core/src/knowledge/providers/siyuan/__tests__/client-tree.test.ts` | 3 | 0 | 0 | 3 |
| `packages/core/src/knowledge/providers/siyuan/__tests__/adapter.test.ts` | 27 | 0 | 0 | 27 |
| `packages/core/src/knowledge/providers/siyuan/__tests__/adapter-mutations.integration.test.ts` | 6 | 0 | 0 | 6 |

`fresh-workflow-september`: 24 passed, 0 failed, 147 assertions, 24 tests across 4 files. All 24 printed cases reconcile with the Bun summary.

Raw log: `/workspace/rox-r15-evidence-20260930/checkpoint-20261001/fresh-durable/fresh-workflow-september.log`; SHA256 `586c2e794c97e9ae3d221fc38d107f709c9dc45c85a22b97a789994262596c31`.

| Source file | Passed | Failed | Skipped | Declaration rows resolved |
|---|---:|---:|---:|---:|
| `packages/shared/src/automations/scheduler-process-loss-acceptance.test.ts` | 5 | 0 | 0 | 5 |
| `packages/server-core/src/transport/__tests__/native-authorization.test.ts` | 12 | 0 | 0 | 12 |
| `packages/shared/src/agent/core/__tests__/budget-owner-process-acceptance.test.ts` | 6 | 0 | 0 | 6 |
| `packages/server-core/src/handlers/rpc/__tests__/source-status-runtime.test.ts` | 1 | 0 | 0 | 1 |

All 1026 actual printed case rows resolve to source declaration lines. The JSON contains every exact name, log line, source line, declaration expression and source-file SHA256. No case was omitted because its path contains `/tmp`.

Names mapped to loop/template declarations do not identify the data row by static evaluation; actual substitutions remain in actualName. Passed cases whose names mention optional provider skips do not establish live provider calls. This case mapping does not attest installed Electron/native OS/provider/iOS/full109/full143 acceptance.
