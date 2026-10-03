# [SVC-RECON] Runtime and service progress reconciliation

Review date: 2026-10-03. Baseline: `f63294ba4fffa7238b46b24e918925a313ad0b12`; prioritized candidate: `de805e0dc7103b49d4c7f0a092d88c8b4222367a`. Repository: **rox-one/rox-one**.

This supplement reconciles the baseline [service backlog](03-runtime-services-backlog.md) with accumulated committed and uncommitted work. The machine-readable [service review](reconciliation/service-review.json) contains exact dispositions for all **37 parent tasks and 74 subtasks**, plus **5 new feature acceptance tasks and 10 subtasks**. Source implementation, bounded verification and integration are independent states. No complete service task is accepted as finished.

## [SVC-RECON-01] Findings that change the baseline assessment

- Encrypted durable replica outbox and canonical Notes synchronization exist on the candidate. Describing all replica persistence as in-memory would now be incorrect. The local replica retains maps, and Notes is the implemented canonical shared producer; general account-wide and team remote synchronization remain incomplete.
- Native authority, durable mutation journal, registered entity roots, permission fences and socket invalidation are implemented. Shared-password WebUI authentication still has a shared subject; these native mechanisms do not establish a complete hosted account/tenant service.
- Scheduler occurrences, external-effect retry outcomes and provider budget reservations gained durable SQLite state. Restarted ambiguous external effects are not blindly resent. Full live delivery, budget reconciliation and multi-worker service ownership remain separate gates.
- Portable SQLite is real progress for six consumers: native authority, native journal, browser profile import, replica outbox, agent budget and automation occurrence ledger. **packages/server-core/src/memory/fts-index.ts remains Bun-only with Node recency fallback**; generic adapter tests do not close FTS parity.
- Lessons now carry issuer/subject ownership. Projects AI, code-intelligence provider policy, JMAP operations, marketplace authenticity and voice consent gained source work. Those modules need their own complete functional acceptance.
- The cloud-runner exitCode truthfulness defect, local simulation stub, paid-gate enforcement requirement, retired Cloudflare decision, hardcoded default service folders and Windows OpenClaw child ownership are not repaired by candidate compilation or Notes synchronization.
- Dirty OMP18.4.12 and Edge TTS changes in the original audit checkout are retained as uncommitted source evidence, with no invented GitHub commit or passing runtime receipt.

## [SVC-RECON-02] Reviewed revisions and evidence limits

| Input | Revision / state | Use in this review |
|---|---|---|
| [PR #1322](https://github.com/rox-one/rox-one/pull/1322) | `de805e0dc7103b49d4c7f0a092d88c8b4222367a` / OPEN draft | Executed/source revision `010fa8c040e3a84cd40cd8195473f52d8582f159`; reports-only head distinguished. |
| [PR #1317](https://github.com/rox-one/rox-one/pull/1317) | `bbb30156a0758d1c00510e97eb6dc715c6b64fbe` / OPEN | Executed/source revision `a7a2505c19327c7f9cb09ae8893dbbca76afe355`; reports-only head distinguished. |
| [PR #1292](https://github.com/rox-one/rox-one/pull/1292) | `01889b4a43a2ce4f730d3109b49750a0fbde4db8` / OPEN | Source/input ancestry and bounded receipts; no full release inference. |
| [PR #1315](https://github.com/rox-one/rox-one/pull/1315) | `4504549086016dc3b892d17e9855a71afc1925d8` / OPEN | Source/input ancestry and bounded receipts; no full release inference. |
| [PR #1319](https://github.com/rox-one/rox-one/pull/1319) | `bdd28272856be5fdead6c7a93ca1b45eb13b17ed` / OPEN | Source/input ancestry and bounded receipts; no full release inference. |
| September frozen assembly input | `bac082301aed341fe078cb5bd539c4ba074560eb` | Source/input ancestry and bounded receipts; no full release inference. |
| Compound frozen assembly input | `3027028c6c8cb420efe3ea4b255ac725747de9e5` | Source/input ancestry and bounded receipts; no full release inference. |

All feature PRs listed above remain open at the captured review; source is **not integrated into main**. The frozen September and Compound input revisions belong to PR1322 assembly provenance, while current worktree heads and dirty state are recorded separately. The [progress snapshot](evidence/progress-snapshot.json) discovers 779 refs / 735 unique heads / 609 outside main, 17 open PRs and 6 selected worktrees, 5 dirty. This inventory is discovery coverage, not semantic verification of every historical branch. Prioritized modules were reviewed against candidate source, core/SQLite owner receipts and relevant dirty runtime edits.

### [SVC-EVIDENCE-R15] recorded_revision_bound_execution

Recorded direct010 build/248 CI Bun tests+19 Python tests, durable1002 invocation, process-loss24 invocation, integrated198 invocation, strict built4, real launcher2, browser99 and auth11; overlapping counts not aggregated. Native/live provider/PG/full109/143/UTB/DATA_SHARED acceptance explicitly false. Not rerun by service reviewer.

Reference: [revision-bound report](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/docs/cloud-all-surfaces-direct-010-validation-20261001.md#L1-L43).

### [SVC-EVIDENCE-CORE] recorded_revision_bound_execution

PR1317 bounded core/compiler/CI and actual three-artifact lifecycle with4/0/37. Source-equivalent6cf191dd hosted checks; 817 core inherited unchanged-source receipt from1292, not second final-head run. Both PRs unmerged.

Reference: [revision-bound report](https://github.com/rox-one/rox-one/blob/bbb30156a0758d1c00510e97eb6dc715c6b64fbe/docs/cloud-core-ci-validation.md#L1-L40).

### [SVC-EVIDENCE-SQLITE] recorded_cross_runtime_sqlite_execution

PR1315 adapter + stacked PR1319 recovery; Bun/node:sqlite eager validation, signed64 binding, safe integer result refusal; six consumers. Hosted Ubuntu/macOS bounded SQLite jobs and Node compiled main extraction16 assertions. Does not port memory FTS nor prove installed desktop.

Reference: [revision-bound report](https://github.com/rox-one/rox-one/blob/bdd28272856be5fdead6c7a93ca1b45eb13b17ed/docs/september-sqlite-runtime-recovery.md#L1-L45).

### [SVC-EVIDENCE-DIRTY] uncommitted_source_only

Read-only dirty source inspection: OMP18.4.12 framing/negotiation and Edge TTS playback/cancellation edits. Existing test edits are not execution evidence. No commit URL, integration or passing runtime claim.

Local paths: `/Users/t/Projects/rox-one-final-audit-20261003/packages/shared/src/agent/omp-rpc-frames.ts`, `/Users/t/Projects/rox-one-final-audit-20261003/packages/shared/src/agent/omp-agent.ts`, `/Users/t/Projects/rox-one-final-audit-20261003/packages/shared/src/voice/adapters/edge-tts.ts`, `/Users/t/Projects/rox-one-final-audit-20261003/packages/server-core/src/handlers/rpc/voice.ts`.

### [SVC-EVIDENCE-CURRENT] fresh_independent_compiler_only

Root fresh isolated Darwin arm64 Bun1.4.2 candidate typechecks: server/server-core/shared/Pi/cloud-runner/session-tools/session-MCP and workers pass. messaging-gateway and viewer fail. This changes stale baseline compiler diagnoses, not functional release readiness.

Reference: [fresh candidate compiler receipt](evidence/candidate-recheck.json).

Historical execution counts are per invocation and overlap; they are not combined into a unique passing-test total. The report on publication head de805e0d binds direct execution to source010. Real launcher and configured-password browser authentication are verified within their recorded fixture. Extracted compiled Electron SQLite and constrained wholemain require are **not installed Windows/macOS acceptance**. Hosted SQLite metadata does not attest printed test logs when redirect access is denied. CodeQL raw annotations are not confirmed vulnerabilities; security triage and live provider/OAuth/PG gates remain pending.

Fresh independent candidate compiler checks on Darwin arm64/Bun1.4.2 pass for all checked service/core/Pi/worker packages except messaging-gateway; viewer also fails. They replace stale baseline compiler diagnoses only for those tested packages. A separate fresh [built-server lifecycle run](evidence/candidate-built-server-lifecycle.log) under **Bun1.4.2 produced 3 pass / 1 fail**, with a startup **ReferenceError: exports_tmp is not defined**. Successful compilation and historical strict lifecycle receipts therefore do not establish lifecycle acceptance under this local runtime. The independent comparison under CI-pinned **Bun1.3.14 passes: 4 tests, 37 assertions**, including real built HTTP/WebSocket authentication, graceful stop and durable restart; see [pinned-toolchain log](evidence/candidate-built-server-lifecycle-bun1314.log). This is bounded standalone-server acceptance and does not qualify native installers, hosted deployment or real providers. The service reviewer did not execute provider calls, paid sandbox provisioning, native signing/installation or new functional suites.

## [SVC-RECON-03] Module-by-module dispositions

The original task review headings use SVC-REVIEW-001 through SVC-REVIEW-037 and their children to avoid duplicating the canonical SVC IDs in document03; JSON retains the exact original SVC IDs. New SVC-038–042 task headings remain canonical. Parent dispositions apply to their children only within the recorded source scope. Every original child remains separately represented in JSON and below with its own acceptance criteria. Remaining work must reuse accepted source changes rather than reimplement them. A candidate passing build does not close an unchanged functional gap.

### [SVC-REVIEW-001] Production server bootstrap and HTTP/WebSocket configuration

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Bun/headless bootstrap now registers durable native authority/journal and strict shutdown; core recovery provides real three-artifact lifecycle proof. ROX/CRAFT token alias inconsistency remains in WebUI server setup.

**Remaining:** Unify environment aliases; validate production HTTPS/proxy/callback configuration and reproducible WebUI staging. Relative output workaround is documented; absolute output handling still needs repair.

**Platform scope:** A/B: packaged local service; C: authoritative hosted service.

**Evidence packets:** r15, core; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server/src/index.ts#L119-L156); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/bootstrap/headless-start.ts#L391-L434); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/bootstrap/headless-start.ts#L442-L480); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/src/index.ts#L119-L156).

**Requirements:** ROX and legacy CRAFT aliases behave consistently; startup reports missing assets or invalid ports without exposing secrets.

**DoD:** Both aliases independently start authenticated HTTP and RPC, and an invalid configuration fails before accepting clients.

**Full functional verification:** Boot from a clean data directory, log in, connect RPC, run a session, restart and reopen it.

**Test method:** Subprocess startup matrix plus browser smoke against the built server.

#### [SVC-REVIEW-001.1] Canonical environment aliases and startup diagnostics

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-001]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Canonical environment aliases and startup diagnostics', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/src/index.ts#L119-L156).

**Requirements:** ROX-only, CRAFT-only and both-defined precedence documented.

**DoD:** Each supported configuration starts the same authenticated surfaces.

**Full functional verification:** Start three isolated servers and read /login, /health and WebSocket handshake.

**Test method:** Extend server smoke tests with alias-only subprocess cases.

#### [SVC-REVIEW-001.2] Deploy HTTP, RPC and OAuth under the public origin

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-001]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Deploy HTTP, RPC and OAuth under the public origin', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/src/index.ts#L119-L156).

**Requirements:** Production URL and proxy allowlist explicitly configured.

**DoD:** No mixed-content or localhost callback URLs appear to remote browsers.

**Full functional verification:** Login through production-shaped TLS proxy and finish an OAuth redirect.

**Test method:** WebUI HTTP tests plus actual proxy/browser integration.

### [SVC-REVIEW-002] Hosted identity, tenancy and authorization

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Native authenticated principal, workspace grants, registered scopes, before-response fences and invalidation sockets are implemented for approved native/domain operations. Shared WebUI password remains JWT subject webui; generic hosted account/tenant sessions are not solved.

**Remaining:** Implement account-specific hosted identity and durable tenant-scoped sessions, then adversarial cross-account/source/file/event tests. Preserve native subject/issuer authorization instead of replacing it with renderer-supplied identity.

**Platform scope:** A/B: preserve local-owner behavior; C: implement hosted account isolation.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/webui/auth.ts#L16-L49); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/transport/server.ts#L116-L143); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/security/workspace-scope.ts#L77-L116); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/server.ts#L738-L790); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/orgs.ts#L53-L90); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/webui/auth.ts#L35-L65).

**Requirements:** Every hosted request has a validated account subject and resource authorization; renderer IDs never establish ownership.

**DoD:** Two accounts cannot read, mutate, subscribe to or execute against each other's resources.

**Full functional verification:** Create two users and workspaces, exchange all known IDs, attempt RPC calls and event subscriptions, and verify denied audit records.

**Test method:** HTTP/RPC adversarial tenancy suite using real signed sessions.

#### [SVC-REVIEW-002.1] Account sessions and revocation

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-002]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Account sessions and revocation', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/webui/auth.ts#L35-L65).

**Requirements:** Expiry, logout/revoke and role change apply to HTTP and WSS.

**DoD:** Revoked identities lose access even on existing sockets.

**Full functional verification:** Log in on two devices, revoke one and retry reads and writes.

**Test method:** Session lifecycle integration tests with connected sockets.

#### [SVC-REVIEW-002.2] Audit every resource route and push subscription

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-002]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Audit every resource route and push subscription', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/webui/auth.ts#L35-L65).

**Requirements:** Authorization before lookup, mutation and subscription.

**DoD:** Cross-account requests are denied without leaking resource metadata.

**Full functional verification:** Replay another account's request payloads and monitor every push topic.

**Test method:** Table-driven channel authorization tests plus two-user browser test.

### [SVC-REVIEW-003] RPC compatibility, reconnect and remote capability routing

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Acknowledged workspace bootstrap, capability declarations, native-action metadata, permission fences and shared replay path have been added. Generic shared push deliberately returns CAPABILITY_UNAVAILABLE; unavailable rendering was not accepted as functionality.

**Remaining:** Validate all client/server combinations, refresh/revoke during an in-flight reply, durable reconnect/replay and per-domain capability routing. Define explicit unavailable behavior for desktop-only capabilities in hosted WebUI.

**Platform scope:** A/B: Electron local binding; C: browser/server capabilities.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/transport/server.ts#L250-L292); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/transport/client.ts#L979-L1040); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/runtime/platform-headless.ts#L1-L7); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/server.ts#L309-L440); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/client.ts#L1-L90).

**Requirements:** Version compatibility, capability availability, timeout and replay semantics documented.

**DoD:** A reconnecting client neither loses durable state nor performs a protected local Electron action.

**Full functional verification:** Interrupt the connection during streaming, permission prompts and client callbacks; reconnect and compare authoritative transcripts.

**Test method:** Transport lifecycle/peer-trust/error-code suites plus network fault browser tests.

#### [SVC-REVIEW-003.1] Reconnect and bounded replay under load

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-003]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Reconnect and bounded replay under load', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/client.ts#L1-L90).

**Requirements:** Buffers and client limits stay bounded under disconnect churn.

**DoD:** No duplicate final message or unreleased pending invocation remains.

**Full functional verification:** Disconnect repeatedly with concurrent sessions and inspect sequence/state.

**Test method:** Load/fault harness around WsRpcServer and WsRpcClient.

#### [SVC-REVIEW-003.2] Capability parity for hosted browsers

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-003]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Capability parity for hosted browsers', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/client.ts#L1-L90).

**Requirements:** Only negotiated capability clients receive callbacks.

**DoD:** Every exposed operation returns a visible result or actionable error.

**Full functional verification:** Exercise file open/export and browser actions from all target clients.

**Test method:** RPC capability tests plus Win/mac/hosted functional matrix.

### [SVC-REVIEW-004] Agent runtime delivery and provider compatibility

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** OMP first-run model/auth bridge, framing and lifecycle hardening plus durable provider budget integration are present. Pi reasoning registration regressions were corrected in core recovery. These do not prove live provider accounts or installed runtime delivery.

**Remaining:** Integrate one reviewed runtime revision and its artifact manifest; execute streaming/tools/cancellation/usage with real supported providers on Windows, macOS and hosted server. Reconcile dirty OMP18.4.12 upgrade against committed managed17.2.10 before adoption.

**Platform scope:** A/B: ship native/runtime binaries; C: execute on tenant-owned server workers.

**Evidence packets:** r15, core, dirty; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/agent/backend/factory.ts#L65-L69); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/agent/backend/factory.ts#L135-L151); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/pi-agent-server/package.json#L11-L28); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-first-run.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-rpc-transport.ts#L1-L90); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L90).

**Requirements:** Pinned compatible runtime versions; no implicit dependency on a developer's PATH or home configuration.

**DoD:** All offered backends complete a real conversation and tool call on each supported execution host.

**Full functional verification:** Install on clean machines/containers, authenticate, run text/tool/vision turns and force a runtime crash.

**Test method:** Backend factory/runtime resolver suites plus real-provider acceptance runs.

#### [SVC-REVIEW-004.1] Package and resolve every backend executable

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-004]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Package and resolve every backend executable', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L90).

**Requirements:** Architecture-specific executables and clear missing-runtime errors.

**DoD:** All shipped runtimes launch without globally installed development tools.

**Full functional verification:** Launch under a minimal environment and a path with spaces/non-ASCII text.

**Test method:** Packaged runtime smoke tests and binary manifest inspection.

#### [SVC-REVIEW-004.2] Provider capability and model failure handling

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-004]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Provider capability and model failure handling', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L90).

**Requirements:** Provider-specific errors remain actionable and safely redacted.

**DoD:** Streaming/abort/tool and query paths preserve consistent session state.

**Full functional verification:** Run a supported provider then simulate 401, 429 and retired models.

**Test method:** Driver tests plus isolated live-provider contract tests.

### [SVC-REVIEW-005] OMP host tools, branching and permission round trips

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Committed OMP RPCv2 decoder enforces frame/reassembly bounds and lifecycle tests. Dirty original audit checkout adds a distinct omp-rpc-frames decoder and negotiate_protocol handling; it has no committed acceptance receipt.

**Remaining:** Finish actual OMP host tool callbacks, permission approve/deny, source status, branch/resume/cancel and transcript replay. Verify tool subprocess cwd/env and source authorization on each platform; integrate dirty protocol work only after comparison and tests.

**Platform scope:** A/B: local OMP process; C: per-tenant OMP runner.

**Evidence packets:** r15, dirty; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/agent/session-tool-defs.ts#L4-L19); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/agent/session-tool-defs.ts#L87-L99); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/AGENTS.md#L12-L46); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-rpc-transport.ts#L1-L100); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-agent.ts#L1-L100).

**Requirements:** Ask/safe/allow-all modes enforce the same policy as Pi/Claude, including source tools and shadowed host bash.

**DoD:** Source changes and branch/resume produce correct context without unauthorized execution.

**Full functional verification:** Run source read/write, change permissions mid-session, fork before the last turn and reopen after process restart.

**Test method:** OMP transport, source-proxy, anchors and permission tests plus live CLI harness.

#### [SVC-REVIEW-005.1] Host tools and extension responses

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-005]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Host tools and extension responses', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-agent.ts#L1-L100).

**Requirements:** Every extension request receives a valid protocol response.

**DoD:** No hung process, hidden essential tool or permission bypass.

**Full functional verification:** Trigger prompts with accept, reject, no answer and UI disconnect.

**Test method:** NDJSON protocol fixture suite and real OMP tool runs.

#### [SVC-REVIEW-005.2] Branch, skills and transcript recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-005]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Branch, skills and transcript recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-agent.ts#L1-L100).

**Requirements:** Stable parent/child provenance and correct skill activation.

**DoD:** Reopened branches contain intended history and no future parent turns.

**Full functional verification:** Fork at middle/tail, kill OMP, reopen both branches and compare context.

**Test method:** Anchor/branch/skill discovery tests plus restart acceptance.

### [SVC-REVIEW-006] Pi agent server lifecycle, search and web fetch

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Core recovery retains canonical Pi reasoning registration with targeted callback tests and built subprocess/server lifecycle proof. Candidate typecheck now passes. Search service changes improve scoped behavior but no live web-fetch/search provider receipt closes the whole service.

**Remaining:** Run actual Pi subprocess on supported OSs; validate search and SSRF/redirect/timeout limits, tool permissions, crash cleanup and provider configuration. Keep provider account acceptance separate from compiler/lifecycle proof.

**Platform scope:** A/B: bundled Pi child; C: sandboxed tenant worker.

**Evidence packets:** core, r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/pi-agent-server/src/index.ts#L1-L60); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/pi-agent-server/src/tools/web-fetch.ts#L68-L126); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/pi-agent-server/src/tools/search/SEARCH_PAYLOAD_CONTRACT.md#L1-L28); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/services/search.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/pi-agent.ts#L1-L90).

**Requirements:** Subprocess output is framed; web/search limits and permitted egress are enforceable on the execution host.

**DoD:** One tenant cannot influence another runtime's credential/model/tool configuration; invalid fetches cannot reach private infrastructure.

**Full functional verification:** Run long streaming sessions and ephemeral queries while canceling; test search failures and malicious URL redirects.

**Test method:** Pi lifecycle/search suites plus real HTTP DNS/redirect fixture server.

#### [SVC-REVIEW-006.1] Runtime cancellation and subprocess resource cleanup

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-006]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Runtime cancellation and subprocess resource cleanup', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/pi-agent.ts#L1-L90).

**Requirements:** No orphan subprocess or unresolved ephemeral query.

**DoD:** Repeated sessions return process/handle counts to baseline.

**Full functional verification:** Run/cancel hundreds of queries and kill the parent midway.

**Test method:** Ephemeral lifecycle and packaged Pi smoke tests with process tracking.

#### [SVC-REVIEW-006.2] Search and web-fetch full capability contract

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-006]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Search and web-fetch full capability contract', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/pi-agent.ts#L1-L90).

**Requirements:** Bounded retries, content size, output and wall time; artifacts stay session-contained.

**DoD:** Correct results on supported content and safe errors on forbidden URLs.

**Full functional verification:** Search with each configured provider and fetch oversized/private/redirected content.

**Test method:** Search provider tests plus hostile fetch integration cases.

### [SVC-REVIEW-007] Shared source tools, MCP pooling and credential refresh

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Source RPCs gained workspace authorization and source-status runtime tests; secure storage strict reads/repair state reduce silent cached-secret behavior. Shared source execution, MCP pool and real token refresh still require provider acceptance.

**Remaining:** Finish tenant-scoped source ownership/permission propagation, OAuth refresh/revoke and connector health. Verify MCP reconnect and cancellation with real local/remote transports and no secret data in renderer/logs.

**Platform scope:** A/B: local stdio and remote sources; C: remote sources/server-side stdio only.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/mcp/mcp-pool.ts#L1-L14); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/mcp/mcp-pool.ts#L62-L72); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/server-builder.ts#L2-L38); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/sources.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** Source enablement, grants, expiry and transport configuration enforced at invocation.

**DoD:** Add/connect/read/write/disable/delete and credential renewal work across all visible source types.

**Full functional verification:** Configure one source per transport, use two sessions, rotate its token and disable during an in-flight call.

**Test method:** Source builder/token-refresh/API credential suites plus fixture MCP servers.

#### [SVC-REVIEW-007.1] Connection lifecycle and per-tenant pool isolation

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-007]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Connection lifecycle and per-tenant pool isolation', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** A disabled or deleted source becomes unusable promptly.

**DoD:** Tool names and runtime availability match authoritative source state.

**Full functional verification:** Rename/remove sources while Pi/OMP/Claude sessions are open.

**Test method:** MCP pool integration tests with two workspaces and auth-separated servers.

#### [SVC-REVIEW-007.2] API authentication and dynamic token freshness

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-007]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'API authentication and dynamic token freshness', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** Secrets resolved for the actual request and redacted in diagnostics.

**DoD:** Expired credentials refresh once and tool retries safely.

**Full functional verification:** Expire each credential shape and inspect fixture request headers/logs.

**Test method:** Existing source auth/refresh/log-redaction tests plus end-to-end request capture.

### [SVC-REVIEW-008] Session tools and standalone session MCP parity

Disposition: **verification_still_required**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Candidate session-tools/session-MCP compilers pass; generic standalone credential-cache bridge remains bounded and is not replaced by the new native Notes sync/replica service.

**Remaining:** Resolve standalone MCP credential/auth context, enumerate parity with in-app session tools, and verify no cross-workspace session reads/writes. Exercise real MCP clients, reconnect/cancel and destructive permission gates.

**Platform scope:** A/B: local MCP child; C: trusted server callback channel.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/session-mcp-server/src/index.ts#L61-L111); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/agent/session-tool-defs.ts#L61-L99); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/session-tools-core/package.json#L15-L24).

**Requirements:** Session tool parity is behavioral across Claude/Pi/OMP/standalone MCP; credentials stay in trusted host memory/storage.

**DoD:** Every advertised tool has a working implementation or is excluded with an explicit reason.

**Full functional verification:** List tool definitions and exercise source auth/test, plans, browser, spawn_session and call_llm through each backend.

**Test method:** Registry parity suite plus standalone MCP stdio integration.

#### [SVC-REVIEW-008.1] Replace null credential adapter with scoped host access

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-008]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Replace null credential adapter with scoped host access', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/session-tools-core/package.json#L15-L24).

**Requirements:** No decrypted credential cache is recreated.

**DoD:** Credential-aware source checks pass using encrypted host-managed auth.

**Full functional verification:** Authenticate a source and invoke checks via standalone session MCP.

**Test method:** MCP child/host round-trip tests with token refresh and denied scope.

#### [SVC-REVIEW-008.2] Callback timeout, error and permission parity

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-008]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Callback timeout, error and permission parity', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/session-tools-core/package.json#L15-L24).

**Requirements:** Callbacks bind to the originating session and workspace.

**DoD:** No stale callback can authorize a different session.

**Full functional verification:** Interleave callbacks from two sessions; timeout one and close its owner.

**Test method:** Session tool registry/callback integration and permission denial tests.

### [SVC-REVIEW-009] Credentials, master keys and managed credential grants

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Credential locator validation is hardened against prototype/accessor/non-enumerable/symbol records; credential storage has strict disk reads, quarantine/repair and durable writes. Replica key handling and grant-related source changes are present. Windows protected master-key custody is not added by these repairs.

**Remaining:** Deliver Windows/macOS key custody and loss/recovery behavior; verify grants/import/scope/revoke using real OS stores. Do not count successful SQLite porting as secret-store protection.

**Platform scope:** A: DPAPI/Credential Manager or enforced ACL fallback; B: Keychain; C: managed secret/KMS and tenant stores.

**Evidence packets:** core, r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/credentials/backends/secure-storage.ts#L124-L184); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/credentials/fabric/broker.ts#L1-L80); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/credentials/fabric/infisical-provider.ts#L144-L155); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/types.ts#L225-L255); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** Secrets encrypted at rest; master-key protection, recovery and grant scope defined per platform.

**DoD:** Valid credentials survive restart/migration; missing keys never silently discard existing secrets or broaden grants.

**Full functional verification:** Create/read/migrate/rollback credentials and test revoked grants, tenant mismatch and unavailable key stores.

**Test method:** Secure-storage/master-key/migration/fabric policy suites plus OS-native storage tests.

#### [SVC-REVIEW-009.1] Protect Windows and hosted master keys

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-009]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Protect Windows and hosted master keys', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** Unprivileged other users cannot read key or ciphertext material.

**DoD:** Protection and recovery behavior documented and demonstrated.

**Full functional verification:** Attempt read as a second OS user; restore encrypted store with approved recovery.

**Test method:** Windows ACL/DPAPI and hosted KMS integration acceptance.

#### [SVC-REVIEW-009.2] Certify importers, grants and secret materialization

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-009]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Certify importers, grants and secret materialization', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L365-L408).

**Requirements:** Server-authorized grants specify resource, capability and expiry.

**DoD:** Revoked/expired/wrong-project grants fail before materialization.

**Full functional verification:** Import each available provider, revoke it and retry execution.

**Test method:** Fabric importer/broker/grant tests plus actual supported provider checks.

### [SVC-REVIEW-010] Runtime secret isolation and rotation

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Strict credential reads and durable native outbox/key lifecycle improve local persistence and diagnostics. Privacy consent ledger defaults deny; no general hosted secret-isolation service or comprehensive rotation receipt is established.

**Remaining:** Test per-tenant encryption/key isolation, revoked credential denial, key rotation and backup restore with live local/hosted consumers. Maintain private files, no secret argv/log/env propagation to unapproved workers.

**Platform scope:** A/B: local owner scopes; C: eliminate cross-tenant global fragments.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/secrets/runtime.ts#L4-L9); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/secrets/runtime.ts#L23-L49); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/sessions/spawn-env.ts#L1-L42); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/credentials/backends/secure-storage.ts#L590-L620); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/account-replica/outbox.ts#L26-L65).

**Requirements:** Only declared and authorized secret refs enter a child's environment; revoked values are removed.

**DoD:** Concurrent tenant spawns cannot inherit another tenant's env fragment.

**Full functional verification:** Rotate/remove secrets, force provider failure and race two tenants' spawns; inspect only redacted env metadata.

**Test method:** Secret chain/runtime/spawn-env tests with sentinel secret values.

#### [SVC-REVIEW-010.1] Scope spawn environment per execution owner

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-010]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Scope spawn environment per execution owner', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/account-replica/outbox.ts#L26-L65).

**Requirements:** No implicit process-global secret reuse across accounts.

**DoD:** Every child receives only its authorized refs.

**Full functional verification:** Race different tenants and compare allowlisted environment keys.

**Test method:** Concurrency tests against real subprocesses with redacted assertions.

#### [SVC-REVIEW-010.2] Rotation, revocation and redaction boundaries

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-010]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Rotation, revocation and redaction boundaries', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/account-replica/outbox.ts#L26-L65).

**Requirements:** Errors never contain secrets or retain revoked credentials.

**DoD:** Rotation changes future calls and revoked required credentials stop execution.

**Full functional verification:** Rotate while sessions are active, fail resolution and scan stored logs/artifacts.

**Test method:** Secret availability/redaction tests and operational rotation drill.

### [SVC-REVIEW-011] OAuth redirects, callback ownership and hosted provider setup

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Candidate/source and built auth tests establish configured shared-password HTTP/WS behavior, not third-party OAuth consent, refresh, redirect ownership or account provisioning.

**Remaining:** Validate actual provider callbacks on public HTTPS origin, desktop deep links on Windows/macOS, state/PKCE/nonce and multiple simultaneous accounts; prove refresh/revocation and secret custody. Register correct production redirect URIs.

**Platform scope:** A/B: loopback/external browser; C: public HTTPS server callbacks.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/webui/http-server.ts#L317-L355); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/auth/oauth-flow-store.ts#L1-L70); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/credential-manager.ts#L1160-L1172).

**Requirements:** PKCE/state validation, public redirect registration, owner binding and cancellation across supported providers.

**DoD:** OAuth completion connects only the initiating owner's source and refreshes its credentials.

**Full functional verification:** Authenticate Google/Microsoft/MCP/LLM/ROX flows, replay callbacks and submit another user's state.

**Test method:** OAuth store/callback/relay suites plus live provider authorization acceptance.

#### [SVC-REVIEW-011.1] Bind and consume callback state once

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-011]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Bind and consume callback state once', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/credential-manager.ts#L1160-L1172).

**Requirements:** State has expiry, initiating owner and one-time completion semantics.

**DoD:** Expired/replayed/mismatched callbacks deny safely.

**Full functional verification:** Send the same callback concurrently and after expiry; switch user before return.

**Test method:** HTTP callback adversarial state tests.

#### [SVC-REVIEW-011.2] Deploy redirect/relay configuration and recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-011]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Deploy redirect/relay configuration and recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/credential-manager.ts#L1160-L1172).

**Requirements:** No embedded production client secret in distributed apps.

**DoD:** All offered auth actions finish or recover from user cancellation.

**Full functional verification:** Perform fresh consent, denial, timeout and token renewal from each target client.

**Test method:** Real OAuth provider matrix and relay contract tests.

### [SVC-REVIEW-012] Daytona cloud execution truthfulness and process results

Disposition: **observed_gap_retained**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** No cloud-runner source delta repairs ignored exec exitCode followed by done in the Daytona pump. Candidate compiler success does not make execution results truthful.

**Remaining:** Persist stdout/stderr/exitCode and classify failure/cancel/timeout correctly; execute a successful and failing real Daytona job and verify server event, UI, artifact and receipt agree.

**Platform scope:** A/B/C: same server/provider outcome semantics.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-provider.ts#L325-L355); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-client.ts#L305-L316); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-provider.ts#L71-L78).

**Requirements:** Success requires successful runner exit plus validated outputs and subtask outcomes; budgets enforced using measured usage.

**DoD:** Failing runner cannot be presented as completed research; usage and failure reason persist.

**Full functional verification:** Run success, nonzero exit, missing rox-run, partial artifact, oversized output and token-limit cases.

**Test method:** Daytona provider/conformance tests with result-bearing client fixtures and live sandbox run.

#### [SVC-REVIEW-012.1] Honor exit status and validate completion artifacts

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-012]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Honor exit status and validate completion artifacts', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-provider.ts#L71-L78).

**Requirements:** Nonzero exit and missing completion signal fail the run.

**DoD:** Failure state and actionable diagnostic survive restart.

**Full functional verification:** Make rox-run exit 17 after creating one artifact and inspect status/UI.

**Test method:** Provider regression test plus controlled sandbox executable.

#### [SVC-REVIEW-012.2] Measure progress and enforce token/cost budgets

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-012]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Measure progress and enforce token/cost budgets', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-provider.ts#L71-L78).

**Requirements:** Accounting uses actual tokens and runtime; exceeded limits terminate.

**DoD:** No success reported with absent usage or unfinished subtasks.

**Full functional verification:** Execute multiple subtasks near token/wall/artifact limits.

**Test method:** Usage/budget boundary tests plus billed provider reconciliation.

### [SVC-REVIEW-013] Daytona paid gate, hardened image and control plane integration

Disposition: **observed_gap_retained**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Paid-provision gate/config and direct provider construction are unchanged. The audit records an enforcement verification requirement, not an established exploit or successful paid provisioning.

**Remaining:** Trace and enforce the paid gate at every provisioning boundary; validate image pin/digest, sandbox egress, credentials and control-plane ownership using explicit authorized accounts and cost limits.

**Platform scope:** A/B: cloud controls available on desktop; C: account-owned sandbox service.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-sandbox.ts#L2-L13); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-sandbox.ts#L72-L104); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/handlers/rpc/cloud-runs.ts#L254-L267); [pinned source 4](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-client.ts#L235-L254).

**Requirements:** One authoritative provision policy; no retired-provider fallback or unapproved cloud spend.

**DoD:** Unpaid/gated/kill-switch calls cannot create a sandbox; enabled paid calls run only approved images.

**Full functional verification:** Attempt each RPC/schedule/workflow entry with gate closed and inspect provider create requests.

**Test method:** Provision policy/RPC tests plus sandbox image and provider API contract acceptance.

#### [SVC-REVIEW-013.1] Enforce entitlement and release gate on all entrypoints

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-013]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Enforce entitlement and release gate on all entrypoints', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-client.ts#L235-L254).

**Requirements:** Gate cannot be bypassed through direct factory calls or alternate routes.

**DoD:** All denied paths issue zero sandbox-create requests.

**Full functional verification:** Call every provision entry as unpaid, over-budget and gated accounts.

**Test method:** RPC-to-provider spy tests plus controlled remote request audit.

#### [SVC-REVIEW-013.2] Certify provider REST and hardened runner image

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-013]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Certify provider REST and hardened runner image', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/daytona-client.ts#L235-L254).

**Requirements:** Immutable vetted image; scoped auth; bounded network and process privileges.

**DoD:** Fresh sandbox completes a real run and exports artifacts without manual setup.

**Full functional verification:** Provision, upload spec, execute, download, cancel/delete in actual provider staging.

**Test method:** Live Daytona contract test and image executable smoke.

### [SVC-REVIEW-014] Cloud run durability, restart recovery and local execution

Disposition: **observed_gap_retained**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Cloud-runner implementation remains unchanged; native Notes journal/replica persistence is a separate subsystem. Local reference stub still simulates output rather than executing requested workload.

**Remaining:** Implement/choose real local executor, explicit stub visibility and durable cloud state recovery; exercise crash/resume/cancel/artifact retrieval and stale sandbox reconciliation.

**Platform scope:** A: Windows child-tree ownership; B: POSIX process groups; C: durable hosted run ownership.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/local-provider.ts#L33-L41); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/local-provider.ts#L106-L119); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/handlers/rpc/cloud-runs.ts#L334-L362).

**Requirements:** Durable run owner, spec, events, outputs and terminal result; no orphan work after cancellation.

**DoD:** Restart restores active/terminal runs; local mode performs the requested task.

**Full functional verification:** Submit, kill host mid-run, restart, resume, cancel and inspect artifacts/process/sandbox inventory.

**Test method:** Cloud runner conformance/RPC tests plus host crash-recovery matrix.

#### [SVC-REVIEW-014.1] Real local runner and Windows process trees

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-014]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Real local runner and Windows process trees', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/handlers/rpc/cloud-runs.ts#L334-L362).

**Requirements:** Identical run contract with real inference/tool behavior.

**DoD:** Cancel leaves no child or grandchild process running.

**Full functional verification:** Spawn a nested long-running command in local run and cancel on each OS.

**Test method:** Local provider lifecycle tests plus Windows process enumeration acceptance.

#### [SVC-REVIEW-014.2] Persist registries and recover distributed runs

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-014]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Persist registries and recover distributed runs', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/handlers/rpc/cloud-runs.ts#L334-L362).

**Requirements:** Run/schedule writes tolerate concurrent operations and partial file writes.

**DoD:** Restart neither loses runs nor repeats completed work.

**Full functional verification:** Interrupt writes/pump and restart from persisted run records.

**Test method:** Filesystem fault injection and provider reconcile tests.

### [SVC-REVIEW-015] Retired Cloudflare gateway disposition and API hardening

Disposition: **observed_gap_retained**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Retired Cloudflare code is unchanged and not the active default provider. Snapshot comparison provides no new credential/auth/deployment acceptance for this legacy surface.

**Remaining:** Decide supported legacy status; remove/disable unreachable production entry points or protect/authenticate and test them. Preserve documentation that Daytona/local/native is the current provider registry.

**Platform scope:** A/B/C: no hidden fallback; C: isolate or retire legacy service.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/cloud-runner/src/public-registry.ts#L2-L21); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/cloud-gateway/src/index.ts#L11-L37); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/cloud-gateway/src/index.ts#L77-L96); [pinned source 4](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/cloud-gateway/wrangler.jsonc#L7-L34).

**Requirements:** Supported provider list matches runtime/routes/docs; legacy endpoint cannot broaden access or bypass spend policy.

**DoD:** No normal user path silently uses Cloudflare; retained APIs validate ownership and size limits.

**Full functional verification:** Try legacy configuration, known foreign run IDs, parent fork IDs and malformed/oversized request bodies.

**Test method:** Registry migration tests plus gateway API/security harness when service retained.

#### [SVC-REVIEW-015.1] Retire or constrain gateway deployment

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-015]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Retire or constrain gateway deployment', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/cloud-gateway/wrangler.jsonc#L7-L34).

**Requirements:** Provider retirement enforced independently of UI visibility.

**DoD:** Old configs migrate predictably without invoking retired provider.

**Full functional verification:** Load old cloudflare config and submit from every execution entry.

**Test method:** Public registry/coercion and RPC migration tests.

#### [SVC-REVIEW-015.2] Tenant-safe run IDs, schemas and share revocation

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-015]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Tenant-safe run IDs, schemas and share revocation', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/cloud-gateway/wrangler.jsonc#L7-L34).

**Requirements:** No shared administrative token in distributed clients.

**DoD:** Foreign IDs and invalid specs reject; revoked share becomes unreadable.

**Full functional verification:** Two owners exchange IDs, malformed schemas and share tokens.

**Test method:** Worker/DO integration tests and deployed gateway adversarial API test.

### [SVC-REVIEW-016] Messaging gateway ownership, routing and operational lifecycle

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Messaging capability contract explicitly says five adapters support live receive/send but no history import. RPC routing changed; current independent candidate typecheck still fails messaging-gateway, so broad all-package readiness is false.

**Remaining:** Repair remaining gateway compiler errors, prove one owner/runtime per account and isolate binding/source/credential scope. Add durable routing/dedupe/backpressure and live adapter evidence; do not promise history import from live-only adapters.

**Platform scope:** A/B: local gateway ownership; C: server-hosted adapters and credential stores.

**Evidence packets:** current, r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/bootstrap.ts#L28-L70); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/access-control.ts#L55-L110); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/router.ts#L1-L90); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/messaging.ts#L1-L90).

**Requirements:** Sender/workspace/session identity and access mode enforced before commands, turns and decisions.

**DoD:** Unauthorized messages cannot start sessions or approve tools; authorized responses reliably reach the correct thread.

**Full functional verification:** Pair an owner and outsider on each platform; send commands, attachments and permission buttons across two workspaces.

**Test method:** Messaging access/router/commands/button/registry suites plus real platform acceptance.

#### [SVC-REVIEW-016.1] Bind sender access and permission decisions

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-016]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Bind sender access and permission decisions', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/messaging.ts#L1-L90).

**Requirements:** Access enforcement identical for messages and buttons.

**DoD:** Outsider/replayed button produces no tool execution or state mutation.

**Full functional verification:** Forward an owner's approval button to another sender and replay it.

**Test method:** Gateway button/access/pairing tests with real adapter delivery.

#### [SVC-REVIEW-016.2] Durable delivery, worker health and shutdown

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-016]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Durable delivery, worker health and shutdown', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/messaging.ts#L1-L90).

**Requirements:** Gateway health reports unavailable platform and pending delivery states.

**DoD:** Restart recovers bindings without duplicate agent turns.

**Full functional verification:** Kill/restart gateway while inbound/outbound messages and attachments are active.

**Test method:** Fault-injection gateway lifecycle tests plus adapter reconnect drill.

### [SVC-REVIEW-017] Telegram polling, forum topics and attachments

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Capability declaration clarifies Telegram live-only behavior; no new adapter-specific source change was found in the reviewed candidate relevant to original polling/media/history gaps.

**Remaining:** Execute real Telegram account/bot flow, forum threads, attachments, polling restart/dedupe and per-workspace binding revoke. Implement history import only if product requirements require it, with separate API/custody design.

**Platform scope:** A/B/C: Node/Bun gateway with single active bot poller.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/telegram/index.ts#L26-L41); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/topic-registry.ts#L1-L70); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/telegram/dm-only.test.ts#L1-L39); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** DM/group/forum behavior explicitly specified; one poller per bot credential; attachment size/time limits.

**DoD:** Supported message types route once to the intended bound topic and recover from polling interruptions.

**Full functional verification:** Use a private chat and forum supergroup; pair, bind, send text/PDF/image/audio and restart the poller.

**Test method:** Telegram/topic registry tests plus dedicated real bot acceptance.

#### [SVC-REVIEW-017.1] Forum pairing and topic lifecycle

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-017]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Forum pairing and topic lifecycle', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Pairing requires an actual forum supergroup and authorized owner.

**DoD:** Topic messages stay in the correct session and invalid pairings reject.

**Full functional verification:** Pair a regular group/forum, delete a topic and recreate a session.

**Test method:** Topic registry/router tests and live forum scenario.

#### [SVC-REVIEW-017.2] Polling failover and attachment handling

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-017]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Polling failover and attachment handling', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** No duplicate turns or leaked temp files during failover.

**DoD:** Text/media resume after disconnect without crossing file caps.

**Full functional verification:** Interrupt polling during a media update and switch the active server.

**Test method:** Polling lifecycle fixture tests and real media delivery drill.

### [SVC-REVIEW-018] WhatsApp Node worker, authentication and message lifecycle

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Worker compiler/build receipts exist for the reviewed source. WhatsApp transport itself is not accepted through generated-worker hashes or capability declarations.

**Remaining:** Validate QR/login/logout/session persistence, actual Node worker packaging, live message/media receipts and crash/reconnect on Windows/macOS/server. Clearly report no history-import support.

**Platform scope:** A/B: bundle Node/Electron-as-Node worker; C: durable server auth directory.

**Evidence packets:** r15, current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server/src/index.ts#L161-L167); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/whatsapp/index.ts#L285-L302); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-whatsapp-worker/src/worker.ts#L1-L65); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Worker bundle and correct Node executable shipped; session auth protected and account-scoped.

**DoD:** Owner can pair, exchange media and reconnect across host restart without silently failing edits.

**Full functional verification:** Fresh pair, restart, disconnect/reconnect, send historical/live messages and force worker exit.

**Test method:** WhatsApp lifecycle/filter/upsert/media tests plus real test account acceptance.

#### [SVC-REVIEW-018.1] Package worker and protect pairing credentials

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-018]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Package worker and protect pairing credentials', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Missing worker/runtime fails visibly before pairing.

**DoD:** Pairing survives restart only for the correct account.

**Full functional verification:** Install clean build, pair, restart then inspect protected auth directory.

**Test method:** Worker bundle smoke and native/server lifecycle tests.

#### [SVC-REVIEW-018.2] Capability-aware updates and reconnect deduplication

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-018]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Capability-aware updates and reconnect deduplication', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** No unsupported edit route or replay-triggered duplicate turn.

**DoD:** Long streaming reply completes correctly after worker reconnect.

**Full functional verification:** Stream a response, kill worker, reconnect and inspect final chat.

**Test method:** Renderer/gateway capability tests and live reconnect scenario.

### [SVC-REVIEW-019] Discord worker, channel bindings and intents

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Discord worker compiler/build closure is recorded; transport-specific intent, channel and live-message acceptance remains separate.

**Remaining:** Run authorized live bot/channel bindings with minimal intents, reconnect/dedupe, attachment limits and revoke. Prove tenant/channel separation and packaged worker termination on all server runtimes.

**Platform scope:** A/B/C: bundled or server-side Discord worker and scoped bot token.

**Evidence packets:** r15, current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/bootstrap.ts#L48-L54); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-discord-worker/src/worker.ts#L1-L65); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/discord/index.ts#L1-L85); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Bot scopes/intents, channel access and adapter capability matrix documented.

**DoD:** Authorized sender can create/bind sessions and receive complete text/media responses.

**Full functional verification:** Install bot in test guild, exercise DM/thread/channel, insufficient intents and worker restart.

**Test method:** Discord protocol/config/format/lifecycle tests plus real guild acceptance.

#### [SVC-REVIEW-019.1] Gateway intents and channel/thread access

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-019]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Gateway intents and channel/thread access', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Only intended guilds/channels/senders execute tools.

**DoD:** Supported threads route correctly and forbidden channels deny.

**Full functional verification:** Revoke channel access and message-content intent during a session.

**Test method:** Adapter/router fixture tests and test guild permission matrix.

#### [SVC-REVIEW-019.2] Worker IPC and interactive approvals

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-019]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Worker IPC and interactive approvals', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Worker failures surface without losing authoritative session.

**DoD:** Restart and old component clicks cannot execute an unintended command.

**Full functional verification:** Kill worker during permission prompt then click old/new buttons.

**Test method:** Protocol/gateway button tests plus real Discord interaction.

### [SVC-REVIEW-020] Lark adapter, event cards and resource download

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Lark live-only capability is declared; no new runtime proof resolves event/card/resource behavior from the original backlog.

**Remaining:** Validate app credentials/signature challenge, real event receive, card action/update and resource downloads with cancellation/size/type controls. Prove replay and account/workspace binding ownership.

**Platform scope:** A/B/C: server or local adapter with app credentials and event transport.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/lark/index.ts#L625-L655); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/lark/index.ts#L735-L765); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/lark/card.ts#L1-L45); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Document accepted event/message/card/resource shapes and exact app scopes.

**DoD:** Supported text/files/cards work with the deployed SDK/API; unsupported events have safe diagnostics.

**Full functional verification:** Use a test Lark app to send text/resource/card actions and test revoked scopes.

**Test method:** Lark adapter/card/format tests plus live tenant acceptance.

#### [SVC-REVIEW-020.1] App auth, event reconnect and message identity

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-020]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'App auth, event reconnect and message identity', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Events bind to the configured workspace/account.

**DoD:** No duplicated turn or lost owner command after reconnect.

**Full functional verification:** Deliver duplicate events and revoke/regrant app access.

**Test method:** Lark adapter event/auth fixture tests and real app reconnect.

#### [SVC-REVIEW-020.2] Cards, resource downloads and supported types

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-020]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Cards, resource downloads and supported types', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** No schema rejection or accidental private resource disclosure.

**DoD:** Every advertised card/media operation delivers the actual result.

**Full functional verification:** Upload resource, use approval card, send unknown event and large file.

**Test method:** Card/resource tests and actual Lark UI readback.

### [SVC-REVIEW-021] WeChat/iLink authentication, encrypted media and polling

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** WeChat live-only capability is explicit; no new real authentication/encrypted media/polling proof is inferred.

**Remaining:** Run actual authorized iLink login, expiration/reconnect, media upload/download and poll dedupe; contain keys and prove logout removes usable authentication without corrupting unrelated accounts.

**Platform scope:** A/B/C: account-isolated state/sync buffers and supported media runtime.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/wechat/index.ts#L1-L85); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/wechat/ilink/auth/login-qr.ts#L1-L65); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/messaging-gateway/src/adapters/wechat/ilink/media/media-download.ts#L1-L45); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Protocol endpoint/configuration and supported media dependencies pinned; auth state tenant-isolated.

**DoD:** Real account pairs, sends/receives supported content and recovers polling state after restart.

**Full functional verification:** Pair dedicated account, exchange text/image/audio/file, restart and test expired session/invalid ciphertext.

**Test method:** WeChat adapter/send/renderer tests plus real test account protocol acceptance.

#### [SVC-REVIEW-021.1] Auth and polling state recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-021]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Auth and polling state recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** Account/session mismatch denies before processing.

**DoD:** Restart resumes one owned poller with accurate online state.

**Full functional verification:** Switch accounts, corrupt buffer and expire login during incoming traffic.

**Test method:** Account/session-guard/polling integration and live reconnect.

#### [SVC-REVIEW-021.2] Encrypted media and transcoder deployment

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-021]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Encrypted media and transcoder deployment', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/capabilities.ts#L1-L18).

**Requirements:** No unrestricted download or leaked temporary media.

**DoD:** Supported media round trips or gives actionable unavailable errors.

**Full functional verification:** Send encrypted sample content and invalid/oversized media on each host.

**Test method:** Media crypto/download tests plus real audio/image delivery.

### [SVC-REVIEW-022] Automations execution, retries and side-effect semantics

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Retry state now persists inflight before external HTTP effects, records terminal_pending before queue removal and resolves restarted ambiguous inflight as unknown outcome instead of automatic duplicate resend. This supersedes a blanket claim of simple unsafe retry; webhook/history tests and process-loss receipts exist.

**Remaining:** Integrate revised semantics and give users repair/reconciliation actions for unknown outcomes. Verify actual delivery receipts, idempotent destinations, persistent history, cross-process ownership and scaling; no multi-worker lease/DLQ proof is implied.

**Platform scope:** A/B: one workspace executor; C: leases/queue ownership for hosted workers.

**Evidence packets:** r15, sqlite; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/automations/retry-scheduler.ts#L2-L25); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/automations/script-executor.ts#L4-L15); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/automations/automation-system.ts#L1-L70); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/retry-scheduler.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/handlers/webhook-handler.ts#L1-L90).

**Requirements:** Event/action permissions, retry/idempotency semantics and secret environment boundaries documented and enforced.

**DoD:** Automation outcomes persist accurately and do not falsely claim external success.

**Full functional verification:** Trigger each action, restart between effect and ack, test duplicated events and trap script termination.

**Test method:** Automation/security/retry/script/handler suites plus real fixture side-effect services.

#### [SVC-REVIEW-022.1] Hosted lease ownership and webhook idempotency

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-022]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Hosted lease ownership and webhook idempotency', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/handlers/webhook-handler.ts#L1-L90).

**Requirements:** Two replicas cannot concurrently own one queue; restart duplication handled.

**DoD:** Failed/uncertain delivery is visible and recoverable.

**Full functional verification:** Run two workers and crash one immediately after webhook accepts.

**Test method:** Retry crash/lease tests with effect-recording HTTP fixture.

#### [SVC-REVIEW-022.2] Script runtime, policy and descendant cleanup

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-022]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Script runtime, policy and descendant cleanup', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/handlers/webhook-handler.ts#L1-L90).

**Requirements:** Unapproved script cannot escape source/workspace grants.

**DoD:** Timeout/cancel leaves no descendants; logs do not contain secrets.

**Full functional verification:** Execute path traversal/symlink/trapped-signal and nested-child scripts.

**Test method:** Script/security tests and OS-specific process cleanup acceptance.

### [SVC-REVIEW-023] Scheduler, task runner and workflow receipts

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Durable occurrence ledger records workspace/matcher/revision/UTC/timezone/action identity with SQLite atomic claim; IANA/DST matching uses supplied instant. Personal task persistence and process-loss tests are added. Workflow publication placeholder remains a separate unfinished path.

**Remaining:** Validate end-to-end schedule/task/workflow receipts, DST cases, restart and multiple owners; finish placeholder publication and provide cancellation/retry reconciliation. Verify task source authority through native/service boundaries.

**Platform scope:** A/B: sleep/wake and local-time behavior; C: leader/lease and timezone policy.

**Evidence packets:** r15, sqlite; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/scheduler/scheduler-service.ts#L1-L85); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/tasks/TaskRunner.ts#L843-L903); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/workflows/executor.ts#L36-L54); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/occurrence-ledger.ts#L1-L115); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/automations/cron-matcher.ts#L1-L42); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/tasks/personal-persist.ts#L1-L90).

**Requirements:** Durable schedule/task/workflow ownership; defined misfire policy; receipts tied to real external operations.

**DoD:** Restart/resume never fabricates completed nodes or repeats non-idempotent work silently.

**Full functional verification:** Run a multi-node workflow with failure/approval, suspend machine, change timezone and resume after restart.

**Test method:** Scheduler/cron/TaskRunner/workflow live-executor suites plus durable service integration.

#### [SVC-REVIEW-023.1] Scheduling and task recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-023]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Scheduling and task recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/tasks/personal-persist.ts#L1-L90).

**Requirements:** No duplicate trigger under restart or two workers.

**DoD:** Missed jobs follow the published skip/catch-up policy.

**Full functional verification:** Advance clock through DST, sleep/wake and concurrent server restart.

**Test method:** Fake-clock scheduler tests plus process restart task acceptance.

#### [SVC-REVIEW-023.2] Persistent receipts and production workflow wiring

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-023]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Persistent receipts and production workflow wiring', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/tasks/personal-persist.ts#L1-L90).

**Requirements:** Loopback/in-memory test execution never appears verified production.

**DoD:** External result is read back before succeeded/verified.

**Full functional verification:** Perform a real create/update workflow, fail after effect and resume.

**Test method:** Workflow receipt integration with readback fixture and one live provider.

### [SVC-REVIEW-024] Knowledge bridge, managed SiYuan/OEM kernel and local vaults

Disposition: **verification_still_required**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** General native domain authority and handler type repairs do not establish managed SiYuan process supervision, binary delivery or vault/OEM lifecycle completion. Existing selected G2 Variant C progress remains valid.

**Remaining:** Complete packaged kernel binaries, consent, port ownership, filesystem containment, upgrade/backup/restore and actual vault synchronization on Windows/macOS; define hosted vault boundaries and test UI-to-service round trips.

**Platform scope:** A: Windows kernel/discovery; B: macOS SiYuan/vault; C: server-owned vault or authenticated remote provider.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/knowledge/process-manager.ts#L89-L114); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/knowledge/bridge-service.ts#L1-L65); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/knowledge/publication-service.ts#L2-L7).

**Requirements:** Only approved pinned kernel runs; server/desktop vault ownership is explicit; no unintended browser access to local desktop files.

**DoD:** Connect/read/search/propose/review/apply/rollback and export work against actual provider data.

**Full functional verification:** Use a real external provider and approved managed build, edit out-of-band, apply stale proposal and restart watcher/kernel.

**Test method:** Knowledge gate/process/bridge/publication/vault/migration suites plus real provider UI readback.

#### [SVC-REVIEW-024.1] Complete managed kernel release gate and distribution

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-024]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Complete managed kernel release gate and distribution', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/knowledge/publication-service.ts#L2-L7).

**Requirements:** Blocked gate remains enforced until evidence is accepted.

**DoD:** Approved build starts; absent/invalid pin or conflicting workspace fails safely.

**Full functional verification:** Install fresh kernel, test lock conflict, health timeout and crash recovery.

**Test method:** Provider gate/process-manager tests plus packaged kernel acceptance.

#### [SVC-REVIEW-024.2] Mutation safety, watches and substantive publication

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-024]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Mutation safety, watches and substantive publication', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/knowledge/publication-service.ts#L2-L7).

**Requirements:** Review approval precedes writes; full content and stable links persist.

**DoD:** Readback matches approved draft and rollback restores prior content.

**Full functional verification:** Publish session/run, modify provider externally, apply stale draft and undo.

**Test method:** Bridge/publication/watcher tests plus live vault/provider comparison.

### [SVC-REVIEW-025] Memory storage, search, learning and scope parity

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Lessons now carry immutable issuer/subject ownership, filter prompt context/list/updates/archive/recovery by owner and add native permission-scoped RPC. This is real scope work. memory/fts-index.ts still imports Bun SQLite, unaffected by the generic adapter introduced for six other consumers.

**Remaining:** Complete memory search parity under actual Electron Node and hosted Bun, migrate/index/rebuild safely, validate graph/dedup/archive/lesson injection per owner and denial after membership revoke. Keep unavailable FTS distinct from successful general SQLite tests.

**Platform scope:** A/B: Electron Node disables bun:sqlite FTS; C: Bun server has FTS.

**Evidence packets:** r15, sqlite; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/memory/fts-index.ts#L14-L41); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/memory/MemoryService.ts#L1-L75); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/memory/MemoryProposalStore.ts#L1-L65); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/LessonStore.ts#L145-L215); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/MemoryService.ts#L1-L90); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** Scope boundaries and search availability visible; authoritative markdown/JSONL is recoverable independently of indexes.

**DoD:** Approved lessons influence only authorized sessions; revoked/deleted lessons stop being retrieved.

**Full functional verification:** Create global/workspace/session lessons, search distinctive older text, disable memory and rebuild corrupted index.

**Test method:** Memory service/provenance/decay/FTS suites plus desktop and server retrieval acceptance.

#### [SVC-REVIEW-025.1] Desktop search parity and index observability

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-025]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Desktop search parity and index observability', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** Older relevant lessons remain findable under offered full-text search.

**DoD:** Search results behave consistently on same corpus per target.

**Full functional verification:** Index a large known corpus and compare query recall on Electron and Bun.

**Test method:** FTS/retrieval integration in real desktop runtime and hosted server.

#### [SVC-REVIEW-025.2] Learning approval, deletion and migration

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-025]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Learning approval, deletion and migration', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** Unapproved or foreign lessons do not enter prompts.

**DoD:** Deletion removes authoritative record and all derived search entries.

**Full functional verification:** Approve/reject lessons, delete one, restart and inspect generated context.

**Test method:** Memory proposal/store/service tests plus prompt-context readback.

### [SVC-REVIEW-026] Mail provisioning, Stalwart/JMAP operations and signup integration

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** JMAP client now validates secure same-origin nonlocal session/API/upload/download URLs, cancellation/timeout, thread mutation, draft/submission distinction and subscription. Provisioning preserves owner marker and verifies the account; actual hosted signup hook remains described as later.

**Remaining:** Run real Stalwart provisioning from trusted signup event, delivery/sent receipt, thread/move/delete/draft/send/attachment/SSE and expired credential repair. Confirm hosted tenants cannot supply foreign mailbox owner or admin credential.

**Platform scope:** A/B: device-scoped mailbox credential; C: trusted signup/provisioning worker.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/mail/provisioning.ts#L2-L18); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/mail/provisioning.ts#L46-L72); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/mail/jmap-client.ts#L1-L75); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/mail/jmap-client.ts#L110-L180); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/mail/jmap-client.ts#L332-L408); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/mail/provisioning.ts#L1-L65).

**Requirements:** Provisioning authorization, domain/mail transport/DNS, account ownership and quotas configured.

**DoD:** User receives a verified mailbox and can send/read real messages; retries do not adopt another owner's account.

**Full functional verification:** Create two accounts with colliding handles, revoke device app password, repair and send/receive externally.

**Test method:** Provisioning/JMAP fixtures plus real staging mailbox and delivery acceptance.

#### [SVC-REVIEW-026.1] Server-owned signup and account lifecycle

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-026]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Server-owned signup and account lifecycle', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/mail/provisioning.ts#L1-L65).

**Requirements:** Admin secrets unavailable to desktop/browser untrusted users.

**DoD:** Signup reliably provisions or shows recoverable pending/repair state.

**Full functional verification:** Concurrent signup with same handle and interrupted create/mint steps.

**Test method:** Worker/provisioning integration against staging Stalwart.

#### [SVC-REVIEW-026.2] JMAP capabilities, external delivery and device revocation

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-026]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'JMAP capabilities, external delivery and device revocation', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/mail/provisioning.ts#L1-L65).

**Requirements:** Mailbox access scoped per device/account with operator diagnostics.

**DoD:** External recipient receives sent message and revoked device loses access.

**Full functional verification:** Send attachment both directions, revoke one device and retry.

**Test method:** JMAP contract tests plus external inbox delivery readback.

### [SVC-REVIEW-027] Encrypted account replica and cross-device synchronization

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Encrypted durable SQLite outbox stores authenticated payload envelopes, immutable enqueue identity, trusted journal ACKs and scoped snapshots; key zeroization and filesystem checks exist. Replica maps remain local views, and server Notes sync is the implemented domain. Original 'in-memory only' summary is superseded for the outbox.

**Remaining:** Integrate durable producer/outbox/ACK authority without a second writer; prove offline/restart/device revoked/replay/conflict/rotation/restore using actual two devices. Extend each required replicated domain explicitly; do not claim universal account sync from Notes-only producer.

**Platform scope:** A/B: desktop enrollment/offline edits; C: durable account replica service.

**Evidence packets:** r15, sqlite; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/account-replica/replica.ts#L1-L4); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/account-replica/replica.ts#L56-L86); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/account-replica/replica.ts#L273-L283); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/account-replica/outbox.ts#L26-L176); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/account-replica/replica.ts#L1-L90); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** Encrypted durable per-account operations; excluded categories and explicit sync controls honored.

**DoD:** Two enrolled devices and browser can synchronize eligible content across restart without leaking excluded data.

**Full functional verification:** Edit offline on both devices, reconnect, resolve markdown conflict, revoke device and execute account deletion.

**Test method:** Replica crypto/tenancy tests plus two-device transport/restart acceptance.

#### [SVC-REVIEW-027.1] Durable replica API and account membership

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-027]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Durable replica API and account membership', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** Membership managed by trusted server authority.

**DoD:** Restart preserves encrypted replica and unauthorized workspace denies.

**Full functional verification:** Restart sync service then request another account's op cursor.

**Test method:** Replica API/database fault and tenancy integration tests.

#### [SVC-REVIEW-027.2] Recovery, conflict resolution and deletion receipts

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-027]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Recovery, conflict resolution and deletion receipts', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** Recovery/deletion semantics and excluded categories documented.

**DoD:** Conflicts are reviewable and revoked devices cannot upload/download.

**Full functional verification:** Lose a device, recover on new device and verify deletion on all peers.

**Test method:** Multi-device chaos and cryptographic recovery/deletion tests.

### [SVC-REVIEW-028] Organizations, team outbox and remote collaboration

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Org actions now derive actor from principal.subject and native authorization; self-profile is owner-scoped. Team queue distinguishes accepted/delivered IDs, but LocalOnly transport still accepts none and pulls null; no remote organization delivery backend is established.

**Remaining:** Implement authenticated remote team transport, invitations/membership/device revocation and per-record receipt/replay/conflict policy. Prove two real accounts/devices; preserve Notes-only sync limitation and local queue truthfulness.

**Platform scope:** A/B: local team data migration; C: authoritative organization service.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/team/sync.ts#L4-L10); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/team/sync.ts#L37-L58); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/orgs/storage.ts#L340-L367); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/orgs.ts#L53-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/team/sync.ts#L1-L75).

**Requirements:** Authenticated org roles, targeted invites, shared comments/assignments/handoffs/access/approvals/activity and durable cursors.

**DoD:** Two users on different devices see synchronized authorized state and revocation removes access.

**Full functional verification:** Invite second user remotely, comment/assign/handoff offline, reconnect and revoke their membership.

**Test method:** Org/team store tests plus multi-user server transport acceptance.

#### [SVC-REVIEW-028.1] Organization authority and targeted invite redemption

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-028]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Organization authority and targeted invite redemption', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/team/sync.ts#L1-L75).

**Requirements:** Renderer/local profile cannot select arbitrary member identity.

**DoD:** Only intended user can redeem invite and roles enforce permissions.

**Full functional verification:** Try wrong account, expired token, duplicate redemption and last-owner removal.

**Test method:** Organization API invite/RBAC adversarial tests.

#### [SVC-REVIEW-028.2] Outbox synchronization and concurrent updates

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-028]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Outbox synchronization and concurrent updates', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/team/sync.ts#L1-L75).

**Requirements:** Accepted entries are acknowledged only after durable server write.

**DoD:** Offline entries sync once and conflicts remain visible.

**Full functional verification:** Edit same task/comment on two users; drop/replay network responses.

**Test method:** Outbox protocol and multi-user browser/desktop integration.

### [SVC-REVIEW-029] Session collaboration links, presence and public publication gates

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Canonical Notes shared sync and scoped authorizations are new; they do not enable general session public publication. Existing DG03 publication/presence gates require their own acceptance.

**Remaining:** Implement supported private/public session sharing, ACL/revocation, event/presence expiry and sanitized publication. Verify unauthorized readers and removed members across native/hosted clients; retain disabled gates until accepted.

**Platform scope:** A/B: account authenticated client; C: actual bro/share service.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/collaboration/bro-invite-service.ts#L37-L61); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/collaboration/invite.ts#L5-L12); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/collaboration/publication.ts#L1-L8); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** Collaboration requires membership; public sharing has approved visibility, expiry, redaction and deletion semantics.

**DoD:** Remote invited user joins only intended session; revoked access and deleted publication cease immediately.

**Full functional verification:** Open invite on another account/device, edit simultaneously, revoke and test an old public/share URL.

**Test method:** Invite/presence/conflict/publication tests plus actual hosted routes and readback.

#### [SVC-REVIEW-029.1] Hosted join/presence/permission enforcement

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-029]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Hosted join/presence/permission enforcement', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** One-time join and session scope enforced server-side.

**DoD:** Viewer cannot mutate or execute; stale presence expires.

**Full functional verification:** Invite viewer/editor, replay link, disconnect and revoke mid-session.

**Test method:** Bro service/API/WebSocket collaboration acceptance.

#### [SVC-REVIEW-029.2] Unify public sharing gates and retention

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-029]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Unify public sharing gates and retention', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85).

**Requirements:** No alternate public route bypasses blocked publication policy.

**DoD:** Expiry/revoke/delete remove access and preserve safe audit evidence.

**Full functional verification:** Publish allowed test content, revoke and inspect CDN/object/API access.

**Test method:** Share route integration with retention/deletion and secret-sentinel tests.

### [SVC-REVIEW-030] Marketplace catalog, signed packages and installation lifecycle

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Catalog/installer now document SHA256 plus Ed25519 remote catalog authenticity, pinned SHA clone verification, atomic staged install, collision/local-edit preservation and clone-only upstream handling. Tool entries remain deferred to toolchain update.

**Remaining:** Verify production signing-key rotation/catalog delivery/cache downgrade refusal, real install/update/remove on Windows/macOS and hosted policy. Prove disabled upstream scripts and correct toolchain delegation; complete UX/status parity and localization.

**Platform scope:** A/B: local install/executable permissions; C: hosted workspace installs only.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/marketplace/catalog.ts#L374-L400); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/marketplace/catalog.ts#L508-L546); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/marketplace/installer.ts#L1-L85); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/marketplace/catalog.ts#L1-L40); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/marketplace/installer.ts#L1-L30); [pinned source 6](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/marketplace/installer.ts#L100-L150).

**Requirements:** Catalog and packages have authenticated provenance, immutable version/digest and permitted execution capabilities.

**DoD:** Verified supported package installs work on every execution host; invalid signatures fail without partial mutation.

**Full functional verification:** Refresh catalog online/offline, install/update/remove package, corrupt signature and interrupt install.

**Test method:** Marketplace catalog/signing/installer/lock suites plus real signed release acceptance.

#### [SVC-REVIEW-030.1] Own catalog publication and key rotation

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-030]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Own catalog publication and key rotation', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/marketplace/installer.ts#L100-L150).

**Requirements:** Distributed app trusts controlled signing authority.

**DoD:** Tampered/untrusted/regressed catalog rejected; trusted rotation succeeds.

**Full functional verification:** Serve modified body/signature and rotate a catalog key in staging.

**Test method:** Catalog signature/version/caching contract tests.

#### [SVC-REVIEW-030.2] Install lifecycle, permissions and dependency resolution

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-030]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Install lifecycle, permissions and dependency resolution', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/marketplace/installer.ts#L100-L150).

**Requirements:** Hosted installs restricted to authorized tenant workspace.

**DoD:** Interrupted installs roll back and installed tools actually execute.

**Full functional verification:** Install one real source/skill/runtime, interrupt update and rerun.

**Test method:** Installer/resource/toolchain integration with packaged hosts.

### [SVC-REVIEW-031] Projects, resource bundles and portable workspace data

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Projects/OKR/roadmap AI RPCs and scope projection are implemented with native action metadata, current permission/fence rechecks and real server model generation. Portable config/path handling improves workspace data; no live provider/native DOM receipt closes service.

**Remaining:** Validate real model response/proposal approval and project/resource CRUD/import/export with source authority, conflicts and cancellation. Test relocation between Windows/macOS/hosted workspace roots without absolute secret/source paths.

**Platform scope:** A: Windows paths/ACLs; B: macOS paths; C: server workspace upload/download.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/projects/storage.ts#L2-L8); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/projects/storage.ts#L39-L57); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/resources/resource-bundle.ts#L4-L13); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/projects.ts#L290-L375); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** Project path containment, quotas and grants; bundles exclude secrets and reset auth correctly.

**DoD:** Portable export/import preserves valid content while clearing runtime credentials and refreshing watchers.

**Full functional verification:** Create project/assets, move/export to another platform, import conflicting resources and verify source reconnect.

**Test method:** Project/resource/bundle path tests plus real cross-platform round trip.

#### [SVC-REVIEW-031.1] Project CRUD and filesystem containment

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-031]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Project CRUD and filesystem containment', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** No crafted project/asset path escapes workspace.

**DoD:** Assets/context persist and delete affects only selected project.

**Full functional verification:** Use traversal, drive/UNC paths and symlink targets; restart after changes.

**Test method:** Project storage path/migration tests and native filesystem acceptance.

#### [SVC-REVIEW-031.2] Bundle staging, redaction and overwrite recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-031]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Bundle staging, redaction and overwrite recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** Bundle/file caps and secret stripping apply to every file/type.

**DoD:** Interrupted import leaves recoverable state and no secret-bearing export.

**Full functional verification:** Export sentinel credentials, import over active resources and interrupt rename.

**Test method:** Resource import/export and filesystem failure-injection tests.

### [SVC-REVIEW-032] Pages, custom views and mediated source actions

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Pages backend and canonical content handlers changed; exact010 browser creation writes real private page.json and survives same-profile restart. Native docs descriptor/block-tree/markdown commit service adds a separate canonical document pipeline.

**Remaining:** Complete custom views/action permissions and all source backends; verify unauthorized read/write, source revocation and cross-workspace paths. Browser Pages persistence is bounded to one private profile, not cross-device hosted document sync.

**Platform scope:** A/B: desktop page host; C: sandboxed browser page/server broker.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/pages/action-bridge.ts#L4-L28); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/pages/action-bridge.ts#L55-L75); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/views/evaluator.ts#L1-L65); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/pages.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** Sandbox, owner/frame binding, schema/timeout/rate/replay limits and approved source policies enforced.

**DoD:** Page read/action/refresh works; stale digest, nonce, replay and foreign workspace requests reject.

**Full functional verification:** Create an interactive page with API/MCP/script action, edit its content, reuse old grant and exercise from hosted browser.

**Test method:** Page action/data/share/view evaluator suites plus actual iframe/browser integration.

#### [SVC-REVIEW-032.1] Page broker execution and frame ownership

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-032]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Page broker execution and frame ownership', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** Grant revocation/source disable affects active page immediately.

**DoD:** Malicious iframe cannot invoke another page's source action.

**Full functional verification:** Swap frame/page/session IDs, replay nonce/request and revoke source.

**Test method:** Broker/source-gate/MCP/script executor integration tests.

#### [SVC-REVIEW-032.2] Data refresh, views and publishing readback

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-032]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Data refresh, views and publishing readback', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** No evaluated custom expression escapes allowed operations.

**DoD:** Saved page/view returns identical content after restart and exported version works.

**Full functional verification:** Refresh while editing, reopen custom views and import/share bundle.

**Test method:** View/data-store/publisher tests plus live client readback.

### [SVC-REVIEW-033] Code intelligence and optional SBOM services

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Off-by-default provider registry records operation capabilities, runtime/ref/digest evidence and approval-scoped egress; verified snapshots use commit-proven files. Scoped RPC rechecks policy/freshness/cancellation. Manifest is explicitly not upstream runtime verification.

**Remaining:** Provision each supported provider only after provenance, model/runtime digest and actual account/API acceptance; test trusted repository snapshots, path containment, revocation mid-query and remote egress denial. Verify optional SBOM/service packaging separately.

**Platform scope:** A/B: authorized local repositories; C: server-uploaded/checked-out repositories.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/code-intelligence/local-adapter.ts#L1-L84); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/code-intelligence/sbom.ts#L1-L23); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/code-intelligence/explainer.ts#L30-L49); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/code-intelligence/provider.ts#L1-L110); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/code-intelligence.ts#L240-L280).

**Requirements:** Supported languages/size limits and repository access grants documented; output citations match checked-out revision.

**DoD:** Index/explain/navigation and supported SBOM output function on authorized repos without private data leakage.

**Full functional verification:** Index fixtures and a real repo, edit files, follow citations, deny a foreign path and remove Syft.

**Test method:** Code-intelligence adapter/explainer/SBOM tests plus actual installed tool acceptance.

#### [SVC-REVIEW-033.1] Index correctness and source ownership

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-033]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Index correctness and source ownership', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/code-intelligence.ts#L240-L280).

**Requirements:** Every symbol explanation references real source position/revision.

**DoD:** Updating/deleting code invalidates stale symbols/citations.

**Full functional verification:** Edit/delete indexed functions, query and open all citations.

**Test method:** Fixture corpus and filesystem watcher/index integration.

#### [SVC-REVIEW-033.2] Syft discovery, availability and real output

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-033]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Syft discovery, availability and real output', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/code-intelligence.ts#L240-L280).

**Requirements:** Missing tool visibly unavailable; successful output structurally valid.

**DoD:** Installed scanner produces artifact that can be opened/exported.

**Full functional verification:** Run with no Syft then with supported binary against real repo.

**Test method:** Runner contract tests plus native Syft smoke.

### [SVC-REVIEW-034] Environment preferences, OS discovery and git execution

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Stored-config portable path tests and storage changes reduce absolute-path portability issues. No candidate change repairs default-microservices hardcoded macOS folders or turns connected folder pointers into healthy daemons.

**Remaining:** Deliver capability/health-aware OS source discovery on Windows/macOS and honest unsupported behavior in hosted WebUI; validate Git cwd, binary path, credentials and import/export relocation without implicit execution.

**Platform scope:** A: Windows app/Telegram discovery; B: macOS access controls; C: server filesystem only.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/default-microservices.ts#L117-L126); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/sources/default-microservices.ts#L76-L96); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/environment/storage.ts#L1-L33); [pinned source 4](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/git/exec.ts#L1-L60); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** Actual existence/access/capability drives status; local vs hosted filesystem and placement choices are explicit.

**DoD:** Windows defaults point to usable locations; unavailable data is shown accurately; preference changes affect runtime behavior.

**Full functional verification:** Fresh startup per OS/server, deny folder access, change placement preferences and execute git in path with spaces.

**Test method:** Default-source/environment/git tests plus native host acceptance.

#### [SVC-REVIEW-034.1] Correct local source paths and connection status

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-034]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Correct local source paths and connection status', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** No false connected status or implicit personal-directory exposure.

**DoD:** Missing applications/Telegram folder yields clear unavailable source.

**Full functional verification:** Boot fresh Windows/macOS/container and inspect seeded configs/status.

**Test method:** Source seeder/path tests with actual native directory permissions.

#### [SVC-REVIEW-034.2] Apply environment rules and safe git runtime

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-034]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Apply environment rules and safe git runtime', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/config/storage.ts#L1-L90).

**Requirements:** Unanswered/skipped choices preserve defined defaults.

**DoD:** Saved rules and placement affect new sessions and git uses authorized repo.

**Full functional verification:** Change preferences, start session, run status/diff in Unicode/space path.

**Test method:** Environment/config and git subprocess integration matrix.

### [SVC-REVIEW-035] Command gateway and privileged execution authorization

Disposition: **verification_still_required**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Native authorization/fences provide relevant substrate; command-gateway privileged execution implementation is not replaced or accepted by those tests.

**Remaining:** Prove privilege escalation consent, per-principal/source command restrictions, safe argv/cwd/env, Windows elevation/macOS prompt cancellation and cleanup. Hosted service must deny unsupported local privilege paths; audit all indirect tool entry points.

**Platform scope:** A: Windows elevation/UAC; B: macOS privileged prompts; C: restrict server escalation.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/command-gateway/pending-commands.ts#L2-L8); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/services/privileged-execution-broker.ts#L35-L83); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/services/privileged-execution-broker.ts#L88-L112); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/server.ts#L309-L440).

**Requirements:** Approvals scoped to authenticated user/workspace/session and exact immutable command; no generic privilege bypass.

**DoD:** Denied/expired/replayed/mismatched approval never executes; approved effect produces durable accurate receipt.

**Full functional verification:** Approve a harmless command, restart before execution, mutate payload, replay approval and test timeout/elevation denial.

**Test method:** Pending-command/privileged-policy/broker suites plus actual OS permission scenarios.

#### [SVC-REVIEW-035.1] Bind authorization and persist execution outcomes

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-035]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Bind authorization and persist execution outcomes', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/server.ts#L309-L440).

**Requirements:** Restart cannot replay one approved non-idempotent command.

**DoD:** Approved command executes once with truthful result and denied command never runs.

**Full functional verification:** Crash after approval/effect and relaunch executor.

**Test method:** Command gateway/broker crash-recovery integration.

#### [SVC-REVIEW-035.2] Platform elevation and audit redaction

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-035]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Platform elevation and audit redaction', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/server.ts#L309-L440).

**Requirements:** No server root escalation via generic user tool; safe audit retention.

**DoD:** Blocked operations show accurate reasons without secret disclosure.

**Full functional verification:** Use sentinel secret in command, deny OS prompt and inspect logs.

**Test method:** Privileged broker/redaction tests plus native elevation acceptance.

### [SVC-REVIEW-036] Gamification, quests and account balance correctness

Disposition: **partially_implemented**. Evidence: source_implemented_with_bounded_recorded_verification. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** Session completion XP path and focused test are modified; unrelated quests/balance/live-account correctness and durable replay acceptance are not established.

**Remaining:** Integrate idempotent completion/reward ledger, authenticate actor and reject replay/cross-account mutation; reconcile authoritative balances across restart/device sync and validate actual UI receipts.

**Platform scope:** A/B: local persistence; C: per-account state and authoritative balance.

**Evidence packets:** r15; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/gamification/storage.ts#L32-L49); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/gamification/quests.ts#L1-L80); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/shared/src/auth/rox-cloud.ts#L136-L155); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/sessions/SessionManager.ts#L1-L90); [pinned source 5](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/sessions/session-completion-xp.test.ts#L1-L57).

**Requirements:** XP/quest award rules idempotent and account-scoped; billing values authoritative; analytics consent enforced.

**DoD:** User progress persists without duplicate rewards and unrelated users never share state.

**Full functional verification:** Complete a quest twice, retry event after restart, change consent and compare displayed balance to real service.

**Test method:** Gamification/quest/auth tests plus two-account runtime acceptance.

#### [SVC-REVIEW-036.1] Per-account progress and idempotent rewards

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-036]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Per-account progress and idempotent rewards', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/sessions/session-completion-xp.test.ts#L1-L57).

**Requirements:** Retries cannot grant repeated XP for one completed action.

**DoD:** Two accounts retain distinct quests and ratings after restart.

**Full functional verification:** Replay completed event and log in as another hosted user.

**Test method:** Gamification state/retry/isolation integration tests.

#### [SVC-REVIEW-036.2] Balance and analytics consent integration

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-036]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Balance and analytics consent integration', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/sessions/session-completion-xp.test.ts#L1-L57).

**Requirements:** No fabricated credits and no analytics when consent is false.

**DoD:** UI balance matches service and toggled-off consent stops sends.

**Full functional verification:** Inspect balance response/UI and network requests after consent revoke.

**Test method:** Balance contract and consent egress tests.

### [SVC-REVIEW-037] Managed OpenClaw runtime and audit collectors

Disposition: **observed_gap_retained**. Evidence: source_inspected_or_compiler_only. Integrated: **not_integrated_into_main; candidate/open PR evidence**.

**Implemented or observed source:** No candidate delta to managed OpenClaw lifecycle/audit collectors; Windows collectors remain unsupported pending owned JobObject child supervision. Existing local/optional endpoint state is not a production service deployment.

**Remaining:** Complete Windows child ownership/termination, signed runtime provenance, gateway auth and platform-specific audit capability; test actual install/start/stop/restart/revoke and hosted remote pairing with authorized accounts.

**Platform scope:** A: implement native job ownership or expose unsupported audit; B: owned POSIX child; C: tenant-owned runtime.

**Evidence packets:** current; limits described above.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/openclaw/collectors.ts#L158-L175); [pinned source 2](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/openclaw/collectors.ts#L326-L345); [pinned source 3](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/openclaw/runtime-manager.ts#L807-L825).

**Requirements:** Runtime and audit dependencies actually shipped; process ownership and supported platform capability truthful.

**DoD:** Managed runtime starts/stops/restarts without foreign process control; supported audit produces real bounded evidence.

**Full functional verification:** Install runtime in clean workspace, start, audit, crash/restart, deny credentials and check orphan processes.

**Test method:** OpenClaw collector/audit/runtime-manager suites plus actual managed runtime acceptance.

#### [SVC-REVIEW-037.1] Close Windows audit process ownership gap

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-037]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Close Windows audit process ownership gap', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/openclaw/runtime-manager.ts#L807-L825).

**Requirements:** No unsupported spawn until safe ownership exists.

**DoD:** Audit succeeds when supported and leaves no descendant process.

**Full functional verification:** Run audit spawning grandchildren, cancel/timeout/parent exit on Windows.

**Test method:** Collector/native ownership tests and Windows process inspection.

#### [SVC-REVIEW-037.2] Runtime health, config and credential recovery

Disposition: **remaining_acceptance_after_parent_reconciliation**; source/evidence scope inherits [SVC-037]. Integrated: **not_integrated_into_main**.

Remaining: Integrate and verify the original subtask outcome for 'Runtime health, config and credential recovery', reusing the parent source changes. Complete only the requirements not already implemented, then execute the full acceptance below.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/openclaw/runtime-manager.ts#L807-L825).

**Requirements:** Foreign/stale runtime nonce cannot control current child.

**DoD:** Restart reconciles persisted runtime state and exposes failed health accurately.

**Full functional verification:** Crash child, occupy port, revoke token and stop wrong workspace runtime.

**Test method:** Runtime manager/audit tests plus real gateway health/readback.

## [SVC-RECON-04] Additional service feature acceptance backlog

These tasks capture new service boundaries absent or materially underspecified in the baseline backlog. They complement existing task IDs. Their implementation is already partly present; each task requires integration and actual acceptance for its declared platform.

### [SVC-038] Integrate the native authority, canonical document journal and scoped Notes synchronization

Native authority/journal, block tree/descriptor/markdown commit and Notes sync are new services. Existing SVC-002/027/032 describe related boundaries; this task adds their combined service acceptance, without treating general shared data as implemented.

**Platform scope:** A/B: real Electron main/preload principal and one canonical writer; C: authenticated scoped service, explicit unavailable local paths..

**Status:** new_feature_acceptance_required; not_integrated_into_main; full acceptance pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-authority.ts#L1-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-journal.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** Principal/issuer, workspace roots and grants must be resolved by trusted server/native authority; canonical mutation carries expected revision, durable journal receipt and rechecked permission fence.

**DoD:** Notes create/save/delete/read/pull work across restart and revoke with exactly one canonical mutation per operation; every unsupported domain fails explicitly, and replicas consume only trusted scoped durable ACKs.

**Full functional verification:** Use two real accounts/devices against production-shaped server and installed clients; create offline, reconnect, concurrently edit, revoke before reply, restart after commit-before-ACK and confirm no cross-account content or duplicate writer.

**Test method:** Run authority/native-journal/sync/content integration suites and OS process-loss tests, then actual installed UI flows; bind artifact/source hashes and each acceptance result.

#### [SVC-038.1] Trusted scope registration and revocation propagation

Register canonical workspace/entity roots, credentials and grant lifecycle; deny symlink/path aliases, forged issuer/subject and stale grant versions through subscribe and before-response paths.

**Platform scope:** A/B: real Electron main/preload principal and one canonical writer; C: authenticated scoped service, explicit unavailable local paths..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-authority.ts#L1-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-journal.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** No caller-defined trust roots or actor; revocation invalidates live sockets and pending reads/writes.

**DoD:** Cross-workspace, stale and revoked calls cannot observe or mutate protected state.

**Full functional verification:** Issue/revoke actual credentials while requests are paused before response and commit.

**Test method:** Adversarial authority/transport tests plus two-account native/hosted exercise.

#### [SVC-038.2] One Notes writer and durable pull/ACK recovery

Connect native Notes commit and encrypted outbox to journal receipts; validate positional RPC signature and explicit Notes-only pull support.

**Platform scope:** A/B: real Electron main/preload principal and one canonical writer; C: authenticated scoped service, explicit unavailable local paths..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-authority.ts#L1-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-journal.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/collaboration/sync-service.ts#L20-L85); [pinned source 4](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/docs/markdown-commit.ts#L1-L90).

**Requirements:** expectedRevision and operation are never repurposed as legacy sourceStoreId; durable receipt belongs to matching owner/workspace/entity.

**DoD:** Crash between enqueue/commit/ACK and retry produces one canonical revision, preserved private state and stable trusted receipt.

**Full functional verification:** Kill each boundary, relaunch, edit concurrently and revoke during replay on two devices.

**Test method:** Existing native-content cases, new OS kill/restart acceptance and direct filesystem/journal receipt comparison.

### [SVC-039] Accept durable provider cost budgets and ambiguous outcome reconciliation

New agent budget SQLite ledger reserves workspace daily USD with owner token/PID; process loss converts uncertain reserved effects to unresolved instead of freeing cost blindly.

**Platform scope:** A/B: local SQLite and provider processes; C: authoritative tenant ledger and concurrency/scaling contract..

**Status:** new_feature_acceptance_required; not_integrated_into_main; full acceptance pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L120); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/__tests__/budget-process-loss-acceptance.test.ts#L1-L90).

**Requirements:** Reserve/settle/release/unresolved transitions must use idempotent operation identity, honest usage and owner/workspace scope; USD limits survive restart and cannot be bypassed by concurrent processes.

**DoD:** Supported providers all enforce limits before chargeable effects; exact costs/unknown outcomes reconcile without duplicate settlement, premature release or cross-tenant influence.

**Full functional verification:** Run real bounded-cost requests, cancel/crash after provider acceptance, restart, and reconcile actual provider usage with persisted reservations; race two owners and cross midnight/timezone boundaries.

**Test method:** Budget unit/process-loss suites and live provider accounting receipts; inject lost response/usage and concurrent processes using isolated ledgers.

#### [SVC-039.1] Provider usage and settlement wiring

Connect every supported backend and error/cancel path to reservation identity and trustworthy usage evidence.

**Platform scope:** A/B: local SQLite and provider processes; C: authoritative tenant ledger and concurrency/scaling contract..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L120); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/__tests__/budget-process-loss-acceptance.test.ts#L1-L90).

**Requirements:** No backend bypass; missing usage leaves an explicit unresolved outcome.

**DoD:** Successful, failed, streamed/cancelled and lost-response calls reach documented final ledger states.

**Full functional verification:** Compare real provider usage responses and persisted rows for each backend.

**Test method:** Provider adapter contract tests plus bounded live request/cancel receipts.

#### [SVC-039.2] Owner recovery and multi-process budget contention

Define ownership and lock/lease boundaries for desktop and scaled hosted workers; reject foreign scope and dead-owner reuse.

**Platform scope:** A/B: local SQLite and provider processes; C: authoritative tenant ledger and concurrency/scaling contract..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/agent-budget.ts#L1-L120); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/core/__tests__/budget-process-loss-acceptance.test.ts#L1-L90).

**Requirements:** Unresolved effects continue counting until authorized reconciliation; simultaneous owners cannot over-reserve.

**DoD:** Kill/restart/race scenarios preserve the USD ceiling and audit history.

**Full functional verification:** Two actual processes reserve concurrently then SIGKILL one after network dispatch.

**Test method:** Existing owner-process acceptance plus production database/worker concurrency test.

### [SVC-040] Integrate the portable SQLite adapter and verify each consumer under shipped runtimes

The new adapter covers authority, journal, profile import, replica outbox, budget and occurrence ledger. It deliberately does not port Bun-only FTS; Node/Bun result equivalence and protected read-only handling are service requirements.

**Platform scope:** A/B: exact shipped Electron Node SQLite version; C: pinned Bun/Node server images..

**Status:** new_feature_acceptance_required; not_integrated_into_main; full acceptance pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/utils/sqlite-runtime.ts#L1-L110); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** Selected runtime exposes supported SQLite API; strict eager statement errors, signed64 bounds, transaction/close/read-only semantics and no write fallback are preserved for all six consumers.

**DoD:** All six consumers pass rollback/closed/restart/readonly/WAL and process-loss cases on exact packaged runtimes; unsupported runtime fails with actionable capability error. FTS has its own explicit decision and acceptance.

**Full functional verification:** Use clean installed Windows/macOS artifacts and pinned hosted image; open/modify/reopen each real service database, crash its owner, use inaccessible sidecars and out-of-range values.

**Test method:** SQLite recovery workflow plus artifact-extracted and actual packaged consumer suites; do not substitute mock wholemain for installed acceptance.

#### [SVC-040.1] Exact runtime and SQL semantic parity

Pin shipped Bun/Electron Node and adapter closure; test eager prepare validation and safe integer refusal per runtime.

**Platform scope:** A/B: exact shipped Electron Node SQLite version; C: pinned Bun/Node server images..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/utils/sqlite-runtime.ts#L1-L110); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** Missing node:sqlite or unsafe values never silently degrade or round.

**DoD:** Equivalent results/error/rollback behaviors in actual shipped runtimes.

**Full functional verification:** Execute the same seeded database and statement corpus under Bun, Node and installed main.

**Test method:** Cross-runtime fixtures, readonly/WAL and artifact hash/provenance checks.

#### [SVC-040.2] Consumer migration, backup and unsupported FTS decision

Document schema/version ownership and migration/restore for six adapters; explicitly port or disable FTS in Node with visible status.

**Platform scope:** A/B: exact shipped Electron Node SQLite version; C: pinned Bun/Node server images..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/utils/sqlite-runtime.ts#L1-L110); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/memory/fts-index.ts#L20-L50).

**Requirements:** No destructive migration or writable readonly fallback; FTS capability status is honest.

**DoD:** Existing state migrates/restores with unchanged owners/receipts and either verified FTS or explicit unavailable search.

**Full functional verification:** Restore old databases into clean Windows/macOS/hosted installs then run domain operations and search.

**Test method:** Migration and backup fixtures plus actual installed crash/reopen and FTS query verification.

### [SVC-041] Accept voice services, consent ledger and dirty Edge TTS integration

Committed voice policy requires cloud ASR and always-listening consent and marks live evidence false; privacy ledger defaults unset. Dirty checkout adds Edge audio playback and cancellation, with no committed or runtime acceptance.

**Platform scope:** A: actual Windows audio/local ASR; B: CPU/Apple Silicon ASR and system/Edge TTS; C: browser permissions and authorized cloud ASR/TTS service..

**Status:** new_feature_acceptance_required; not_integrated_into_main; full acceptance pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/voice/policy.ts#L19-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/privacy/store.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/voice.ts#L1-L90).

**Requirements:** Cloud audio upload, retention and wake listening require explicit persisted scoped consent; unsupported local engines report capability truthfully. Edge source must be reviewed and committed before counted as integrated.

**DoD:** Record/transcribe/play/cancel/wake flows work in actual clients; deny/revoke prevents all relevant egress; local mode has no upload; live evidence remains false until revision-bound provider/OS verification.

**Full functional verification:** Capture network/audio evidence while toggling consent; test offline local inference, browser mic denial, cancel concurrent playback, relaunch persistence and real ROX/Edge responses.

**Test method:** Policy/adapters/capture unit tests, consent egress probes, real microphone/speaker checks on each platform and bounded provider receipts.

#### [SVC-041.1] Audio consent, retention and account boundary

Integrate privacy ledger with voice prefs and server authorization; clear wake/ASR access on revoke or actor change.

**Platform scope:** A: actual Windows audio/local ASR; B: CPU/Apple Silicon ASR and system/Edge TTS; C: browser permissions and authorized cloud ASR/TTS service..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/voice/policy.ts#L19-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/privacy/store.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/voice.ts#L1-L90).

**Requirements:** Consent cannot be inferred from a fixture, env flag or old unrelated account preference.

**DoD:** No uploaded audio or armed wake listening without current scoped consent; declared retention matches implementation.

**Full functional verification:** Switch accounts and revoke while recording/upload is pending, then inspect server/network/history.

**Test method:** Policy negatives and live egress/capture tests with recorded source and consent revisions.

#### [SVC-041.2] Reconcile and accept Edge playback/cancellation

Review dirty Edge adapter/RPC/renderer changes against committed audio contract, then test actual playback and cancellation.

**Platform scope:** A: actual Windows audio/local ASR; B: CPU/Apple Silicon ASR and system/Edge TTS; C: browser permissions and authorized cloud ASR/TTS service..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/voice/policy.ts#L19-L80); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/privacy/store.ts#L1-L90); [pinned source 3](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/voice.ts#L1-L90).

**Requirements:** No dirty file is represented by a published commit; fallback/unsupported statuses are explicit.

**DoD:** Installed Windows/macOS and hosted browser play valid audio, cancel previous request and recover after failed/aborted transport.

**Full functional verification:** Play two overlapping real requests, abort mid-transfer, reject invalid payload and relaunch.

**Test method:** Edge adapter tests plus native/browser audio evidence; pin resulting commit/artifact once integrated.

### [SVC-042] Accept protected browser profile import and credential deletion custody

Native browser profile import and OS protected cookie-key deletion now include cancellation/security checks. macOS uses independent native deletion verification, Linux secret-tool and Windows explicit unavailable behavior.

**Platform scope:** A/B: real OS credential APIs and owned browser profile; C: explicit prohibition on arbitrary local profile access..

**Status:** new_feature_acceptance_required; not_integrated_into_main; full acceptance pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-profile-import.ts#L1-L90); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts#L1-L48).

**Requirements:** Import requires trusted local principal/current permission and constrained owned profile paths; keys/cookies never cross renderer/log boundaries. Delete success requires independently confirmed absence.

**DoD:** Cancellation/revoke/unsupported OS and ambiguous keychain failures preserve honest status; permitted imported state remains encrypted and scoped, and deleting one key never deletes foreign credentials.

**Full functional verification:** Use disposable real browser profiles and OS keychain entries; import/revoke/cancel, delete and independently query custody. Verify hosted remote calls cannot target host profiles.

**Test method:** Native profile integration/SQLite tests plus real OS keychain/secret-store custody and hostile path/identity tests.

#### [SVC-042.1] Profile path, permission and transactional import

Validate real roots/symlinks/caller identity and cancel/fence before import commits.

**Platform scope:** A/B: real OS credential APIs and owned browser profile; C: explicit prohibition on arbitrary local profile access..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-profile-import.ts#L1-L90); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts#L1-L48).

**Requirements:** No remote or unapproved local profile access and no partial successful import on cancellation.

**DoD:** Foreign roots, changed grants and malformed SQLite/profile data fail without leaked keys or partial user state.

**Full functional verification:** Mutate permission/path during actual disposable import and inspect state/logs.

**Test method:** Path/authority negatives plus OS SQLite profile fixtures and cancellation exercise.

#### [SVC-042.2] Truthful platform key removal

Finish/declare Windows key API support and verify macOS/Linux deletion independently of command status.

**Platform scope:** A/B: real OS credential APIs and owned browser profile; C: explicit prohibition on arbitrary local profile access..

**Status:** new_feature_acceptance_required; not_integrated_into_main; pending.

**Code references:** [pinned source 1](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-profile-import.ts#L1-L90); [pinned source 2](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts#L1-L48).

**Requirements:** No successful deletion on ambiguous lookup, unsupported platform or stale cached value.

**DoD:** Disposable approved key disappears, foreign key remains and false/failed outcome is visible.

**Full functional verification:** Create two disposable OS entries, delete one, query both through independent native API.

**Test method:** Native credential-store tests and recorded real OS custody readback.

## [SVC-RECON-05] Integration order and release acceptance

1. Preserve all dirty worktrees and their hashes. Select the reviewed assembly lineage, compare core1317/1292 and SQLite1315/1319 ancestry, and apply the smallest nonduplicated change set. Do not merge overlapping fixes blindly.
2. Reconcile dirty OMP protocol/runtime and Edge voice edits against committed candidate contracts; review and commit them as separate source changes before attaching execution evidence.
3. Validate compiled/package artifacts and canonical writers, run tenant/permission/revoke and crash/restart cases, then record actual platform/hosted functional evidence for each changed domain.
4. Complete live provider, OAuth, messaging, JMAP, protected credential and paid-gated cloud acceptance with authorized infrastructure. Verify truthful capability/outcome/receipt states; simulated or unavailable fixture behavior must remain labeled.
5. Accept installed Windows10/11 and macOS release artifacts plus hosted app integration only after all domain gates and integration/security/operational checks pass. Existing source and bounded receipts can be reused only when hashes and execution scope match.

Cross-module integration, end-to-end tests, native packaging, production deployment and repeated final verification are owned by the platform/integration reconciliation documents. No merge, deployment, paid service run or commit was performed by this service review.
