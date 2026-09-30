# Unified Rox / Conation / RMA / Golden Gate behavioral specification


## Current September publication: SQLite runtime portability (2026-09-30)

This bounded recovery is based on published native head `c358bd0ce0670cf6baaf0b3579933956c7009eb5` (producer source `c1c81e66`) from PR #1293 and preserves the existing **109 tasks / 489 requirements / 464 dependencies** and their acceptance state. Owner: CloudRecovery in isolated branch `fix/september-sqlite-runtime-20260930`; original native and compound checkouts are untouched.

Pinned Bun 1.3.14 must start the current headless server using a supported synchronous SQLite provider. The verified failure is an unconditional `node:sqlite` import before listen. The already reviewed shared adapter selects `bun:sqlite` under Bun and `node:sqlite` under Node, preserves consumed statement/transaction behavior, rejects unsafe integer results and bindings, finalizes Bun statements, and refuses operations after close. Only provider imports change in six durable consumers and three existing direct-DB test fixtures. Their SQL, schemas, authorization, creation, outbox, journal and path protections remain byte-preserved.

Acceptance requires current-source domain tests, core/shared/server-core/server/WebUI types, actual subprocess/WebUI/server builds and the strict built HTTP/WebSocket authentication, graceful SIGTERM, persistent restart and real already-exited 0/17 controls. A Linux/macOS scoped hosted result must bind to the new delivered revision and actual PR merge parents. Browser-cookie read-only WAL access may fail closed when the pinned provider cannot open absent sidecars; no write fallback is permitted. Full native creation UI, provider and program acceptance remain separate. See [the bounded recovery specification and receipt](september-sqlite-runtime-recovery.md).

A reproduced current-source WebUI typecheck has three TS2339 diagnostics for window.openClawHostControl because its optional interface/global declaration lived in a preload-only module outside the WebUI compilation graph. The previously reviewed type-only repair from main integration 2f3d685d relocates that unchanged declaration to apps/electron/src/shared/openclaw-host-control.ts and imports/re-exports the type from preload. This adds no host capability, bridge exposure or RPC route. The optional property and all preload runtime statements remain unchanged. This narrow prerequisite is included in the independently reviewed candidate.

Actual draft PR #1319 could not form a merge checkout after the native base advanced to07907f909838253eb011e4e27a510c4ba5b5a9df. The recovery branch merges that exact published base without rebasing, retaining its current App/caller-session authorization fence and original program scope. Runtime implementation bytes remain reviewed; the existing caller-session-loading test joins the scoped integration gate. New revision acceptance requires five types, three real builds, expanded native domains and the strict built lifecycle on this merge, plus exact hosted source/readback.

Documentation integration recovery: repeated native publications produced append-only conflicts in these recovery sections. The complete recovery addendum now appears near the document start; the entire native document from tested base `07907f909838253eb011e4e27a510c4ba5b5a9df` remains byte-preserved, rather than retained as a prefix. This layout change adopts no newer native implementation. Local five-type, three-build, 919-test and strict 4-test evidence binds to reviewed ordinary merge `da78e3e79f5c268a33fc429d2913e8b8d59adeac`; hosted PR evidence must separately identify its actual synthetic checkout and both parents.

**Status:** implementation of the existing 109-task program is authorized and in progress; product acceptance remains NOT COMPLETE. This specification does not claim any feature accepted. See [`september-program/PRD.md`](september-program/PRD.md) for full domain catalog, all U01–U31 and the verbatim-scope 16-item U26 checklist; [`september-program/recon-evidence.json`](september-program/recon-evidence.json) and [`september-program/shared-contract-freeze.json`](september-program/shared-contract-freeze.json) for current discovery-only source evidence and open acceptance.

The resumed overall scope retains the original 297 remaining rows, including the September program and the already counted compound packages. [The reconciled evidence packet](september-program/evidence-20260930.json) reports implementation, bounded verification and Git delivery independently. Passing package tests or an Electron build does not close a complete issue, accept DATA/SHARED, or substitute for the original native/platform/provider matrix.

## 1. Contract

The system shall deliver the user's explicit requirements through real, authorized application paths while preserving current working behavior and user data. Every change MUST be traceable from requirement/source → issue → implementation version → environment and actor → precondition/action → expected/observed output → durable evidence → delivery. Existing issue closure, bot statement, compilation, health endpoint, mock, fixture-only screenshot, demo data, local queue or smoke SHALL NOT be promoted to end-to-end success.

Requirements are classified `requested`, `verification-gap`, `proposal-audit` or `decision-reconciliation`. A proposal is not implementation authority; an ambiguous widget is not consent. Missing evidence is `UNVERIFIED`; a required environment/credential that cannot be used is `BLOCKED` with its exact prerequisite; neither counts as fail or pass until exercised.

## 2. Program sequence, roles and shared boundaries

Canonical sequence: **recon → actual audit → shared interfaces → independent streams → serial integration → real acceptance**. `docs/plan.md` is executable canonical DAG and names owner/file limits/contract/dependency/verifications per task.

- **RECON-01 (lead/integrator):** consolidate retained source refs, live repos/branches/worktrees/issues/active workers, feature/current evidence, source ownership, duplicates and stale links. Produce authoritative current evidence matrix + dependency/dedup decisions. Determine unresolved identities and route/service/store persistence seams from code; do not guess API/schema.
- **AUDIT-01 (screen-audit owner):** run current Rox and reachable Conation web/desktop surfaces, cover every visible route and 22 Settings pages, all specified controls, loading/empty/error/retry/auth/persist/reopen, data links, evidence and precisely 2–3 separate improvement proposals per screen. Map report to registry and source. Historical 25-screen/99-fix audit is not sufficient. Macro coverage inventory may seed enumeration only after licence/provenance check; no Macro code copy.
- **Shared interface owner (one assigned integrator):** after recon/audit freeze contracts for route/entity registry, RPC/API schemas, locale catalogs, lockfiles, shared UI primitives. Publish signatures and compatibility migration plan before parallel consumers. No two writers to any shared file. Domain agents own only explicitly isolated paths; changes touching a shared file return to owner as proposed patch, then serially cherry-pick/integrate.
- **Independent streams:** start only when inputs/seams are stable. Use isolated worktrees for non-overlapping source changes. For every worktree record `git status` baseline and untracked/modified overlay before work; never clean/reset or overwrite it. Apply only owned changes; integrate by content and retain the original overlay untouched.
- **Serial integration:** one integrator resolves route/schema/locale/lockfile/common UI changes, merges groups after predecessor evidence, runs narrow changed-path checks, and tracks full matrix; no concurrent landing of changes with shared contracts.
- **Acceptance/release owner:** source current latest issue bodies, ensure all atomic IDs covered without duplicates, run genuine browser + native/provider paths per environment, capture evidence against exact commit/build, close matrix only with observable results.

## 3. Evidence states, issue contract and versioning

Per acceptance row store: stable requirement key; `sourceRefs` (`Uxx`, `seqNNN`, `existing:#NNN`, `latest-user:DOMAIN`); kind and priority/rationale; existing/reused issue or atomic new ID; status and evidence timestamp; owner/role; repo/branch/commit/worktree + preserved dirty baseline; bounded owned paths; exact dependency/interface; behavior, expected outputs; checks and outcomes per platform; artifacts; delivery commit/PR; blocker/next action. Never log credential values, raw conversation, private messages, cookie values, personal data or unredacted provider response.

Platform results are independent: Linux/cloud evidence cannot stand in for macOS or Windows; a browser path cannot stand in for native Tauri; loopback email cannot stand in for internet send/receive; provider connection status cannot stand in for execution. The original Conation Sharing/iOS-share row additionally requires actual iOS share-sheet/receiving/return evidence in CONATION-SHARE-01; it does not authorize inventing a new mobile architecture. `PASS` marks only the tested row, not a whole module. Any code/config change invalidates only evidence whose version/surface is affected, but that evidence MUST be rerun before release.

## 4. Data and authorization contract (derive actual API in RECON)

Do not introduce a new model merely because a user-visible requirement mentions a noun. RECON must identify actual model, stable ID, owner and service for at least User, Workspace/Team, Session, Message, Project, Task, Note/Memory, Meeting/Transcript, Automation, Connection/Provider Account, file, mail thread, calendar event, CRM entity, payment, notification, widget and quest, with source-of-truth references. Every data operation must make actor/tenant/workspace explicit, check authorization at the real boundary (including background/runtime work), and preserve stable identity from mutation through subsequent screen reload.

For applicable persistent writes: define create/update/delete semantics, idempotency and retry handling, conflict/out-of-order behavior, data migration/backup, and recovery. A permission denial must not mutate or leak data; a failed write must show failure and preserve last valid state; a retry must neither duplicate nor silently lose work. Source audit records exact current contracts before any signature migration. A local-only store is labelled local; it is not presented as cross-user synchronized state.

## 5. Detailed scenario contract for requirements

The scenarios below are minimum observable acceptance, not claims that code exists. Agent makes test data on a disposable test account/sandbox and captures clean evidence. For each screen, apply generic state matrix plus domain cases. Exact manual scenarios are intentional where no validated existing command is known.

### 5.1 App inventory & proposal audit (U01)

**Precondition:** launch identified current commit in an available user-like account; record version, OS, window geometry, seeded data, and permission roles. Enumerate screen registry from live routes/nav and 22 settings pages, plus dialogs/in-place surfaces. **Action:** visit each route; activate each visible control at least once; follow navigation and data IDs; exercise normal, empty, denied, loading, server error, retry, saved/reopen where relevant. **Expected:** report includes route/control→result, identity/data edge, exact observed UI state and screenshot/trace for each anomaly; status is reproduced, not assumed. For every screen produce exactly 2–3 reasoned `proposal-audit` candidates marked non-authorizing. **Negative:** suppress one provider/permission and force a non-destructive read/write error; surface explains failure, hides unauthorized rows, retry doesn't duplicate. **Pass:** complete route/control inventory with no unvisited screen disguised as pass and evidence tied to build. Historical screen counts never substitute. Feed must include actual subscription list, sorting/filtering and day grouping; Home captures all five widget choice groups/20 choices; Notes/Tasks/Memory and connection paths include claimed-complete evidence gaps.
Для domain-specific inventory обязательно отдельно проверьте: Things3-style Tasks во всех текущих views, deadlines, natural-language input и reminders (создать/изменить/завершить/перезапустить и проверить persistence); Memory source→usage, pin/disable, duplicate handling, context budget, backup перед lessons rewrite, archive и overflow. Dossier, Radar и Decisions — самостоятельные авторизованные поверхности по seq1298→1299; каждому дать own route/control/data-flow/status matrix, не поглощать Agent Center budget или Focus acceptance. В Home учесть все 5 widget choice groups и все 20 choices.

### 5.2 Rox UI shell, brand, onboarding, settings/themes (U06–08, U12, U15, U23)

**Navigation precondition:** installed/current Rox, narrow and wide window. Visit every top-level destination and Home. Keyboard tab/activate/scroll overflow; resize sidebar by dragging and hover. **Expected:** all reachable screens remain discoverable, top bar scroll/overflow works, Home is a separate icon, compact sidebar icons align; no resize line obscures content and actual drag resize remains functional. Verify Inter across representative content and wrapping. Repeat at small width and with reduced motion; focus indicator stays visible and target remains usable.

**Brand:** verify source asset provenance points to the latest user-provided transparent `rox copy.png` (do not synthesize). Inspect alpha channel and rendered app icon/header/workspace/splash/onboarding/About at small and large sizes; clear cache/relaunch. Expected no opaque matte or stale icon. If binary isn't present/obtainable, record exact missing prerequisite; don't invent substitute.

**Onboarding:** fresh test profile: enter name only, complete, enter app; provider selection is in Settings and default Rox runtime/models are selected. Quit/relaunch and reopen to ensure onboarding stays complete; then separately clear/restore profile to reproduce stated reappearance. **Negative:** empty invalid name gives actionable validation; provider unavailable leaves user in app with clear state, not false ready. Existing main-code changes are inspected first to avoid duplicate work.

**Settings/extensions:** inspect every Settings page (22-page expected source matrix); compare shared contrasts/titles/locale. Search known extension, filter by tags/groups, sort and reset; no-match empty result and retry. Verify sidebar hover and resize as above.

**Themes:** select each Flexoki Dark, Snazzy, Snazzy Blurred; verify preview, actual text/code/terminal contrast, blur on supported platform, persist after restart and switching away/back. Reduced motion and unsupported blur are graceful and explicit. Capture screenshot per theme. Do not add Zed import or Liquid Glass.

**Residuals:** verify current visible panel radii/background spacing and obsolete `ЕЩЁ`, translation/source wording and duplicate task status before fixing; if already correct, record current proof/no change.

### 5.3 Voice, meetings, session mini mode (U03–05, U11)

**Identify STT:** trace ordinary session microphone input from UI entry to engine/model and execution location; cite exact source/config/runtime observation. Independently trace Meetings transcription. Expected explicit separate identities, not “Whisper” for both by assumption.

**Speech:** with network available, play Russian speech from actual session/message and stop mid-utterance; then block network and invoke system voice fallback. Expected playback starts in app, stop halts, fallback is audibly distinct/clear and UI reports used path. No microphone/captured audio stored unexpectedly.

**Meeting:** record a short authorized sample with at least two speakers, transcribe, edit speaker names, seek from timestamp to source audio; wait for automatic summary/decisions/tasks/open questions; verify linked task and source timestamp. Force processing/transcription failure then retry without duplicate transcript/tasks; restart app and reopen meeting with all edits/results. Microphone-only scope remains; system audio, Zoom/Meet not assumed.

**Mini mode:** start active session, minimize into Mac capsule, observe title/live status, use send/stop/note/voice/expand, compare main session state to capsule; background/foreground, switch session, relaunch. Each action applies exactly once; unsupported/non-Mac environment is BLOCKED for native acceptance.

### 5.4 Projects/planning/graph/Quest (U09, U13, U16)

Create project with goal/outcome and attach real disposable input file/note; create milestones, stages, all four requirement dimensions and tasks. Invoke AI planning over that material; inspect generated spec/decomposition and accept/save, then open Projects/Tasks/Notes. Expected stable project/task/note IDs and same persisted content. Force provider failure; no success toast or phantom entities; retry creates one set. Reload preserves graph and links.

For ordinary session graph context, connect one relevant note/draft and start normal run; evidence shows selected context and session response uses its actual content. Negative control runs with unrelated/no connected note and does not include that content. Existing `rewrite-in-new-branch` support alone is not enough. Reopen note/session and check identity.

Quest: record initial real activity, perform one eligible action, observe precisely corresponding progress/reward/streak; repeat action (idempotency) and restart. Expected no arbitrary demo increment, duplicate reward, or loss.

### 5.5 Collaboration, Team, external connections, budgets/focus/automation/cloud (U10, U14, U17–22)

**Collaborative backend:** two independently authorized test users in one team plus unauthorized third user. Create channel/chat, send as human/agent/bot, comment on message/map node, mention note, hand off and review task, presence, shared skill/automation/memory, Inbox recipient action. Expected persisted same IDs across both users, correct permissions and actual server sync. Third user cannot read/write. Disconnect/reconnect and retry does not duplicate/order-invert. Employee spend only from actual authorized source. Local queues/static UI fail acceptance.

**Connections:** exercise Slack implementation path and Telegram/Discord/Lark/WeChat/WhatsApp/account/import/cookie actions individually in authorized sandbox; show consent and inspect scope before cookie access. Test valid, expired/denied credentials and retry. An unprovisioned local source or missing consent is explicit blocked, not marked broken or complete.

**Budget:** set deterministic test budget, start real foreground and background agent work below threshold, then one run that reaches/exceeds configured threshold. Expected budget state is enforced at execution boundary and no further agent action runs after policy boundary; UI warning alone fails. Retry/reload cannot bypass limit; reconcile exact accounting semantics from actual code/user spec before implementation.

**Focus:** enable interval with one active worker; induce question and background notification, verify suppressed/queued (not shown), end interval, expect each exactly once in original order; interruption/restart/clock-edge behavior tested. Unrelated system notification policy is not implicitly changed.

**Automation:** continue an existing session and inspect same session ID; edit webhook, save, reload, run once and observe recipient receives one expected authorized event. Invalid URL/permission/network failure retains last saved value and clear error; manual-run/CRUD remain regression paths.

**Cloud:** actual loaded Rox handler path against authorized non-production provider; establish connection/status/balance from real response. Force invalid credential, timeout and provider unavailable; truthful actionable states, no secret echo. Daytona execution tested separately only with key/permission; missing key UI is honest but not proof of execution.

### 5.6 Local and external mail (U02 and #380)

Local acceptance: existing Mac/data inspected before change; test account mailbox provisioned through intended registration flow; JMAP credentials live in Keychain; launch-on-login and restart persist. Send unique loopback message, list/open/reply/send, receive second inbound message without manual refresh, verify thread/message identity and no duplicate. Test unauthorized mailbox and failed server/network; deny access and preserve draft. This proves local only.

External acceptance requires operator-authorized staging domain/mailboxes and actual public DNS/reachability. Send from local Rox to controlled external mailbox and receive reply from that mailbox; confirm message at recipient (not only SMTP accepted/logged), check SPF/DKIM/DMARC/reverse DNS/TLS and inbound reachability. No production MX mutation without explicit authorization; no cloud provisioning. Missing domain control/network authorization is BLOCKED with exact prerequisite. Conation #380 needs its own full issue matrix even if components overlap.

### 5.7 Conation seq703 all 16 items (U26; none waived)

Each item is a separate row in suite/evidence: (1) logged-in JWT endpoint usable + real Inbox/Drive/Mail/Chat/Tasks/Agents/CRM rows; negative token rejected. (2) Cargo.lock/wasm-pack/Vite proxy resolved against actual branch; JWT/header rebrand contract; local commit `1a88100ff8` only reconciled, never blind push. (3) onboarding/tutorial skip + OTP success/expired/resend, persistent cookie/storage, generated OpenAPI rebrand, invite vs offer500, clipboard/keyboard/network error. (4) real E2E auth through Home/dashboard/calendar/CRM/reminders/settings/go-to, both sidebars, safe seeded data; forced error captures useful diagnostics. (5) Tauri/Mac build/launch and same scenarios; cookie jar/HMR/WS/`conation://`; browser not substitute. (6) dashboard: empty CTA; DnD row/column/gaps; all 20 preset previews; personal/team/revert; saving/failure; real entity pickers; inspectors list/markdown/timeline/channel-message/calendar/pins/KPI/activity; container tree and top-N/pinned/unread/due-today/agent-run/CRM-follow-up views; reload/hydrate/preview. (7) Inbox Signal/Noise/unread/bulk/swipe/retry/search/filter badge/mounted desktop/density/stable timestamp/detail. (8) Drive empty/error/locale/files/folders/tags/upload + mobile/rename/move/menus/recent/shared/search/preview. (9) Mail locale/reply vs reply-all/compose/address/hover/scheduled clear/threads/forward/drafts/attachments/signature/undo-send/Signal-Noise using real mail. (10) Chat one load error/channel+DM lists/locale/unread/send/mentions/scroll/thread/reactions/search. (11) Tasks badge equals row count/header/error/filter persistence/create/status/assignee/due/sort. (12) Agents retry/locale/Home-consistent composer/reduced-motion wave/session/roster/stop/send/stream/tools/new-chat/switch. (13) Notes independent surface/mentions/share/ask/editor/preview/find; canvas real labeled controls/pointer-pan/typo/media accessibility/mobile upload/retry/empty and explicit Comment/Crop decision; draw/pinch/fit/floating menu/video touch. (14) Home focus/target/examples/composer; Calendar locale/today/create/move/timezone; CRM validation/delete/model/team; 22 Settings pages/toggles/team creation; Search route/go-to; payments permissions/error/mounted-or-removed; reminders persist/repeat/timezone; calls/activity/sharing/mobile touch/spreadsheet/PDF/split. (15) actual motion/easing/press/hover/link/rail/reduced motion, shortcut hints/tooltip dismissal/hit target with smaller text. (16) investigate existing SQS QueueDoesNotExist, absent otel-collector, Lexical down on actual targeted environment as prerequisite; do not provision unrelated infra by inference.

For all applicable surface rows force permissions, load error/retry, saved/reopen and neighboring navigation regressions; each row preserves its own expected/observed proof. A proxy route, mocked rows or one health request is a negative-control failure.

Conation Sharing/iOS share: schedule a fourth named platform-queue slot for the actual supported Conation native target/device/runner after source reconciliation. Preview the exact object/revision/audience, invoke the real native share action, choose a controlled receiver, and verify the payload and same-object return/deep link. Capture evidence for successful receive/return and for cancel, revoke, stale source, and denied target; none may leak or publish. Browser/Mac evidence cannot certify iOS. If the actual target, device, or runner is unavailable, record the precise BLOCKED prerequisite and owner; do not substitute another platform or invent mobile architecture, and do not silently remove U26-R037/R318.

### 5.8 RMA and Golden Gate (U27–31)

Use existing issue acceptance bodies as source of truth, mapped to exact children; no shadow replacement issue. RMA #385: provision only permitted valid E3 fixture/credentials and run actual product path, collect evidence per gate; U1 harness BLOCKED remains blocker. #387 waits for accepted #385 prerequisite, then check packaged upgrade, web, i18n, accessibility. #380/#381/#382 wait for stated prereqs; #389 is P2: choose the SFU/media provider via a separate documented decision including license, deployment and cost; do not implement custom codec/SFU. Test real room join, guest ACL, media tracks, screenshare, reconnect and agent participant with explicit recording consent; use the established Meeting/source/segment model and enforce server-side ACL. Closed #356/#333 remain CLOSED but their acceptance evidence gap is recorded without reopening automatically.

Golden Gate: inventory #541's 25 children exactly: #553 and #555–#578; reconcile against original intended matrix, note #554 absence rather than infer issue. Execute #556/#557/#558 shell-grid/device/spatial; verify #541/#578 full matrix including perf/packaging. Resolve locale denominator (10 vs 12) by authoritative source/issue reconciliation before declare; never shrink matrix to observed easier set or use skipped widget/bot choice as authorization.

## 6. Platform queue and safe execution

Create a queue for four named environments/targets: Linux/cloud, Mac native, Windows native, and the actual supported Conation native iOS target/device/runner. Name each real runner/device and prerequisites; the iOS slot must exercise the existing share action with a controlled receiver and same-object return/deep-link plus cancel/revoke/stale/denied outcomes. If the supported iOS target/device/runner is unavailable, retain the slot as BLOCKED with the exact prerequisite and owner; never substitute Mac or browser or invent mobile architecture. Run platform-independent source/unit validation after owners land; platform-specific visible behavior only on named target. Cloud is a separate target requiring actual authorized environment; documentation or local fake does not count. Schedule queue sequentially when hardware/slots limited, preserve independently available work. Never auto-provision services or expose tokens to logs.

Worktree recipe is mandatory: record repo/path/branch/head/status and diff of pre-existing user changes; create isolated worktree only for path-independent work; store baseline overlay safely outside shared output, do not edit it; integrate only owned diff; verify untouched baseline remains present. Shared registry, RPC schema, locale, lockfile and common UI one owner each (same named interface integrator or explicit co-owner split by file, never multiple writers per file).

## 7. Release acceptance and failure behavior

Before final release, build a matrix row for every requirement in PRD including proposal rows and decision items, every U26 checklist row, every issue/child issue, all relevant platforms. Requested requirements and verification gaps use `PASS`, `FAIL`, `BLOCKED`, `UNVERIFIED`, `NOT_APPLICABLE` with justification. Proposal rows require an explicit source-backed disposition (`PROPOSED`, `ACCEPTED`, `DECLINED`, `ALREADY_COVERED`); an inherited proposal is not automatically an implementation or release blocker. Accepted proposals become requirements only under recorded authorization. Decisions record the resolved authority or an explicit unresolved state without inventing product consent. Only PASS requires exact version/environment/action and expected=observed; fail is fixed and relevant row rerun. Blocked records attempted safe route plus exact missing access/runner/key and owner/next action; cannot silently omit or downgrade. N/A requires evidence the scope is truly inapplicable, not a skipped test.

Negative release gate: if any required row is absent, any original criterion is narrowed without authority, any provider result is mocked, delivery proof missing, user-owned dirty overlay lost, or an unavailable OS/provider is called PASS, release status MUST remain NOT ACCEPTED. Positive gate: every required criterion has real matching observation on platform, version and recipient/provider; durable persistence and adjacent regression pass; issue mappings checked for duplicates; evidence scrubbed; integration diff contains only authorized owned changes; independent reviewer confirms no scope shrink. No build/test/lint/formatter is run by this document authoring task.

## 8. Operational decisions and non-goals

1. U25: leave app behavior unchanged. Resolve source field conflict only; require reliable independent user intent before implementation.
2. Main Rox baseline branding/onboarding claims: audit current runtime before bug filing; target requirements remain if the current code fails.
3. Macro prepared program: link and reconcile; don't launch a rival plan. Any donor code use requires rights resolution.
4. #389: media P2 scope as above. #541 locale count and full children are explicit reconciliation issue, not permission to choose 10.
5. No cloud service provision, MX modification, production message, auth bypass, or user-data migration in handoff authoring.

## 9. Additive project OKR contract — current user requirement

Canonical rows: [requirements-addendum.json](september-program/requirements-addendum.json), `ADD-OKR-R001`–`R005`; owners `OKR-01` and `OKR-02`. These are additional authorized requirements, not changes to the 484 historical IDs.

Use current stable project IDs and ACL. A project/cycle contains Objectives, each with multiple measurable KRs, nonnegative finite weights, owner/source/evidence/freshness and revisions. Normalize weights independently within an Objective and across project Objectives; require positive sums. Numeric score is `clamp((current-baseline)/(target-baseline),0,1)` with nonzero denominator and valid direction; binary achievement requires evidence. Unknown positive-weight rows remain unknown rather than being silently excluded or counted complete. Show known contribution, measurement coverage and unknown total. Preserve draft/publish/cancel/reload/conflict and archive semantics in the existing project data seam; no separate project/task system.

The editor uses hierarchical O/KR cards with progress/status/weight columns, period navigation, add/edit/reorder/delete/save, honest errors and Russian guidance/examples accessible by focus/click, not hover only. Reference screenshots establish interaction patterns, not authority to expose personal image content or copy third-party code.

Daily monitoring is explicitly enabled per project with local time/timezone, sources and recipient/channel configuration. A real durable worker checks current ACL on reads and delivery, persists one dated check-in per project/cycle/localdate, records measured changes and evidence, and reports no-change/no-data/stale/denied/blocked without guessing scores. It can propose measurement updates but cannot silently change Objectives, targets or weights. Pause/stop/revoke prevent future work. Repeated ticks/restart/DST do not duplicate check-ins; offline recovery produces at most one latest missed digest with explicit missed dates.

Notifications consume the same saved check-in and deep-link to it, respect Focus/quiet hours, and distinguish queued/sent/failed/unknown/read according to actual sink capability. Delivery acceptance requires observing the recipient surface, not a queued job or reminder record. External sinks require explicit configured consent; authoring starts neither monitoring nor external sends.

Verification: real two-project persistence/ACL/keyboard/narrow-view checks; exact weighted examples 87.5% and 72.5%; zero/negative/nonfinite/direction/unknown controls; a real scheduled worker plus saved check-in and recipient observation; duplicate/restart/permission/source failure/quiet-hours/pause/stop paths. Missing runtime/source/sink remains a precise blocker, never simulated PASS.

## 10. September implementation status and evidence boundary

Use the existing 109-task DAG (464 dependency edges); do not create a duplicate plan. Preserve the original 484 requirement rows plus 5 additive OKR rows, all 16 Conation seq703 rows, and separate Linux/cloud, macOS native, Windows native, and supported native Conation iOS target/device/runner acceptance. U25 remains FALSE and decision-reconciliation only until reliable independent authorization. Proposals and Macro/Conation source artifacts do not authorize implementation or copying; preserve provenance and rights boundaries. Production cloud provisioning, DNS/MX changes, unauthorized external sends, provider writes, auth bypass, and unapproved user-data migration remain out of scope.

The 32 source reports are historical discovery-only. At that inventory, native Notes used the RPC producer to workspace filesystem, org RPC used local `orgs.json`, and account-replica used in-memory queues; the Rox2 notes Map was separate. Later native authority/journal/encrypted outbox and self-profile implementation has bounded runtime evidence recorded in the current packet. DATA-01 (#1212) and SHARED-01 (#1160) have partial progress, with full original acceptance and contract freeze still pending. Neither is satisfied by its inventory document. Conation Soup/DSS ingestion and all unexecuted AUDIT/DATA/SHARED criteria retain their exact boundaries.

Observed baseline evidence: Electron build passed at `a2a91649a8b7b81e7ce49f59b1d4b7d4ea9a01e2`, build-only. Isolated native launch failed before app startup because the Electron dependency lacked `path.txt` or `dist`. A separate lead observation saw Rox 0.11.5 at Connections / Policies with a visible legacy MORE label; this is not a full UI audit. Do not present any of these as product acceptance.

## Native local startup and bounded Notes acceptance (2026-09-30)

A registered native principal starts from its own durable display name and the currently proved Electron window/workspace. Native startup observes only a four-field configuration-only runtime summary and its own workspace metadata. It does not read or mutate the host account roster, setup credentials, provider auth state or default connection. The server renews the original private window proof before requests and after awaited responses; workspace changes, renderer replacement, window destruction and credential revocation deny subsequent access. Session authorization remains independent: a denied session load is visible while Notes remains available.

The integration must retain actual UI creation/edit/save, canonical file readback, an independently enrolled reader, renderer reload and cold restart evidence. These bounded observations do not accept all original Notes conversion/views, offline/conflict/revoke/workspace-switch UI, DATA/SHARED consumers or platform criteria. Creation and edit must be distinguished when only edit traverses the durable replica outbox. Exact encrypted receipt inspection has a separate evidence limit.

## Native creation durability and lifetime (2026-09-30 follow-up)

Native creation must first obtain a server-canonical no-write plan and current read/write authorization, then persist a main-assigned stable operation in encrypted SQLite before submitting the canonical mutation. The trusted preload accepts an exact authenticated server receipt before main acknowledgement. Renderer title/folder remain user intent; no actor, device, credential, key or receipt authority is delegated. Legacy null planning remains compatible; an authorization or transport error never becomes legacy fallback.

Disposal during context lookup, private IPC OPEN, plan renewal or enqueue must prevent subsequent submission and close any late handle. An already persisted intent remains recoverable with the same operation ID, including a successful commit whose response was lost. A duplicate canonical path must fail without overwrite. Existing edits retain the authoritative snapshot/revision requirement; new offline authoring without a canonical plan and other creation-like routes remain separate work.

Acceptance retains actual new-creation UI/restart and private custody audit in addition to WS/SQLite tests. The follow-up's actual UI gate is pending while the supported Sky surface is unresponsive. Fixture receipt decryption does not accept the private profile's OS custody. The genuine Linux arm64 baseline is a separate source revision and does not stand in for iOS/Windows/cloud/desktop acceptance.

## Runtime privacy and recovery acceptance wave (2026-09-30)

Native Memory responses must omit machine-private preferences at every response depth while preserving authorized workspace content, server-owned lesson identity and explicit provenance. Existing authenticated legacy Memory semantics remain compatible. Grant checks and owner-filtered legacy storage do not establish NativeJournal receipts, team sharing or offline multi-device Memory.

Cookie-key rollback/deletion must permit retry when the protected key was deleted but its recovery phase was not saved. Success requires scoped deletion or authoritative absence, preserving prior and unrelated keys. Darwin CLI exit 44 is ambiguous and cannot establish absence; the private status-preserving Security.framework fallback accepts only success or item-not-found and requests no authentication UI or credential data. Ambiguous Linux results retain recovery bytes and deny completion. Fault injection and the sole synthetic host fixture are bounded evidence, not power-loss or existing-user-key acceptance.

Daily budget recovery must preserve unresolved reservations after actual process loss, block retries conservatively across midnight, isolate workspaces and settle an exact receipt idempotently. Native local work and ledger recovery do not establish paid-provider cancellation or complete runtime enforcement.

The native shell must not request unclassified legacy host session inventory. Absence of that capability is distinct from an authorized Notes operation being denied; genuine authorization failures stay visible. Source contracts and all original task/requirement criteria remain unchanged. The new runtime evidence is bounded by its source hashes and explicit platform limits.

## Native caller inventory continuations (2026-09-30)

Only confirmed local authority may read legacy host session inventory, messages or permission state. Native and unresolved callers mark that inventory unavailable, clear stale host metadata/options/error and establish startup readiness without a denied host request. Initial loading, metadata refresh, session-created fallback and permission reconciliation recheck authority at their asynchronous application boundaries. A late local response or transport-state failure cannot restore host state after a native switch. This restriction does not grant a native session or R1 capability and does not suppress actual Notes authorization failures.

Acceptance combines actual helper callback/race behavior, independent App boundary review, Electron source/UI/core union, TypeScript and renderer rebuild. Native desktop creation/banner readback, private receipt custody and original platform criteria remain separate pending gates. A later scheduler terminal-history candidate is outside this source publication.

---

## Isolated Cloud assembly: original Compound programme contract

The September contract above and the Compound contract below remain independently applicable. This source integration preserves both criteria sets; it does not accept the 109/143/native/DATA/SHARED/provider/iOS or UTB product DoD. Native and platform acceptance stays pending until the existing owner supplies real proof. Inputs: September `ea083e387e170552ee6102e29c2cf31adc8b6973`; Compound `8106f22185fb3b3e9a6a585320d48b1bf5f10fbd`. See `docs/cloud-all-surfaces-integration-20260930.md` for immutable integration and validation provenance.

# ROX compound workspace — реализация

## Активная задача: IMPLEMENT IT ALL, 2026-09-30

Пользователь разрешил реализацию всего доставленного scope. Исследования ниже — архив исходных решений, а не текущий запрет реализации. Рабочая ветка: `feat/rox-compound-workspace-20260930`; отдельный checkout сохраняет чужие незакоммиченные изменения. Immutable исходный spec: `242492868a11b4d9af1c1011f20b31a346875f0a`.

Scope: 143 пакета из `plans/compound-implementation/progress.json`: 52 Macro, 30 Suite и 61 Lark/Docs/Bases/Code Intelligence extension. Реализация расширяет существующие Pages/Notes, Tasks, Projects, Meetings, Sources, Sessions и Automations. Полный feature DoD включает UI, persistence, команды/queries, актуальные permissions, events/search/agents, failure/recovery, functional tests и реальную проверку UI. Библиотека, экран с fixture или опубликованный issue не закрывают feature.

Текущий первый вертикальный сценарий: открыть существующую Note без смены ID/байтов; получить canonical Page alias и source/format status; сохранить через SHA256 CAS и durable receipt; сохранить новый ввод, сделанный во время запроса; отклонить устаревший write; восстановить interrupted WAL. Native RPC принимает только подтверждённый Electron-main local binding + текущий workspace/window. Это device principal; remote/team identity требует отдельного authenticated owner и не считается реализованной.

Параллельные сценарии: существующий Project привязывает реальный Git workingDirectory, получает immutable snapshot, видит commit/dirty version отдельно и открывает ограниченный source excerpt; Главная создаёт task без толстой рамки, с keyboard focus, IME и failure states; lossless Markdown/YAML patches готовят editable Map/Outline без второй canonical tree.

Native save и lifecycle writers используют единый WAL/CAS и vault/file leases. Durable invalidation intent имеет стабильный event ID; accepted означает локальный callback, не client ACK. Dead-owner claim recovery проверяется реальными SIGKILL/SIGSTOP сценариями; TTL не даёт право перехвата живого writer. Произвольный внешний процесс не участвует в OS-level CAS; Windows directory fsync пока не проверен. Rich-block cutover, CRDT, remote users, Base/record owners и cloud coding executor остаются отдельными slices.

Результаты и живые runtime receipts: `plans/compound-implementation/`. Эта активная спецификация заменяет прежнее ограничение «только planning».

Detailed current native behavior and remaining gates: [compound implementation](compound-implementation.md).

# Архив: Macro → ROX, спецификация архитектурного исследования

## Новое уточнение: Lark Suite + переносимые Docs/Bases

Цель: через Codex Computer Use исследовать доступные живые Lark screens и дополнить их официальными источниками; разобрать все названные пользователем Suite/third-party areas; проверить 11 Obsidian references по текущим исходникам и лицензиям; выпустить подробные Rox Docs/Bases PRD, UX contracts, target ERD, automation contracts и independently verifiable implementation plans. Это подготовка продукта, без запуска реализации или cloud jobs.

Acceptance: каждый названный раздел имеет классификацию, evidence status, screens/actions/inputs/outputs/entities/dependencies и ограничения; live capture IDs и hashes локально сохранены; текущие ROX seams имеют SHA/path/symbol; Docs, Markdown/Map/Outline, Comments, Tabs/Columns, Tasks, Bases views, formulas/relations и automations имеют single-authority model, permissions/failure/recovery/agent contracts; machine-readable packages и ациклический DAG проверены; независимая критика закрыта; commit/push/readback документации. Private screenshots/AX/customer identifiers не публикуются. Недоступный экран не называется проверенным; proprietary Lark database неизвестна, reference ERD является conceptual inference.

Latest steering adds OpenWiki + GitDiagram + repogrep.com alternative + MrLesk/groma.md to this architecture packet. Acceptance: actual source SHAs/licenses/pipelines/ROX seams, repository snapshots/claims/provenance/ACL/durable jobs contracts,12 concrete Code Intelligence screens, additional independently verifiable work packages and combined DAG. Extend the existing `packages/shared/src/code-intelligence` capability pack; its types are existing shared files, not proposed new worker paths. No installation, cloud launch or source transmission claimed from planning artifacts.

Delivery also includes separate new GitHub issues for the 46 granular Docs/Bases/automation slices and 15 Code Intelligence slices. They link earlier Suite issues as related broader scope, preserve explicit source/spec revision separation, and receive exact body readback. Their publication prepares implementation work; it does not launch coding agents or satisfy product DoD.

## Новое уточнение: ROX Suite issues по восьми screenshots

Создать 30 отдельных новых GitHub issues в rox-one/rox-one: focus input; Messenger/контакты; Meetings; Drive/Notes/Docs/Wiki/Sheets/Slides/Base/Forms; MCP/admin/Help Desk/Approval/Signature; пять slices Automations. Каждая задача содержит source SHA/path/symbol, concrete UI/input/output/hover/focus/keyboard, механизм/persistence/API/ACL/events, tests/DoD, dependencies и cloud handoff. Частные данные изображений не публикуются. Существующие общие issues связать, не закрывать и не переименовывать. Acceptance: все новые issue IDs/URLs сохранены, dependencies превращены в реальные ссылки, точные body bytes прочитаны обратно с GitHub.

RS scope расширяет предыдущие требования. Первоначальный 61-screen/52-WP manifest описывает Macro integration и остаётся отдельным контрактом; новые Suite requirements требуют своих scheduler packets до dispatch, не считаются автоматически включёнными или реализованными.

## Revision 4: конкретный handoff и проверяемые взаимодействия

Продолжение user intent «continue, improve, enhance, enrich»: улучшить уже доставленный пакет без запуска cloud jobs или реализации продуктовых surfaces.

Observable acceptance: authored collaboration walkthroughs с control IDs/маршрутами/receipts/focus/recovery; field-level domain forms с validation, defaults, coercion, payload mapping и negative examples; русские labels/help для всех48shared controls; полный219-control handoff index и coverage gate; provider-neutral executor RunSpec/schema/resume/cancel/proof contract; current source delta recheck; полные spec bytes в новом digest; независимый challenge, actual planning tests и GitHub readback. Screen count остаётся61: enrichment уточняет существующие screens, не создаёт новые destinations.

Existing source facts, proposed schemas и product runtime evidence остаются разными статусами. Registered canonical dispatcher и money/date/identity conversion не могут выводиться из human-readable label. Historical primary schemas сохраняются; normative amendments должны быть явно compiled и включены в assigned packet.

## Revision 3: повторная проверка, конкретный продукт и cloud delivery pack

Дополнительный user intent: подробно определить каждый экран, размещение внутри существующего ROX, функциональность, inputs/outputs, UI/UX/hover/focus/keyboard, PRD/spec/expected results/DoD/plans для будущего cloud execution.

Observable acceptance:50 current source screens and61target screens;219concrete controls; typed command/query/error contracts and exact user scenarios; source HEAD delta recheck308evidence refs;52per-WPcloud packets with immutableinputSHA/specDigest/ownership/dependencies/UI scope; schemas/gates rejecting forged/stale/fixture/incomplete receipts; independent review+corrections; actual artifact checks+commit/push/readback. Feature implementation/provider/native E2Es не являются scope этой подготовки.

Нормативные документы: `docs/macro-integration/product/PRD.md`, `UI-UX-CONTRACT.md`, leaf screen docs/JSON; `cloud/macro-integration/AGENTS.md`, SPEC/PLAN/EXPECTED-RESULTS and52packets. Historical Revision2 research retained below.

Цель: дать coding agents воспроизводимый план развития существующих ROX surfaces до единого collaborative workspace. Исследование включает продукт, фактические backend paths, persistence, collaboration, authorization, search, agents, cloud dependencies и licensing обоих baseline SHA, зафиксированных в `docs/macro-integration/README.md`.

Acceptance: 24 запрошенных тематических документа; 4 обязательных JSON; 30+ пакетов с зависимостями, точками изменения и проверяемыми сценариями; Macro/ROX/target ERD; 10 обязательных Mermaid diagrams; четыре collaboration sequences; лицензии с отдельными условиями; critical review и Revision 2; evidence с валидными paths/symbols/строками; ациклический implementation DAG; точное разграничение наблюдений и предложений.

Основные ограничения: сохранять native ROX Pages/Tasks/Projects/Meetings/Sessions, React/Electron и рабочие локальные pipeline; не считать agent session human channel; не строить второй entity universe рядом с Rox2EntityRef; не копировать AGPL или спорно лицензированные файлы без разрешения; не объявлять UI макет реализованной функцией; не заявлять прохождение runtime E2E без исполнения.

Метод: source snapshot → independent domain audits → implementation graph → capability inventory → выбор архитектуры → independent adversarial review → Revision 2 → механическая проверка артефактов → commit/push документации. Вывод о неизвестной функции допускает NOT_ESTABLISHED с указанием проверенной области; не превращать отсутствие одного grep match в доказательство отсутствия продукта.

Артефакт является планом реализации, а не реализацией всех перечисленных возможностей. Пользователь запросил архитектуру переноса и work packages.
