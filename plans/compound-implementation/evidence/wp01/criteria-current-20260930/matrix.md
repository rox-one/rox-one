# WP-01 independent 54-row criterion matrix

Source HEAD: 8106f22185fb3b3e9a6a585320d48b1bf5f10fbd
Normative SHA256: f35f93b138670131da4a0c8a56926974b89f3f477f995e69cbe26106b7cb13c5
Criterion rows: 54; full native and package DoD pending.

| ID | Criterion | Status | Actual evidence / pending leaf |
|---|---|---|---|
| B1 | transport-authenticated Actor | VERIFIED | independent-current-holdout, root-offline-mechanism |
| B2 | workspace membership | VERIFIED | independent-current-holdout, root-offline-mechanism, root-domain-observability |
| B3 | minimal Project identity row | VERIFIED | independent-current-holdout, root-domain-observability, root-response-schema |
| B4 | owner-only policy enforced server-side | VERIFIED | independent-current-holdout, root-domain-observability |
| B5 | Project create transaction+idempotent receipt | VERIFIED | independent-current-holdout, root-domain-observability, root-real-process-crashes |
| B6 | native Project RPC/list/detail | PENDING | root-native-mechanism, root-offline-mechanism, root-native-failed; Actual native routing API mechanism passes; successful creation/open/list/detail through rendered two-profile Electron UI is pending. |
| A1 | A opens private Project in native ROX | PENDING | root-native-mechanism, root-native-failed; Actual native routing API mechanism passes; successful creation/open/list/detail through rendered two-profile Electron UI is pending. |
| A2 | B without membership gets 403 and no title through RPC/HTTP | VERIFIED | independent-current-holdout, root-offline-mechanism |
| A3 | client cannot forge principal/workspace | VERIFIED | independent-current-holdout, root-offline-mechanism |
| UI1 | loading | PENDING | root-native-failed, root-engine-control; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| UI2 | empty | PENDING | root-native-failed, root-engine-control; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| UI3 | permission_denied | PENDING | root-native-failed, root-engine-control; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| UI4 | offline_queued | PENDING | root-offline-mechanism, root-offline-mechanism, root-offline-mechanism, root-offline-mechanism, root-native-failed, root-engine-control; Queue mechanism verified by actual PG/HTTP/WS/SIGKILL/immutable encrypted bytes and fences; rendered queue/retry/cancel/restart acceptance is still pending. |
| UI5 | retryable_error | PENDING | root-offline-mechanism, root-native-failed, root-engine-control; Actual retry denial/terminal-state mechanisms pass; rendered retryable-error state leaf is still pending. |
| UI6 | applied_verified | PENDING | root-response-schema, root-native-failed, root-engine-control; Actual applied/receipt_verified canonical body passes schema/PG/restart; native applied_verified rendering remains pending. |
| T1 | A opens private Project in native ROX; B without membership gets 403 and no title through RPC/HTTP; client cannot forge principal/workspace | PENDING | independent-current-holdout, root-native-mechanism, root-native-failed; API and native-routing mechanism portions pass; A opens Project in rendered native ROX still pending. |
| T2 | Seed broken identity boundary: unauthorized actor or dropped/duplicated event must fail WP-01 acceptance | VERIFIED | root-domain-observability, root-domain-observability, independent-current-holdout |
| T3 | Restart between persisted command and reply while running Private shared Project: authenticated actor and workspace boundary; state/receipt/canonical ID remain consistent | VERIFIED | root-real-process-crashes, root-offline-mechanism |
| HOLDOUT | independent evaluator injects second failure variant | VERIFIED | independent-current-holdout |
| SCHEMA | strict request, body Actor and workspace schema | VERIFIED | root-domain-observability, root-offline-mechanism, root-offline-mechanism |
| MIGRATION | identity, ownership and idempotency constraints; startup migration replay | VERIFIED | root-domain-observability, root-domain-observability, root-real-process-crashes, root-cold-receipt |
| EVENTS | transaction events, revisioned invalidation and replay cursor | VERIFIED | root-domain-observability, root-offline-mechanism, root-domain-observability, root-real-process-crashes |
| OBS1 | commandId | VERIFIED | independent-current-holdout, root-response-schema |
| OBS2 | causationId | VERIFIED | root-domain-observability |
| OBS3 | correlationId | VERIFIED | root-domain-observability |
| OBS4 | aggregateRevision | VERIFIED | root-domain-observability |
| OBS5 | policyEpoch | VERIFIED | root-domain-observability, root-domain-observability |
| OBS6 | projectionWatermark | VERIFIED | root-domain-observability, root-real-process-crashes |
| OBS7 | retry/DLQ counters | VERIFIED | root-domain-observability, root-domain-observability |
| PRIVACY | no raw email/body/transcript/tokens in logs | VERIFIED | root-domain-observability, root-offline-mechanism, root-domain-observability |
| FC1 | UI | PENDING | root-native-mechanism, root-native-failed; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| FC2 | routing | PENDING | root-native-mechanism, root-native-failed; Actual native RPC/local host routing parity passes; rendered routing/deep-link acceptance remains pending. |
| FC3 | entity model | VERIFIED | root-domain-observability, root-response-schema |
| FC4 | persistence | VERIFIED | root-real-process-crashes, root-offline-mechanism |
| FC5 | commands | VERIFIED | root-domain-observability, root-offline-mechanism |
| FC6 | queries | VERIFIED | independent-current-holdout, root-domain-observability |
| FC7 | realtime where needed | VERIFIED | root-offline-mechanism, root-domain-observability, root-offline-mechanism |
| FC8 | permissions | VERIFIED | root-offline-mechanism, root-domain-observability |
| FC9 | sharing | VERIFIED | root-domain-observability, independent-current-holdout |
| FC10 | search | DEFERRED_BY_DECLARED_WP01_SCOPE | No search operation or target surface is declared in WP-01; Search scoped by actor is WP-06 after WP-04. |
| FC11 | mentions | DEFERRED_BY_DECLARED_WP01_SCOPE | Cross-entity extraction/resolution/removal is WP-09 with WP-08/WP-07/WP-06 predecessors. |
| FC12 | notifications | DEFERRED_BY_DECLARED_WP01_SCOPE | List/seen/done/SubscribeActivity is WP-07 after WP-04/WP-03. |
| FC13 | activity | DEFERRED_BY_DECLARED_WP01_SCOPE | Own reference events exist; general user activity feed is WP-07. |
| FC14 | agent access | DEFERRED_BY_DECLARED_WP01_SCOPE | No execution allow-all argument overrides current API ACL. Per-kind agent/MCP actions are WP-36. |
| FC15 | API/MCP where applicable | VERIFIED | root-response-schema, root-offline-mechanism |
| FC16 | observability | VERIFIED | root-domain-observability, root-domain-observability, root-domain-observability |
| FC17 | tests | PENDING | independent-current-holdout, root-domain-observability, root-domain-observability, root-response-schema, root-native-failed; Scoped actual tests and unchanged independent second variant pass; required full primary/offline Electron tests and screenshot review are still pending. |
| FC18 | documentation | VERIFIED | ACTUAL_DOCUMENT_READBACK, ACTUAL_DOCUMENT_READBACK |
| FC19 | failure states | PENDING | root-offline-mechanism, root-domain-observability, root-offline-mechanism, root-native-failed; Actual denied/rollback/revoke/corrupt/offline failure mechanisms pass; required rendered failure-state acceptance remains pending. |
| FC20 | loading states | PENDING | root-native-failed; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| FC21 | empty states | PENDING | root-native-failed; Actual full native UI leaf for this criterion is not yet supplied. Native routing/PG mechanisms do not prove its rendered UI acceptance. |
| FC22 | offline/reconnect where applicable | PENDING | root-offline-mechanism, root-offline-mechanism, root-offline-mechanism, root-offline-mechanism, root-native-failed; Actual offline encrypted persistence/restart/retry/cancel/session fences pass; rendered native queue/reconnect acceptance remains pending. |
| GATE | No complete status until real changed surface and relevant failure/reload path observed; fixture is not live receipt | PENDING | independent-current-holdout, root-native-failed; Full primary native + offline native + viewed screenshots/theme/200-percent/narrow/restart/revoke receipts and source-bound commit/push/readback are pending. Package remains incomplete. |
| RESPONSE_SCHEMA | Declared Project canonical response JSON Schema agrees with actual HTTP/WS response | VERIFIED | root-response-schema, root-response-schema, root-response-schema |

Engine control is mechanism evidence only. All complete rows cite actual leaf hashes and exact passing cases/assertion/source hashes in matrix.json. No source presence is treated as runtime proof.
