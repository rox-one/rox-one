# Independent merge 47b5 contract review

Review scope: source inspection only. No provider calls, accounts, sockets, live user data, installed-app smoke, browser timing, or heavy checks were executed by this reviewer. The merged source inspected was `e0e1e498f251f87d07cad912ec7e7dd2b5a47181`, combining incoming main `47b5fcd270ff7abff163533b60f4d9fa5d5f8f27`. W1 resolved SessionManager and W2 resolved OMP ownership conflicts. The overview proposal inspected independently was W4 commit `44c4739ba`.

| Contract | Source inspection result |
| --- | --- |
| Runtime launch and Pocket owner remain separate | `handlers/rpc/sessions.ts` combines validated `runtimeLaunch` with host-captured `roxExecutionContext` in the existing ninth SessionManager context. Launch telemetry does not select a cloud caller, credential, native grant, or permission mode. Invalid launch telemetry becomes unknown. Native options are still stripped. |
| Native write authorization survives account capture | Native memory context construction rechecks the existing native inbox write boundary after awaited Pocket account capture; SessionManager checks it again before prompt work. |
| Iterator and background custody | `SessionManager.processEvent(managed, event, originRun?, suppliedExecution?)` receives both captured run and captured Pocket owner from the chat iterator. Idle background delivery supplies undefined run plus its captured owner. Passive collector awaits are followed by owner checks; final assistant messages are pushed only after the post-await check. |
| Delegated launches retain privacy provenance | The spawn helper captures its trace parent synchronously before asynchronous creation, retains the inherited execution context, and dispatches with explicit delegated launch metadata. Cross-session agent messages retain both inherited execution context and delegated sender trigger. |
| Original user exception remains narrow | Native trace projection requires an observed manual root request with a real message ID and no parent agent. Task-verdict artifact provenance remains excluded from the native answer exception. Context, host tools, terminals, memory, skills, plans and artifact content remain redacted. Native payload paging remains denied. |
| Trace reads remain reads | Snapshot/events/payload registrars use the existing read RPC boundary, check session/workspace authorization before and after awaiting storage, and do not invoke runtime actions or account inference. The existing facade/channel map carries the three typed queries. |
| One event source | App keeps one existing `onSessionEvent` callback. Its workspace/authority generation guard precedes runtime trace/health ingress; neither map projection nor the read facade adds a live subscription. |
| Explicit overview is presentation | W4 retains original runtime node objects and actual event/node/agent/span/edge identities and canonical sequence. Only position maps, lane geometry, camera presentation and CSS change. Columns represent sequence rank within each actual agent lane, with an explicit overview caption. Normal global chronology and time layout remain available. |
| Overview exit and folding | Focus/latest/click/selection and timeline-mode changes restore normal coordinates and reading zoom. Saved cameras include their overview presentation. Collapsed actual window lane headers remain present so expansion stays available; collapsed card positions are omitted. Geometry memoization uses topology, window IDs and collapse state, rather than output text deltas. |

One concrete integration gap was reported and accepted by the coordinator for repair: newly created task-draft and TaskRunner child dispatches carried launch provenance but had no captured Pocket execution owner. The incoming public ROX-model gate therefore failed closed for a previously unbound task session. The follow-up below closes this propagation gap. This review does not establish a production browser budget.

The proposed repair captures the real initiating caller at the existing authorized RPC, retains that immutable owner through draft repairs and active TaskRunner child/verdict dispatches, and preserves existing launch provenance. Cross-restart resume must prove the original task run owner: a current parent binding alone cannot establish it if that parent was rebound after the run began. Existing account binding storage can retain that custody without becoming a new task execution authority or credentials store. Missing or mismatched custody must fail closed.

Inspected merged Git blob identities:

| File | Blob |
| --- | --- |
| `packages/server-core/src/sessions/SessionManager.ts` | `e9719048484063a0edc1385f151fb1cf59d5c338` |
| `packages/server-core/src/handlers/rpc/sessions.ts` | `3864d6f4f9949039595c0d7274ed3c804f60e4a0` |
| `packages/server-core/src/handlers/rpc/native-session-scope.ts` | `c40d9339a80a5c97aa9961bb30a540435c66f6e4` |
| `packages/shared/src/agent/omp-agent.ts` | `67ff0c6a36d854bd45d02c47a9885d187b42a4a4` |
| `apps/electron/src/renderer/App.tsx` | `0b43035bd37b3fff96d4531fabb787ac0a57c35b` |

## Sealed task-owner follow-up

Independently inspected W1 source commit `9c7f3f4fb592393387931bfb122c945fbd769229`, then confirmed identical production blobs in integrated root commit `72a5e15f0f3c0ef38ae70a87999a3c9a0a7325e4`. The existing account-authority policy repair is reviewer-owned commit `c42e5168f`; its production blob also matches the integrated root. No remaining concrete defect was found in this scope.

| Boundary | Verified source behavior |
| --- | --- |
| Draft creation and repairs | The existing GENERATE RPC captures the real initiating caller before creating a session, rechecks it after awaited creation and before each repair, and supplies that same execution context separately from unknown launch provenance. |
| Initial TaskRunner dispatch | The existing RUN RPC captures its caller and binds the actual parent through the existing account authority. ActiveRun seals `task-run:<workspaceId>:<slug>:<runId>` before child creation and freezes its captured execution context. Child and verifier dispatches use that original context and retain their delegated/unknown launch provenance. |
| Awaited creation and account switch | Current-owner checks surround asynchronous child creation and occur again before dispatch. Logout or generation change during creation prevents a model send. |
| Resume custody | Rehydration resolves only the exact sealed run owner. It does not use a mutable parent binding to establish the owner of an earlier run. RPC RESUME compares caller, cloud account and auth generation before resume; a missing seal, foreign caller or changed generation fails closed without rebinding. |
| Atomic binding | The existing serialized bind operation treats task-run resources like sealed queued-message custody: the first caller is exclusive and cloud-account/auth-generation are immutable. A store without binding readback cannot claim sealed task custody. This adds no credentials store, scheduler or task execution authority. |
| Resource identity | Workspace aliases resolve before runner caching and resource construction. Existing safe-path validation rejects ambiguous slug/run IDs; aliases cannot create a second runner to bypass the existing active-task guard. |

The actual fixture reaches the production GENERATE handler, SessionManager and backend-factory owner boundary, then deliberately stops before a provider call. A separate deterministic executor exercises the automatic repair loop. Real TaskRunner and persisted task files exercise child/verifier custody, a logout barrier with zero dispatches, restart with a rebound parent, canonical workspace aliases, foreign and rotated-generation resume rejection, and a legacy run without a seal. These are local production-path integration checks with injected execution and isolated temporary data; they are not paid-provider or native-loop evidence.

| Check | Execution and result |
| --- | --- |
| Policy negative control | Reviewer executed the existing authority test file with `--test-name-pattern task-run` before the policy change: exit 1, two failures. Concurrent foreign replacement and same-caller generation replacement incorrectly succeeded. This result exists in the tool transcript only; no separate raw negative-control log was saved. |
| Existing authority suite | Reviewer executed `bun test packages/shared/src/auth/__tests__/rox-account-authority.test.ts`: exit 0, 19 tests and 97 assertions. Existing account/session/queued-message tests remained green. |
| W1 focused production suite | Owner-executed receipt `w1-pocket-task-owner-final.log`: exit 0, 54 tests across 6 files, 251 assertions, 5.43 seconds. Includes actual SessionManager ownership, draft helper, TaskRunner, shared authority, task RPC custody and runtime-launch producer suites. The reviewer read the raw receipt and reviewed the production fixture; the suite was not rerun during the coordinator's serial final gates. |

Raw receipts inspected in this workspace:

- `task-account-custody-green.log`, SHA-256 `ce799b1c15ce5e5520a2c0b89afe47ef425d28e0f6e74b875986209bf7dc4a61`.
- `runtime-receipts/w1-pocket-task-owner-final.log`, SHA-256 `c1370dc73910af04adcb9c285ac51bfd0f0ef4ab2b9730c34db7edaa069ec41f`.

The coordinator subsequently preserved these two green receipts under `docs/evidence/runtime-map/owner-integration/` in commit `de1d`. That receipt directory also contains W1's independently recorded task-owner baseline failures; those are distinct from the reviewer's unsaved policy negative-control transcript. There is no `task-account-custody-red.log` artifact.

| Final production file | Git blob |
| --- | --- |
| `packages/server-core/src/handlers/rpc/tasks.ts` | `5961d86fb5fdd849b638a2804ef5ad4b91d3667e` |
| `packages/server-core/src/tasks/TaskRunner.ts` | `68460c4e44e66687b9cb4e27c7599c6279ef4593` |
| `packages/shared/src/auth/rox-account-authority.ts` | `6042b281dfb897ac0ca1f4d7945a305c6c6b90ec` |

Final compiler, build, browser timing and installed-platform results remain coordinator/W8 evidence. This independent follow-up validates the scoped owner-custody repair and records its precise source and local test limits.

## Native declared-tool schema follow-up

Read-only review of exact source commit `24d02cfa4ad24065a278378c5356d8244e40a93a` found and closed an accessor regression in the new schema-capture helper. Its initial direct metadata and `toJsonSchema` property reads could invoke getters before sanitization. Final source reads own metadata through data descriptors, finds the public schema method through a bounded eight-level prototype descriptor walk, refuses the first accessor, catches descriptor/conversion failures, and uses `Reflect.apply` with the actual schema receiver so a getter on the converter's `call` property cannot execute. Existing bounded privacy sanitization still processes the resulting record; conversion error text is not published.

The pinned OMP public `ToolInfo` declares `parameters`; the public pi-ai exports expose `arkToWireSchema`/`toolWireSchema`, and agent-core exports `normalizeTools`. Capture uses the documented `toJsonSchema({target: 'draft-2020-12', fallback: context => context.base})` conversion without executing the callable validator or a tool. The bridge marks missing parameter capture as native metadata, reports `native-tool-parameters`, and keeps provider normalization and tokenization limitations separate from observed declarations.

The native probe compares ordered tool names and each captured declaration, after public native conversion/normalization, against the actual fixture provider Context parameter hash and byte count. Matching normalization profiles are explicitly measured equalities, not configured-option readback. HTTP serialization and exact tokenization remain unavailable; fresh hosted execution belongs to W2's later receipt, not this source-only review.

W2 reported the exact-source focused callable-schema/accessor regression green: one test, 26 assertions, exit 0. Its fixture contains throwing getters for name, description, source info, parameters, `toJsonSchema`, and the method's `call`; the shared getter-read count must remain zero. The reviewer inspected that fixture and source, without rerunning it or launching native/provider calls.

| Reviewed source file | Git blob |
| --- | --- |
| `packages/shared/src/agent/omp-runtime-observer.ts` | `809c6f557f184929024958e6c102f0f15b328bd3` |
| `packages/shared/src/agent/omp-runtime-trace-bridge.ts` | `77d97b8ee0a12cb577b84f6bc60f822089804b7f` |
| `scripts/probes/runtime-map-native-loop.ts` | `c0c4ebf8f8a5f10ad5061d451a49254a1b52f71a` |

Final guard refinement `ec1cbc1fd390bccad00d34e88d1fef9a271302ad` was also independently inspected against the pinned public `isArkSchema` implementation. Both require a callable value with callable `toJsonSchema` and `assert` methods. The observer checks those methods through descriptor-only lookup and invokes only conversion; it does not call the validator or assertion. The extended fixture refuses a generic method-only function and an assertion getter, while the supported schema assertion throws if accidentally executed. W2 reported the exact-source narrow observer/watch gate at 22 tests, 165 assertions, exit 0. This remains owner-executed local boundary evidence; fresh hosted parameter comparison is still a separate acceptance receipt.
