# Runtime trace storage and cancellation evidence

The collector records execution observations alongside the canonical session transcript. It does not create an execution authority or infer executor results from formatted text.

## Production delegation and compatibility

`packages/server-core/src/sessions/runtime-trace/delegation-compat.test.ts` launches isolated subprocess fixtures with temporary configuration and workspace storage. The spawn fixture invokes the production `SessionManager` spawn callback through the actual `OmpAgent` host RPC dispatcher. A fake CLI supplies the NDJSON request; the normal callback creates a canonical child session, records its actual delivered prompt and starts the injected child executor. The fixture checks the durable root/child identity, canonical `parentSessionId`, actual saved child prompt and recovered child-alias journal. This is a production dispatcher/storage integration fixture, not a live native/provider smoke.

The legacy fixture writes an older canonical JSONL transcript, adds a runtime trace sidecar, verifies exact original transcript bytes and canonical readback, then removes only that sidecar in its isolated temporary workspace to simulate rollback. Original messages and transcript bytes remain unchanged.

## Real shell evidence and cancellation limits

`packages/session-tools-core/src/handlers/host-bash.test.ts` executes a real local shell that writes separate stdout/stderr and exits with code 7. Its timeout fixture kills the actual timed-out process tree and verifies that the command's late stdout does not appear as completed work.

`packages/server-core/src/sessions/runtime-trace/cancellation.test.ts` invokes real local Bash through the production `OmpAgent` host RPC dispatcher and the session-tool handler. The fake CLI supplies actual `host_tool_cancel` transport frames; the second scenario calls the real model abort method. The shell independently writes a completion marker after cancellation. Both fixtures verify an explicit `unconfirmed-host-process-termination` coverage gap, no fabricated terminal completion/exit/final duration, no late stdout delivery, no stale host result and no original tool identity in the successor run. The actual durable recovered snapshot retains that gap.

The current host executor has no AbortSignal cancellation API. Transport/model cancellation therefore cancels delivery; it does not prove that the independently executing host process was terminated. The trace preserves this distinction. Only actual executor completion or timeout kill evidence can establish terminal results.

## Execution identity across prompts

Each `sendMessage` iterator retains the actual `RuntimeTraceRun` returned by its own recording boundary. Context, tools, native observations, answer publication and passive run completion use that captured origin; failed recording uses an explicit unavailable origin and cannot inherit a successor. Tool/provider/native/background registries retain separate run identities and immutable launch attempts. Precise terminal suppression also includes the attempt.

The background task launch alias has precedence over the iterator which delivers a later notification. Reused aliases or an unscoped reused tool/turn identity produce partial coverage (`ambiguous-execution-origin`) and no guessed action. Idle journal LRU eviction prunes its corresponding correlation entries; an unscoped late output after eviction cannot attach to the active prompt. An explicitly retained original iterator can still record and recover the exact old run.

## Privacy and scope

Service fixtures inspect inline transport, persisted journal and content blobs for quoted credentials, JSON credentials, cookie headers and nested environment secrets. Valid-schema recovered rows outside the authorized workspace/root run/root session are rejected, cannot authorize content references and mark recording coverage partial. Every existing lineage ancestor must remain in the authorized workspace. Recovered prompts and verified content blobs also redact secrets registered after recording.

## Executed checks

All commands use the installed Bun binary. The cancellation/service/session/startup/host-shell suite passed **63 tests, 277 Bun assertions**, exit **0**. After adding originating-tool correlation, the focused cancellation/service/delegation/RPC suite passed **27 tests, 143 assertions**, exit **0**, including a deterministic queued cancellation arriving after a successor prompt. The earlier journal/service/delegation/RPC suite passed **33 tests, 173 assertions**, exit **0**. The host-shell/TaskRunner/Conductor suite passed **47 tests, 175 assertions**, exit **0**. Signed native authorization/transport/membership and renderer ingress checks passed **49 tests, 414 assertions**, exit **0**.

The final captured-origin cancellation/service/delegation/RPC suite passed **36 tests, 190 assertions**, exit **0**. It additionally covers reused tool and provider IDs across prompts, old retry/completion, failed begin suppression, successor delivery of old background notifications, ambiguous repeated background IDs, immutable launch attempts, repeated native child emitters and LRU correlation eviction.

These checks cover isolated Linux local execution, canonical storage, fake CLI transport and signed authority fixtures. They do not claim installed macOS/Windows smoke, live account access or live provider execution.
