# Runtime map: independent contract and authorization review

Reviewed integrated commit `f7690a5b5157cc7eb95b475c7e2ec5523034bf07` on 2026-10-03, including the production wiring documentation at `f81454d01` and subsequent public-export and compatibility changes. This review was performed by the projection owner against the integrated transport, server and native implementations owned by other agents. It is a scoped source review and fresh offline verification; it does not replace the independent renderer acceptance report.

No concrete remaining contract, facade dispatch, authorization or correlation defect was found in the surfaces below.

## Reviewed contract and actual production paths

| Boundary | Evidence and result |
| --- | --- |
| Core contract exports | `packages/core/package.json` exports `@rox/core/runtime-trace` and extensionless runtime-trace subpaths. `packages/core/src/runtime-trace/index.ts` exports types, validators, projector, correlation, metrics and coverage. Runtime `ContextSnapshot` remains confined to the runtime subpath, preserving the existing knowledge contract. An actual Bun import resolved the exported functions and validated all 16 canonical fixture events. |
| Shared protocol and renderer types | `packages/shared/src/protocol/runtime-trace.ts` reexports the same canonical query, snapshot, page and event types through `protocol/index.ts`; `protocol/dto.ts` carries trace and passive health through the existing `SessionEvent` union. `apps/electron/src/shared/types.ts` defines the three matching typed read methods. No separate event protocol or action authority was introduced. |
| Desktop facade | `apps/electron/src/preload/bootstrap.ts` builds the facade with `buildClientApi` from `apps/electron/src/transport/build-api.ts` and `CHANNEL_MAP` from `apps/electron/src/transport/channel-map.ts`. The trace methods map directly to `runtimeTrace:getSnapshot`, `runtimeTrace:readEvents` and `runtimeTrace:readPayload`. |
| Web facade | `apps/webui/src/adapter/web-api.ts` imports the same facade builder and channel map and returns the same `ElectronAPI`; its browser overrides do not replace the trace methods or `onSessionEvent`. `adapter/transport-bootstrap.ts` requires the exact authenticated workspace ACK before mounting. |
| Routing and registration | All three trace channels are in `REMOTE_ELIGIBLE_CHANNELS` in `packages/shared/src/protocol/routing.ts`; the exhaustive routing suite finds no overlap or unclassified channel. The actual registrar is `packages/server-core/src/handlers/rpc/runtime-trace.ts`, called from `handlers/rpc/index.ts`. All three registrations declare `nativeAction: 'read'`. |
| Single renderer event source | `apps/electron/src/renderer/App.tsx` has one `onSessionEvent` subscription. Its callback first checks the captured session-scope identity, resolved authority and workspace. Trace and passive health enter the shared ingress before ordinary message processing; the existing effect returns the subscription cleanup. The hook, map components and catalog integration introduce no additional live subscription. |
| Snapshot authorization | The registrar validates scope, run IDs and bounds, checks request workspace against query workspace, resolves the actual session in that workspace, and checks native membership/current request both before and after awaited reads. It never executes a model, tool or runtime action. |
| Native permission fence | `packages/server-core/src/transport/server.ts` requires the existing native read grant and captures its permission fence. Fresh socket tests confirm that revoke/regrant during an outstanding request withholds both successful private data and private error contents; subscription revocation and reconnect identity checks also hold. |
| Journal and payload ownership | `sessions/runtime-trace/service.ts` validates session/workspace and recorded run ownership. Child root links must resolve to an actual ancestor in the same workspace. Blob reads require an opaque 64-character hash referenced by that run; the journal rejects traversal, tampering and symlinks and restores its aggregate quota after restart. Native principals cannot read host blobs. |
| Native trace projection | `handlers/rpc/native-session-scope.ts` preserves event identity/cursor while redacting delivered child prompts, actual context contents, skill instructions, tool arguments/output, terminal command/cwd/shell/errors and all blob references. Recording-health host diagnostics are replaced with generic text. Root user input remains conversation content. Fresh regressions cover these boundaries. |
| Native correlation and evidence | `packages/shared/src/agent/omp-runtime-observer.ts` captures actual hooks, scrubs the full record before persistence and binds delayed children to their actual dispatch generation. `omp-runtime-trace-bridge.ts` scopes emitter identity by generation and native session, deduplicates raw sequences, rejects old turns, marks gaps and cumulative snapshots, and retains actual tool IDs. `omp-agent.ts` also rejects callbacks from superseded observers/invocations. Fresh tests preserve nested child identity, real host stdout/stderr, explicit exit status and genuinely started fallback attempts. |
| Passive health and snapshot race | The existing ingress validates event/health scope, merges in-flight live events with the snapshot, deduplicates delivery, catches up gaps through reads, and invalidates deleted-session generations. Passive health changes coverage without manufacturing a canonical event or sequence. Authorized child aliases receive canonical rooted live events. |
| Public export | `components/runtime-map/public-metadata.ts` exports only allowed topology/status/measurement fields with export-local opaque identities. Payloads, labels, private identifiers, paths, producer provenance text and coverage reasons do not cross this boundary. Fresh malicious-metadata tests pass. |

## Fresh verification

All commands ran from the integrated repository root with its existing isolated Bun test preloads. `BUN` below denotes `/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun`.

| Command | Result |
| --- | --- |
| `$BUN test apps/electron/src/transport/__tests__/channel-map-parity.test.ts packages/shared/src/protocol/__tests__/routing.test.ts packages/server-core/src/handlers/rpc/__tests__/runtime-trace.test.ts apps/electron/src/renderer/event-processor/__tests__/runtime-trace-ingress.test.ts` | Exit 0; 45 passed, 0 failed; 4,344 assertions. |
| `$BUN test packages/server-core/src/transport/__tests__/native-authorization.test.ts packages/shared/src/agent/__tests__/omp-runtime-observer.test.ts` | Exit 0; 28 passed, 0 failed; 136 assertions. |
| `$BUN test apps/webui/src/adapter/web-api.test.ts apps/webui/__tests__/transport-bootstrap.test.ts apps/electron/src/renderer/components/runtime-map/__tests__/public-metadata.test.ts` | Exit 0; 30 passed, 0 failed; 73 assertions. |
| `$BUN test packages/server-core/src/sessions/runtime-trace/service.test.ts packages/server-core/src/sessions/runtime-trace/journal.test.ts` | Exit 0; 18 passed, 0 failed; 106 assertions. |

Total: **121 passed, 0 failed, 4,659 assertions across 11 files**. No paid provider requests, external account connections or user data were used.

An additional actual `buildClientApi` smoke with a recording RPC client invoked the three trace methods with their real query objects. Its result was `channels: [runtimeTrace:getSnapshot, runtimeTrace:readEvents, runtimeTrace:readPayload]`, `scopePreserved: true`, and zero subscriptions from those reads. Calling the existing `onSessionEvent` attached exactly `session:event`. Core `buildRuntimeGraph`, `createRuntimeProjection` and `reduceRuntimeEvent` imports resolved as functions, and every canonical fixture event passed `isRuntimeEvent`. Exit 0.

## Limits

This review did not run the full typecheck or full repository baseline again. Bun runtime parity tests execute their runtime checks; their compile-time generic assertions require the separately recorded TypeScript gate. Browser rendering/performance and simultaneous chat/map recordings are covered by the separate validation evidence, not by these tests.

The observer tests exercise the actual prepared extension factory and bridge offline. The local native SDK full child-loop probe remains blocked by the recorded native file-lock limitation in this environment; hosted native acceptance and installed Windows/macOS smoke are not established by this review. Existing integrity checks, permission responses and model readback were not bypassed.

Journal content and resident journal caches have explicit bounds; compact late-event identity mappings are intentionally retained. This review does not claim a global finite bound on all retained server history or every identity mapping.

The production-file inspection above is limited to the stated commit. This evidence document introduces no product changes.
