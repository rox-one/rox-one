# OMP RPC protocol notes (`omp --mode rpc`)

Verified empirically against `omp` v17.2.9 (2026-08-06) with probe scripts. Transport: NDJSON over stdio — one JSON object per line, both directions.

> **Current pinned runtime (2026-10-03): Rox CLI / OMP 18.4.12.** The toolchain pins `@oh-my-pi/pi-coding-agent@18.4.12` and its integrity-locked npm dependency graph. Launchers are `rox` / `rox.cmd`, with `omp` / `omp.cmd` compatibility aliases. CLI help/version use the Rox name; `OMP_APP_NAME=rox` sets upstream usage attribution. Configuration/auth remain under `~/.omp`. The PR1377 upgrade receipt records `ready`, protocol-v2 negotiation, `get_state`, a 758-model catalog in eight chunks, `set_model`, `set_host_tools`, and `extension_ui_response`; the real OmpAgent switched a model using that catalog. Those probes sent no paid model prompt. See `docs/runtime-upgrades/2026-10-03-rox-cli.json` for the dated source evidence and its retained test/typecheck limits; this historical probe is separate from the assembled integration's checks below.

> **Historical version note (2026-08-12):** the toolchain then installed **17.2.10**. Its binary was probe-verified against this document: identical ready frame (`{protocolVersion:1, supportedProtocolVersions:[1,2], maxFrameBytes:1048576, maxReassembledFrameBytes:67108864}`), `extension_ui_request` flow, `get_state` / `get_available_models` / `set_host_tools` shapes all unchanged. Earlier turn and branch evidence below remains dated.

## Bounded protocol 2 transport (2026-09-30)

The native limits are 1,048,576 bytes per physical NDJSON frame **including the newline**, 67,108,864 bytes per reassembled logical frame, and 262,144 bytes per raw chunk. The adapter validates advertised limits before negotiation, bounds stdout before readline, and validates ordered chunks, canonical base64, byte counts, UTF-8 and JSON before dispatch. Large outgoing commands use the same negotiated framing. Interrupted, malformed or incomplete frames and explicit peer `rpc_frame_error` failures release pending requests and terminate the affected child; partial messages never reach model selection or prompt dispatch. Child replacement resets transport state and ignores callbacks from the previous process. `packages/shared/src/agent/omp-rpc-transport.ts` is the canonical codec. The object-frame `OmpRpcFrameDecoder` API delegates to it for already negotiated v2 frames; production uses the raw-line guard and exact acknowledgement gate.

A historical read-only probe against managed OMP 17.2.10 returned 861 models in a 1,424,866-byte logical response, encoded as six protocol 2 chunks. Independent checks connected the native encoder and candidate decoder in both directions. That nine-file OMP suite passed 125 tests / 411 assertions. Its 17 unrelated shared typecheck diagnostics and prior runner timeouts are retained as historical measurements. The later September integration passes shared typecheck and the complete shared gate: 4,902 pass / 12 skip / 0 fail.

The first catalog did not contain the exact requested `rox/standard` route. The integrated adapter now creates a request-owned runtime profile for public Rox models, advertises the existing five public model IDs, and checks provider/model readback before a prompt. An actual managed OMP 17.2.10 metadata probe returned exactly those five IDs and `provider=rox`, `id=rox/standard`; it sent no provider prompt. Generated configuration stores the credential environment-variable name, and the selected connection's credential is passed privately in the child environment. Destroy, startup failure and predecessor/successor cleanup have behavioral coverage. A successful live R1/Memory turn still requires a valid gateway credential and provider completion/readback; metadata and fixture completion do not satisfy that gate.

## Lifecycle

1. Spawn: `omp --mode rpc` (optional flags: `--approval-mode <mode>`, `--auto-approve` yolo, `--model`, `--session <dir>`…). cwd = workspace root; OMP session files live in its own session dir (under `~/.omp`), keyed by cwd.
2. Server immediately sends `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}` followed by `extension_ui_request` (e.g. `setWidget`) and `available_commands_update`.
3. **CRITICAL (the turn-stall blocker): the host MUST answer every `extension_ui_request`.** An unanswered request blocks extension init / the prompt pipeline: after `{"type":"prompt"}` you get `success` + `agent_start` and then nothing (no `message_start`, >170 s stall). Respond with `{"id":<request id>,"type":"extension_ui_response","approved":true,"value":true}` (id as string). Once answered, the full event stream flows.
4. For a peer advertising protocol 2 with the native limits, the host negotiates `{"id":N,"type":"negotiate_protocol","protocolVersion":2}` before fetching the catalog. Enable chunking only after a successful response confirming `data.protocolVersion === 2`. Older peers retain bounded v1 behavior. A real managed 17.2.10 catalog exceeded the v1 transport limit; v1 is insufficient for that configuration.

**Requested model gate.** After startup and any branch restoration, the host resolves the requested model against `get_available_models`, sends `set_model`, and confirms the actual provider/model with `get_state` before `prompt`. This gate also runs after a child respawn and serializes runtime model updates. A qualified `provider/model` requires an exact catalog identity; suffix matching is retained only for legacy unqualified names. Missing, rejected or mismatched selections end the turn with an error without executing the prompt on the child's inherited default. Public Rox aliases require an advertised compatible catalog entry; an unrelated internal model is not inferred. This RPC gate does not establish that the selected provider authorizes a subsequent real completion.

## Commands (stdin)

All commands: `{id: N, type: <cmd>, ...}`. Response: `{id, type:"response", command:<cmd>, success:bool, data?:..., error?:string}`.

- `prompt` — `{message, images?, streamingBehavior?}`: async; success response returns immediately, events stream after. Also whole-session events.
- `steer`, `follow_up` — queue messages mid-turn.
- `abort` — `{type:"abort"}`; resolves after `AgentSession.abort` (also `abort_and_prompt {message}`).
- `new_session` — `{parentSession?}` → `data:{cancelled:false}`; resets the conversation.
- `get_state` → `data: RpcSessionState` (model, thinkingLevel, isStreaming, steeringMode, sessionId, sessionFile, tokensPerSecond, messageCount, todoPhases, …).
- `set_model` — **`{provider: string, modelId: string}`** (NOT `{model}` — that yields `Model not found: undefined/undefined`). See `model_update` event after success. Use `get_available_models` to list candidates for fuzzy matching.
- `set_thinking_level` — `{level}`; emits `{type:"thinking_level_changed", thinkingLevel}`.
- `set_steering_mode` / `set_follow_up_mode` / `set_interrupt_mode` — `{mode:"all"|"one-at-a-time"}` / `{"immediate"|"wait"}`.
- `get_last_assistant_text`, `get_messages`, `get_session_stats`, `compact`, `export_html`, `set_todos {phases}`, `bash {command}`, `get_available_models`, `set_host_tools`, `set_host_uri_schemes`, `get_subagents`, `switch_session {sessionPath}`, `branch {entryId}`, `handoff`, `set_session_name {name}`, `set_env`?? (unverified — not in RpcCommand union of v17.2.9), `stop`?? (unverified).

## Events (stdout, unsolicited)

- `agent_start` / `agent_end` — agent run bracket. `agent_end.messages` = full message array including final assistant message with `.usage` `{input,output,cacheRead,cacheWrite,totalTokens,cost{…,total}}`.
- `turn_start` / `turn_end` — turn bracket. `turn_end.message` = assistant message with `usage` and `stopReason`.
- `message_start` / `message_end` — per message (roles `user`, `assistant`, `toolResult`). `message_end` of the assistant carries the final `usage`.
- `message_update` — streaming: `.assistantMessageEvent` is one of:
  - `thinking_start` / `thinking_delta {delta, contentIndex}` / `thinking_end {content}`
  - `text_start` / `text_delta {delta, contentIndex}` / `text_end {content}`
  - `toolcall_start {contentIndex, partial}` / `toolcall_delta {delta}` / `toolcall_end {toolCall:{id,name,arguments}}`
  Each event also carries `.partial` — the full accumulated assistant message so far.
- `tool_execution_start {toolCallId, toolName, args, intent?}` — tool begins.
- `tool_execution_update {toolCallId, toolName, partialResult}` — streaming partial output.
- `tool_execution_end {toolCallId, toolName, result:{content:[{type:"text",text}],details}, isError}`.
- `extension_ui_request {id, method, ...}` — MUST be answered (see above). `method: "setWidget"` and `"cancel"` are ignorable but still answered. Dialog methods (`confirm`, `editor`, `select`) block until answered.
- `thinking_level_changed`, `model_update`?? (unverified name), `available_commands_update`, `auto_compaction_start/end`, `extension_error`.
- Permission prompts for destructive tools arrive as `extension_ui_request` (dialog/confirm) — the craft permission layer answers them; with `--auto-approve`/approval `yolo` they never appear. In default rpc mode, bash with simple non-destructive commands ran without prompts.

## Session identity / resume

`get_state.data.sessionId` + `sessionFile` identify the OMP session. Sessions persist across processes in OMP's session dir (per cwd); `new_session` starts fresh, `switch_session {sessionPath}` resumes, `--continue <id>` CLI flag continues a previous session at spawn.

NOTE (verified 2026-08-06, probe D): respawning `omp --mode rpc` with the **same** `--session-dir` does NOT auto-resume — it starts a fresh session (messageCount 0, new sessionId/file). `switch_session` is required to attach to an existing transcript.

## Branching (G3, verified 2026-08-06 with live probes)

**Entry id format.** Wire events (`message_start`/`message_end`/`get_messages`/`get_state`) expose **no entry ids**. Ids exist only in the session JSONL transcript (path = `get_state.data.sessionFile`). Each line is an entry `{type, id, parentId, ...}` where `id` is a short **8-hex** string (`"3af736d6"`) and `parentId` chains entries (`session`/`model_change`/`thinking_level_change`/`title`/`custom` entries interleave with `type:"message"` ones). Assistant message entries also carry `responseId` (a provider UUID — NOT the branchable id).

**`branch {entryId}` semantics (source-verified in agent-session.ts + probed):**
- `entryId` MUST be the id of a **user** message entry. An assistant entry id or unknown id → response `success:false`, error `"Invalid entry ID for branching"` (probed: assistant id and bogus id both fail identically).
- The fork cuts the new session at `selectedEntry.parentId` — i.e. branch history = everything before that user message. Response: `{text, images, cancelled}` where `text` is the selected user message's own text (for UI re-prompt) and `cancelled:true` only if an extension `session_before_branch` hook cancels.
- `switch_session {sessionPath}` then `branch {entryId}` from a DIFFERENT process works: the new forked transcript `<ts>_<newSessionId>.jsonl` is written into the running process's own `--session-dir`; **the parent transcript file is not modified** (verified byte-identical after fork + follow-up turn).
- Tail fork (branch after the LAST assistant message — no user entry follows it): copy the parent transcript file into the child's session-dir and `switch_session` to the copy. Full history retained, follow-up turns append to the copy, parent file untouched. The copied session keeps the same OMP `sessionId`.
- Verified end-to-end: 2-turn parent (fruits BANANA+MANGO); mid-history cut before turn 2 → branch recalls only BANANA; tail-copy → branch recalls both.

**Craft wiring (G3).** Per final assistant message, OmpAgent reads the transcript at `message_end` (OMP appends entries synchronously at `message_end` — see session-manager.ts "message_end persists the finished message"), takes the last assistant entry id, and emits `omp_turn_anchor {turnId, entryId}`; SessionManager persists `craftMessageId → entryId` into `<session>/meta/omp-turn-anchors.json`. At branch time the child OmpAgent resolves the cut: the first `user` entry AFTER the anchor becomes the `branch` arg; if none, the tail-copy strategy is used. Legacy sessions / messages without an anchor fail branch creation loudly (no silent wrong-context fork).

## Print mode (one-shot)

`omp -p "<text>"` runs one prompt non-interactively and prints the answer on stdout (verified: ~6 s for trivial prompts on rox gateway). Used for `runMiniCompletion`/`queryLlm`.

## Verified event order for a tool-using turn

```
ready → extension_ui_request(setWidget) → available_commands_update
response(prompt, success) → agent_start → turn_start
→ message_start(user) → message_end(user)
→ message_start(assistant) → message_update(thinking_*) → message_update(toolcall_*) → message_end
→ tool_execution_start → tool_execution_update(*) → tool_execution_end
→ message_start(toolResult) → message_end(toolResult)
→ turn_end → turn_start → message_start(assistant) → text deltas → message_end (usage) → turn_end
→ agent_end
```

## ROX history restoration and mandatory modes (2026-10-03)

The adapter now restores its exact native transcript on **every process spawn**, before model selection or a user prompt. `omp/active-session.json` records the active native session UUID and a confined local filename atomically. Old mirrors without this sidecar are discovered by the saved UUID and transcript header; multiple unidentified candidates fail explicitly. A subprocess's initially empty `get_state` must not overwrite the saved identity before restoration. `clearHistory` writes a persistent reset marker and preserves the archived native transcript. A subsequent process reconstructs any retained ROX history rather than restoring discarded messages.

OMP 18.4.12 adds `fork {entryId}`. It keeps the root-to-selected entry path **inclusive**, retains recorded results of complete assistant tool-call batches, and copies native artifacts. ROX first copies the parent transcript and its artifact directory into the child's directory, switches to that private copy, then forks the exact assistant anchor. The parent remains untouched. A restarted child resumes its own active identity rather than applying the parent fork again. Both `switch_session` and `fork` cancellation are errors before any provider prompt.

Sessions predating native OMP transcripts can receive a one-time transcript reconstruction from all persisted ROX user/assistant messages and paired tool call/result records. The transcript contains a `rox-history-reconstruction` provenance entry. This preserves stored conversation text and tool results, but cannot recover provider metadata, thinking or image bytes which ROX never stored. Branch reconstruction receives only the parent messages through the selected visible answer. The current pending user submission is excluded from ordinary reconstruction, avoiding a duplicate turn.

Every user prompt sent over RPC includes standalone prose `orchestrate workflowz ultrathink`; an existing initial prose directive is reused. Original ROX message text remains unchanged. `set_thinking_level {level:"max"}` is acknowledged before each prompt; OMP resolves effort against the selected model's supported ladder. The private runtime profile enables native `magicKeywords.enabled`, `magicKeywords.ultrathink`, `magicKeywords.orchestrate`, and `magicKeywords.workflow` (the setting ID differs from the trigger word `workflowz`), `eval.js`, `eval.tools.enabled` and the maximum automatic thinking ceiling. Native orchestrate/workflow notices additionally require actual `task` and `eval` capabilities. These directives are runtime behavior, not a promise that every simple task spawns subagents.

Internal native workers need a separate boundary: OMP resolves caller effort, explicit model suffix and specialist defaults before creating their sessions (scout defaults to medium). Every managed profile therefore loads the standalone `rox-worker-policy.js` extension. OMP 18.4.12 forwards prepared extension factories and rebinds them to task, eval and restricted child sessions (`sdk.ts` and `task/executor.ts`); the extension sets maximum supported thinking in `before_agent_start` and again in `context` for continuations. `task.maxEffort=max` prevents a project ceiling from undoing this policy. A native `tool_call` input revision prefixes task assignments before child delivery, preserving batch structure, agent selection, tool restrictions and caller effort fields. The extension appends the mandatory system instruction and prefixes user text in the provider context projection, leaving stored user history, images, tool results, tool admission, permission checks and spawn depth limits intact. It neither registers tools nor enables task/eval for a restricted specialist.

The worker directive and native keyword notices are separate mechanisms. Native matching runs before extension lifecycle/context hooks, so ROX also prepares a private source-complete OMP 18.4.12 overlay, verified against the original `agent-session.ts` SHA-256 `a51e06caf5e5f382c7f80c86030ae13a70ed4c7d0c1ac9f6d6ffc11c20d2c81e`. It prefixes ordinary user text **after** native slash/template expansion and **before** keyword matching, handles custom user skill arguments and queued user steer/follow-up messages, and retains native synthetic attribution. Image-only user prompts acquire a text directive while preserving their image blocks. The installed native package remains unchanged. All source modules are copied into the private overlay; dependencies/assets directories are linked (junctions on Windows) and ordinary package files are copied. RPC and one-shot processes launch the overlay's `src/cli.ts` with the resolved Bun runtime. A different version, altered source or production external executable without this verified package fails explicitly before prompting. The protocol test executable is exempt only under `NODE_ENV=test`.

Native notices remain capability-dependent: the overlay does not enable `task` or `eval` for restricted specialists. `docs/evidence/omp-native-worker-policy-0.11.8.json` records actual native extension loading, child factory rebinding and native ModelControls clamping from medium to the fixture model's maximum (high for bundled gpt-5), with zero registered tools and zero provider requests. This is a handler and model-control fixture, not a full worker provider loop or installed-app acceptance.

The separate full-loop proof `docs/evidence/omp-native-worker-loop-0.11.8.json` exercises an actual native SDK parent prompt, `task` dispatch, child provider loop, terminal `yield` and parent continuation. Its native in-memory mock provider records the actual request context and reasoning option; every `fetch` is forbidden. The parent starts with `auto`, the specialist defaults to `medium`, and the caller requests `effort: lo`; every parent/child agent request reaches the mock with `high`, its model's maximum supported effort. Actual child tools stay `read` plus required native `yield`: neither `task` nor `eval` is granted. The child receives the inherited system directive and bare user-context words, while only the capability-appropriate native ultrathink notice appears. Seven actual lifecycle/context/tool hooks and the completed task result are recorded. Native task label generation is a separate tool-free auxiliary completion outside AgentSession hooks, with no explicit reasoning option; its text inherits the assignment keywords. This proof covers the worker loop, not an installed application or remote provider.

Reproduce without external API access using the pinned toolchain: `apps/electron/vendor/bun/bun scripts/probes/omp-worker-loop.ts /tmp/rox-native-worker-loop.json`. `ROX_OMP_PACKAGE_DIR` can select another local package path, but the probe rejects versions other than 18.4.12 and removes its isolated runtime files on completion.

The additional `ROX_OMP_NATIVE_POLICY=1` mode records the private pre-matcher overlay, raw user input, image preservation, expanded slash templates, custom skill arguments, steer/follow-up notices and unchanged synthetic notice semantics in `docs/evidence/omp-native-required-modes-0.11.8.json`. An independent native SDK run also exercised the real RPC skill builder, a local extension slash handler with exact arguments and no model call, and synthetic queued messages; see `docs/evidence/omp-native-required-modes-independent-0.11.8.json`. These use an actual native parent/child loop and deterministic in-memory model with zero network attempts or paid requests. All parent/child AgentSession provider requests have `high`, the fixture's supported maximum, and the restricted child retains only `read`/`yield` with only the permitted ultrathink notice. Neither source fixtures nor compiled-resource extraction establish installed application or Windows filesystem acceptance.

The no-provider-call OMP 18.4.12 fixture in `docs/evidence/omp-native-history-0.11.8.json` verifies native `switch_session`, exact assistant `fork`, child-directory isolation, parent byte preservation, and a second process restoring the fork. Discovery was isolated using `--no-extensions --no-skills --no-rules` and disabled unrelated plugin providers; it does **not** constitute full installed-app acceptance or live model/tool/image verification. The host still reported startup discovery phases lasting 23–58 seconds, so ROX now uses a bounded 90-second ready wait with the existing typed timeout diagnostics.
