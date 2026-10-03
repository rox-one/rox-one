## Golden Gate Settings menu keyboard and field description recovery — 2026-10-03

Owner: pr_scout; merge owner: branch audit lead. Recover useful `settings-menu-navigation` and `SettingsFieldContext` intent from Golden Gate `5def9ffd36dc160fdc7c908784e0ef97ba6a732e` into current SettingsMenuSelect consumers. Current RadixPopover supplies positioning but no list navigation; current Appearance color theme/language/project treatment/status menus and ZenShell material menus also render an unassociated SettingsRow label/description. Preserve current styling, strings, current SettingsSelect behavior and real page callbacks.

Opening focuses the selected available option/list or search field; ArrowUp/Down wrap enabled visible options and Home/End select an active endpoint without committing. Search Home/End preserves native text editing. Prefix/repeated-character typeahead navigates non-search menus; Enter/Space explicitly commit. Filtered-empty or all-disabled lists cannot commit. IME, modifiers, default-prevented events, disabled options/control and obsolete active options are fenced. Keyboard/pointer preview clears on close without changing persisted value. Current custom row label/description IDs and explicit caller labels and composed description IDs name/describe the menu; the standard MenuSelectRow links its own IDs. Radix's real focus lifetime returns normal selection/Escape focus and cleans search auto-focus without an uncancelled timer. Acceptance is actual production row/menu/Radix DOM and adverse controls, source navigation tests, types/build and localization; full installed/native settings-page visual acceptance remains separate.

# Golden Gate surface tab recovery — 2026-10-03

Recover Golden Gate title-loader success-only bounded caching, shared pending requests, failed/offline retry on navigation, and actual SurfaceTabs roving keyboard navigation/close focus. Preserve the current route registries, compact top-bar portal, embedded browser exclusion, authenticated Knowledge API and native authority. No source connection or filesystem authority is added.

## Connections production consumer recovery — 2026-10-03

Owner: pr_scout; merge owner: branch audit lead. Source `86154e8c812746261282bb4c517b16ad7becc0ec` contains absent inspect, reconnect, move and GitHub device-flow consumers; backend dependency #1414 is already merged. Recover those actual controls through the current ConnectionsPage and the inspector connection info section, preserving current overview/import/policy/audit behavior, shell, geometry, retained surfaces and consent. Metadata includes public connection/credential IDs, health, expiry, provenance, fingerprint, credential kind/version and affected consumers/leases; no credential bytes enter UI. Explicit reconnect/move confirmations name the actual active leases and fixed source backend target. Failures stay visible and retryable with sanitized messages.

A committed workspace/selected credential owner fences all late reads/writes, unmount and A→B→A; duplicate writes coalesce and foreign inspect/move receipts fail closed. GitHub login starts only from a user control, permits only the approved HTTPS GitHub device URI/public user code, honors server polling delays and slow_down, and cancels active/late-start flows on cancel, workspace change or unmount. Imported metadata refresh belongs to the captured workspace. Original source branches remain intact. Acceptance is real production page/connection inspector DOM with a synthetic metadata bridge, ownership/denial/timing/cancellation controls, existing UI projections, types/build and all locale gates. Real credential/provider authentication, configured backend migration and full native UI remain separate acceptance.

## Golden Gate persisted panel workspace recovery — 2026-10-03

Owner: isolated `codex/recover-golden-panel-layout-20261003`, source Golden Gate `5def9ffd36dc160fdc7c908784e0ef97ba6a732e`. Restore actual per-workspace auto/columns/grid2/grid3/focus modes and durable row/column fractions through the current panel container and toolbar. A flat keyed slot list keeps drafts mounted across layout/focus/compact changes. Resize previews stay in memory; commit persists, cancellation restores, malformed/foreign workspace records fall back safely, and size changes preserve panel identities/routes. Preserve current native spatial-focus subscription and editing/dialog/IME fences, guarded DOM focus restoration after a focused panel closes, UI-001 geometry/detail/storage guards, current flush shell/navigation and browser-registry lifecycle. Do not replay historical AppShell or source-detail handlers. Acceptance: preference/atom/geometry adverse controls, production panel container/menu/slot and two-axis resize with a bounded editor fixture, cross-workspace/reload persistence, draft retention and focus controls, complete types/bundles/i18n. OS compositor and full release acceptance remain separate.

# Golden Gate meeting request ownership recovery (2026-10-03)

Recover the proven missing request-ownership semantics in the current routed local MeetingsPage: committed workspace generations, latest per-meeting reads, coalesced writes, no stale navigation/errors, and preservation of text edited during submission. Catalogue snapshots retain newer pushed changes. Notes already owns equivalent read/save generations; no unused Notes helper is imported. Source PR584 and adapted-export hashes are in docs/golden-meeting-request-source.json. Microphone/provider/native authorization acceptance remains outside this bounded UI callback proof.

## Golden Gate device diagnostics recovery — 2026-10-03

Owner: integration worker in isolated `codex/recover-golden-diagnostics-20261003`. Recover the genuinely absent native diagnostics slice from preserved branch `codex/golden-gate-workspace`, exact revision `5def9ffd36dc160fdc7c908784e0ef97ba6a732e` (closed unmerged PR #584). Source file hashes and the 90 recovered locale keys are recorded in `docs/golden-diagnostics-source.json`.

The current TopBar and glass navigation remain authoritative. Add only the existing source chip, its lazily loaded diagnostics views and direct device-local IPC/preload wiring. Closed diagnostics perform no native reads, timers or diagnostics chunk loading. Opening shows bounded real device snapshots or truthful unavailable states; hidden/minimized/closed windows and closed popovers cancel work. Native collection accepts fixed kinds and log-source enums, never renderer commands, paths or workspace tokens; only the managed app main frame can invoke it. Logs are bounded and redact secrets, links are rejected and FIFOs cannot block a read. All recovered user strings must retain current locale parity.

Acceptance: native authorization/negative-control/cancellation tests, preload field projection, CPU/network/log collector tests, poller lifecycle and endpoint redaction, headless production chip open/tab/close behavior, package types and WebUI/Electron bundles. This does not establish real hardware permission/compositor acceptance. Remaining Golden Gate recovery clusters are persisted panel workspace/resize, native surface ownership/retention, Notes/Meetings request lifecycle and task catalog; no missing module is accepted merely because it was copied.
## Session UX branch integration — 2026-10-03

Owner: PR scout/integration worker in isolated `codex/integrate-session-ux-20261003`, based on exact #1391 head `ddf97e3d5025288819e0bfdc3b26741f75b6d3b1`. Preserve original branches and all unrelated work. The latest 203-file app completion commit remains substantive; the first four #1391 commits already occur in #1392.

This slice repairs reproducible integration blockers: fixture enrollments must succeed at runtime and narrow their nullable result; native session fixtures must use an actual attachment type; browser model controls must import the pure public model catalog directly so configuration barrels cannot bring filesystem-based managed skill code into the renderer. Acceptance requires relevant native isolation/persistence tests, complete package types and WebUI/Electron renderer builds. Secret credential reads and ASR recording uploads also use one bounded, no-follow opened-descriptor read with before/opened/after/current BigInt file identity checks. Callers must reject links/replacements/growth before publishing keys or uploading foreign bytes. The missing Inbox/Security states require all 22 keys in every current locale catalog. CodeQL findings and real-provider/native hardware acceptance are separate and must not be inferred from build success. `.codegraph/` is absent in this checkout; targeted source/dataflow reads supplied the import evidence.

Integration with current main `d8c92f96363f47e0b72e7296a36aa23a9227a691` preserves its OMP 18.4.12 private native fork and stored-prefix recovery, MCP runtime, Compound additions and UI-001 detail/storage validation. The UI user-message anchor feeds the runtime inclusive native fork. Module imports and fixture aliases use the renamed `@rox` workspace packages; protocol identifiers and legacy migration strings remain unchanged.
## Golden Gate native surface ownership recovery — 2026-10-03

Owner: isolated `codex/recover-golden-native-surfaces-20261003`. Restore the absent owner arbiter, DOM visibility/clipping invalidator, bounds hook, placeholder and retained-surface primitive from preserved Golden Gate revision `5def9ffd36dc160fdc7c908784e0ef97ba6a732e`. `docs/golden-native-source.json` records original file hashes and current-main decisions.

Browser and extension hosts use one compositor contract: the latest visible owner holds an instance; hiding/releasing another owner cannot erase it; bounds writes serialize/coalesce and a final hide cannot be overtaken by a prior update. A partially clipped, hidden, inert, unfocused or overlay-suppressed surface sends null without destroying its persistent native instance. Responsive inspector suppression retains local React state while its subtree is hidden/inert. Inspector cleanup acts only on its claimed id and safely releases late async attachments; it never enumerates and hides sibling instances. Preserve current imported-cookie consent controls and per-request opt-in. Preserve the current explicit SiYuan removal/redirect to Rox Notes, all current inspector rail/layout contracts and external #1400 route/geometry/storage work.

Acceptance: source owner/invalidator/visibility and backend extension lifetime tests, production BrowserPanel/InspectorBrowser/RetainedSurface in headless browser with synthetic native bridge (duplicates, clipping, overlay suppression, draft retention, late attachment and consent), complete types and WebUI/Electron renderer builds, locale parity/sorting/coverage. These prove renderer/RPC ownership behavior, not native hardware compositor acceptance. Panel workspace persistence/resize and current Notes/Meetings/task request lifecycle remain separate recovery slices.

# Unified Rox / Conation / RMA / Golden Gate behavioral specification

## Desktop runtime 0.11.8 delivery — 2026-10-03

The bounded OMP runtime, transcript/branch recovery, ROX context migration, bundled skills and macOS/Windows release work is tracked in [runtime specification](runtime-0.11.8-spec.md) and [parallel plan](runtime-0.11.8-plan.md). This delivery has its own source, native acceptance and release evidence; the broader program below retains its current acceptance state.


## Current target and execution scope — 2026-10-03

Windows10/11, macOS and hosted Web remain simultaneous completion targets. [Current dispatch and unavoidable dependencies](final-readiness/17-parallel-launch-plan.ru.md) preserve every original requirement/DoD and schedule445 executable leaves plus180 parent acceptance rollups. Historical sequential stage notes below do not supersede the user's latest concurrent-work authorization. PR integration and bounded source/fixture/runtime checks do not certify signed installed or production-hosted release behavior.


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

---

## Original UTB starter and strict V1 contract

The following original contract is retained from `8c1b8d95944cc21c4745484ba45edd0cf0afbb73`. Its bounded reference/codec proof does not accept durable Base persistence, CRUD, native renderer, host CAS, two-client/restart, or the remaining UTB product packages. Those gates stay pending.

# UTB-01 programmatic reference validation recovery

Parent: #1296 / draft #1314. Base: `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`. Branch: `fix/utb-reference-strictness-20260930`. Owner: repo_audit; root retains review and delivery. Original feature branch stays unchanged.

## Scope and acceptance

- Preserve the published JSON v1 reference codec, opaque future-version retention, canonical identity keys, limits and five host kinds.
- Validate every own property of direct programmatic inputs, including nonenumerable and symbol keys. Unknown properties must fail with the existing safe error code.
- Reject own accessor descriptors before executing getters. Preserve known inert nonenumerable data fields rather than silently dropping them.
- Read capability evidence only through own data descriptors. Accessors cannot supply positive readiness, runtime or grant evidence; source/host/schema denial and per-capability intersection remain effective.
- Existing 54 tests plus meaningful adverse cases pass with Bun1.3.14 and Node22. Canonical type closure uses real repository sources and package export remains additive.
- Retain exact baseline typecheck failures and separate them from new diagnostics. No global compile gate is removed or replaced by a fixture.

This repair implements no Base persistence, row/schema operations, transport authorization, native editor mount, provider action or locale change. Availability metadata still requires actual owner authorization for every production operation. #1296 remains open until review, integration and its remaining gates; the sixteen subsequent UTB packages are not started by this patch.

## Delivery

Prepare a separate draft PR stacked on the current verified #1314 branch `feat/unified-tables-baserow-20260930`, without modifying that branch. Root reviews the exact code/receipt before publication. Full downstream validation awaits accepted main CI/core repairs; native and complete UTB product acceptance remain separately owned.


## Published September owner update (bac08230), retained scope evidence

## Budget ownership and source index status (2026-09-30)

A new ledger opener must not declare a living reservation owner dead. Persist per-instance ownership with each reservation; process liveness is only a conservative recovery signal, never release or dispatch authority. Ordinary lifecycle changes require the reservation owner. Foreign active usage/reconciliation must fail; exact trusted reconciliation for unresolved work retains its separate boundary. Missing/dead/explicitly closed owners preserve unresolved quota. Unknown live PID, PID reuse and module/worker ambiguity must retain quota rather than infer permission. SQLite contention is bounded, and initialization errors close the opened database before preserving the original error. Same-host/same-version behavior, real provider receipt fidelity and platform/runtime resource limits remain separately measured.

Restore the existing source index STATUS route only for a current local Electron binding and its server-owned workspace. Project only the existing facade's indexed count and primary engine. Native, unbound, stale and foreign-workspace callers remain denied; no new native grant or channel classification is implied. Warmed config preservation and actual TS index readback are separate from cold migration, native-sidecar and whole Sources UI acceptance.

## Scheduler terminal recovery and OMP evidence (2026-09-30)

After a webhook effect, persist an exact terminal history intent in the durable queue before history append. Append by exact entry/attempt key and payload, rejecting conflicts or corruption; remove the intent only after acknowledgement. Same-version restart must recover history without executing the action again. Preserve run, matcher and action identity and block retention while terminal intent, corruption or unreadable queue state could remove recovery evidence.

This contract covers a single scheduler owner and process loss. Existing atomic helpers do not establish power-loss durability. Older binaries cannot read terminal_pending safely: finish recovery using the current version before rollback, or preserve/isolate the private queue for explicit migration. No automatic downgrade is accepted.

OMP acceptance must count actual parent spawn results and establish child readiness before testing the 80ms artificial handshake deadline. Production timeout/cancel/retry/escalation remain unchanged. Full provider, schedule/DST, reminder, UI and platform criteria retain their original scope.

## Local meeting Blob media policy (2026-09-30)

Permit the existing local recording Blob audio consumer through an explicit media-src self/blob directive. Keep all other CSP directives and recording/provider/consent behavior unchanged. Data and disallowed external-origin media stay denied before network. Hidden load-only media controls and renderer build do not accept visible meeting UI, capture or provider delivery.

## PR1313 roadmap integration boundary (2026-09-30)

This additive integration preserves [PR1313](https://github.com/rox-one/rox-one/pull/1313), exact recovered head `5a9bf9cafd7df367f6ac32102b80e777377da162`, as the existing PROJECTS-01/#1194 lineage. The September integration base is `f3987fd7ffcb7f3d582f09d9a8d8a04669877d13`. It ports the roadmap domain, canonical storage/read receipts, ordered renderer save queue, proposal UI and four channels without replacing the current native protocol or authority. Existing Project tabs and OKR remain; Roadmap is an additional tab and separate component. Inspector behavior remains the September behavior.

Each new RPC requires a bound local Electron caller and an exact resolved caller workspace. Native actions remain absent, so this feature adds no native grant. Requested model is configuration intent; effective model is explicitly nullable backend provenance, never inferred from the request. RPC warnings survive success and parse failures, and the UI renders unknown effective provenance plus the backend warning. Configuration metadata is labeled requested separately.

A selected workspace `dailyAgentBudgetUsd` uses the existing durable AgentBudgetLedger before backend creation. Reserve the remaining allowance; release only when query dispatch did not occur. The existing one-shot result has no measured monetary receipt, so every dispatched result/error/timeout retains unresolved quota. A later request cannot create another backend until existing trusted receipt reconciliation resolves that quota. A null/unselected budget does not gain a new mandatory policy. This is conservative admission, not proof that a real provider obeys a dollar execution cap or that cancellation stops remote work.

Acceptance for this wave is bounded local storage, caller isolation, actual method/backend-seam behavior and render output. Full AI roadmap, real paid-provider E3, cancellation, effective fallback verification on a provider, native UI/mobile/platform acceptance and recovery UX remain pending. Canonical JSON and derived Markdown are not one transaction; external writers/symlink replacement races, power loss, crashed writer locks and response-loss reload/compare retain the original documented limits. Legacy unversioned storage inputs remain compatible.

## Built-in SQLite runtime compatibility (2026-09-30)

The current NativeAuthority, NativeJournal, encrypted replica outbox, browser-profile importer, occurrence ledger and owner-fenced AgentBudgetLedger must use the same small synchronous SQLite interface on Bun and native Node/Electron. Resolve only the runtime's built-in provider; do not add a native dependency or alter identity, receipt, encryption, grant, reservation-owner or recovery semantics. Preserve all nine existing consumer/test bodies except their provider imports. This work retains PR1319's adapter lineage while using the current September bodies, including the later budget ownership safeguards.

Both native ESM and the production esbuild CommonJS format must load and execute database operations. CommonJS resolves from its actual filename; ESM resolves from its actual module URL. Bun operations finalize their prepared statement on success and failure, validate SQL eagerly, reject integer overflow and preserve readonly behavior. Closed database/statement operations fail. This is the complete synchronous subset used by these consumers, not general parity between every Bun and Node SQLite API or missing-binding behavior.

The Node CommonJS execution regression is mandatory. The separate Electron regression executes when its installed binary is available and skips explicitly when a frozen-lock headless installation has the Electron package but deliberately omits its binary download. A present runtime's load/execution error fails. The controlled missing-binary fixture copies only public loader/package metadata into its own temporary directory; it changes no installed binary or global environment. An entirely missing declared dependency is outside that fixture's acceptance.

## Roadmap locale completion boundary (2026-09-30)

Replace only the 158 newly introduced Roadmap values in each of Arabic, German, Spanish, French, Hungarian, Japanese, Korean, Polish, Simplified Chinese and Traditional Chinese. Preserve every existing key/value outside that feature and the English/Russian catalogs. Keep exact interpolation multisets, file names, URL prefix, keyboard shortcuts and the 50 MB limit. Consent must still mean transmission on click only; requested, actual and unknown model provenance remain distinct in every language. Preserve all original task/requirement criteria.

Locale-specific zero/two forms are allowed by the existing plural-family contract when English defines one/other. Arabic requires four additional variants for the day and pending-review families: the 158-key fragment alone falls back to English at count0/2 in the actual engine. Preserve that failed observation and exercise the corrected production resources at0/1/2/3/11/1.5. These four derived variants do not add a new domain field or change the English schema. Independently reviewed terminology corrections distinguish Chinese qualitative/quantitative labels and Hungarian page sections from roadmap stages.

Acceptance distinguishes mechanical schema/parity/coverage, independent model language judgment, actual production i18next resource/plural resolution and React rendering from native-speaker review, mounted layout, Arabic RTL/bidi, keyboard accessibility, persistence and the full L10N-01/Golden Gate platform criteria. No complete locale task is accepted by the isolated translation packet.

Resource acceptance uses real constructor faults and throwing operations with the exact adapter on Bun, Node and Electron. Preserve both the original CommonJS import failure and earlier Bun descriptor growth evidence. A plateau while a second fixture connection remains open is distinct from immediate cleanup after that connection closes. No production garbage collection, real-provider receipt, application UI, power-loss or platform acceptance follows from this compatibility fixture.

## Portable native Electron bridge harness (2026-09-30)

Provide a reusable developer probe from the independently accepted revision-2 bridge fixture without embedding host paths, precompiled private bundles, keys or receipt logs. Resolve the checkout and installed Electron dynamically; compile service dependencies from that checkout, load the standard built production preload and bind its checksum plus production source hashes. Preserve actual IPC/window proof/authenticated WS/authority/journal/encrypted queue, exact observed ACK, complete unobserved receipt denial, revocation, foreign-window denial and normal child restart controls.

Only runner-generated synthetic profiles and credentials are permitted. Whitelist child environment and supported ROX/CRAFT configuration directories; never repurpose HOME or use host credential custody. Match production BrowserWindow isolation preferences and keep windows hidden/muted. Record actual main PIDs/exits/cleanup and retain readiness failures. This establishes bounded bridge composition, not full product main/OS custody/UI E3/provider/platform acceptance; no implicit CJS/source SQLite adapter transplant or global dependency installation.

## Bounded linear delimiter parsing (2026-09-30)

The stable team-handle trailing-dot cleanup, bracket file/folder token parsing/resolution and title XML/edit-request stripping must not repeatedly rescan unmatched suffixes. Use forward delimiter scans or backward trailing-dot trim; retain complete input/output, Unicode, encounter order, nonempty path/tag grammar, first closing delimiter, legacy non-nesting behavior and existing sequential replacement order. Do not introduce truncation, new token grammar, identity/storage or authorization changes.

Acceptance is actual existing/adversarial behavior, seeded differential comparison against exact baseline functions and separate bounded timing observations. This narrow repair does not attest linearity of every mention family or eliminate all CodeQL alerts. Timing observations are not brittle unit thresholds or a security-clean claim.


## Projects generation follow-up — 2026-10-02

Owner: isolated Projects producer; September integration, independent review and product rollout remain root-owned. Dependency: current primitive projectsAtom and existing getProjects/onProjectsChanged contracts; exact PR1323 lineage 3cc2483d61e587fa3e3b54331b1bf623206f16b1. Scope is only useProjects lifecycle fencing. Workspace commit clears stale local project entries before paint; obsolete load success/error, callbacks and broadcasts cannot overwrite current scope. Latest same-workspace load/broadcast wins, including effect replay and unmount. Incoming DTOs are restricted to their current workspace while preserving complete metadata. No catalog/schema/store/grant/native authority changes. Controlled hook closure/Jotai evidence does not accept DOM/native/full PROJECTS-01/TEAMS-03/SHARED-01 criteria.

## Focus notification isolation slice (2026-10-02)

Deferred session notifications are identified by workspaceId and sessionId together. Repeated notifications within that pair retain their first queue position, update preview/time and increment count; other workspace entries remain independent. The latest 100 distinct entries remain retained. Disabled session notifications exit before reading/writing the Focus queue, preventing private title/body retention even during active Focus. Existing enabled Focus and normal supported native-notification behavior is preserved. Full Focus navigation, draining, actor scope, timer persistence and product/platform acceptance remain outside this slice.

The Focus page projects deferred notifications only for its current workspace; absent workspace shows no entries. Row identity is the JSON-encoded workspace/session pair. Clicking a displayed row removes only that pair and uses the existing current-workspace session route. Clear Queue removes only current-workspace entries, preserving foreign-workspace records. Global Focus timer/history, other page behavior and actor storage remain unchanged; no cross-workspace navigation or automatic delivery is introduced.


## PR1317 recovery evidence retained during integration

The original recovery spec is preserved in [this historical receipt](integration-history/pr-1317-spec.md). It describes its recorded source revision and does not supersede current September/cloud/native contracts or claim final product acceptance. Unique recovery source deltas are integrated separately.


## PR1320 session recovery historical evidence

Preserved [the original recovery spec](integration-history/pr1320/spec.md) alongside the current integrated contracts. Historical execution claims remain bound to their recorded source.


## Legacy Markdown migration inventory (2026-09-30)

This bounded addition inspects legacy `.rox-docs/commits` without running legacy recovery, publishing content, returning receipt payloads, or acknowledging operations. Its `nativeActivationAllowed` result is always false. Completed records are historical inventory only; prepared, malformed, unreadable, unexpected and symlinked state blocks recovery clearance. No-follow descriptor reads check regular-file identity and parent directory identity before consuming bytes.

The module is deliberately unwired. Recovery clearance is not native ownership, an adoption permission, a trusted receipt, or a complete atomic migration guard. Canonical activation requires serial integration of the authenticated NativeJournal pipeline, private receipt custody, stable operation replay, and an explicitly authorized disposition for existing legacy files. The full compound package acceptance criteria remain unchanged.

Acceptance: real filesystem fixtures preserve inspected bytes and directory entries; prepared and partially applied records fail closed; replacements at the open seam cannot contribute unrelated historical metadata; completed history never authorizes native activation.


## PR1315 portable runtime historical source and evidence

The [original spec.md](integration-history/pr1315/spec.md) and its September task/evidence snapshots are retained under integration-history/pr1315. Their older source and bounded execution claims do not replace current native authority, request fences or later September evidence. Portable recovery deltas are reconciled against the current implementation.


## PR1292 baseline recovery evidence

The [original spec](integration-history/pr1292/spec.md) remains a source-bound historical record. Its descriptor/explicit-clock fixes are preserved in current implementation.


## PR1313 roadmap recovery evidence

The [original spec](integration-history/pr1313/spec.md) is retained as historical scope/evidence. Current merged native authorization, revision/CAS and September model/request safeguards remain authoritative.


## PR1230 OMP/session program evidence

The [original spec](integration-history/pr1230/spec.md) is retained alongside current runtime context, protocol negotiation, child-scoped transport errors and public-model cleanup contracts. Historical acceptance remains source-bound.


## PR1321 sidebar restoration scope/evidence

The [original spec](integration-history/pr1321/spec.md) remains preserved. Current shell keeps persisted sidebar choice across routes and uses the same mounted-rail/effective-collapse contract as the combined rail implementation; bounded source tests and historical native receipts remain distinct.


## Parallel release integration — 2026-10-03

The externally promoted main revision 3dd1f98b77b1428bb03fea4c324d87bace2ea6c6 is reconciled with this independent integration. Its original [spec](integration-history/remote-main-3dd1f98b7/spec.md) and release archive preserve all historical scope. Desktop0.11.6, native staging and dedicated GitHub/CircleCI packaging pipelines are retained; their presence does not establish signed installed Windows10/11/macOS or hosted acceptance. The current [445-leaf parallel allocation](final-readiness/parallel-work/launch-plan.json) governs development dispatch.

## Remaining browser and helper control translations (2026-10-03)

Recover useful missing runtime localization from P35 branches 65, 70, 78, 80 and
103. Browser/VPS buttons, accessibility labels, fallback image text, permission
tool label, recognition language choices and Knowledge omnibox commands must
resolve through the existing translation runtime. Preserve caller-provided page,
plugin and custom labels. New keys must be present and ASCII-sorted in all 12
current locale catalogs; earlier documentation's 10-locale count is stale.

## Branch integration request — 2026-10-03

The authorized outcome is an exhaustive inventory of the live `rox-one/rox-one` branches against main, followed by separate pull requests and integration of substantive additions. All original branches and unrelated working changes must remain intact. The initial authoritative main is `76228cc33e44518e5fab5e59f5c754f4051d1e8c`; GitHub listed 665 live branches. Ahead counts alone are insufficient because the repository uses squash merges.

Classify source changes using exact ancestry, patch equivalence, related merged PR ancestry, and current source semantics. Superseded recovery workflows and obsolete wording tests must not revert current behavior. Each integration candidate requires relevant checks on its exact delivered revision. Existing native/production acceptance boundaries remain in force.

For the runtime lane, preserve the release branch's OMP recovery, mandatory policy, context migration and skill provenance. The exact-head validation failure comprised ten TypeScript errors in three gstack regression fixtures. Correct the mocks and fixture argument validation while retaining every security assertion; exercise the focused suites, full repository validation, runtime regressions and remote CI. Security scan findings require source-based disposition; a passing analyzer job does not prove no findings.

Runtime security follow-up: gbrain sync/dream markers serialize acquisition, stale takeover and release through an exclusive mutation directory. A stale marker owned by a live PID is retained. Only the exact UUID generation acquired by this process can be removed; publication uses exclusive private files. A crashed mutation guard remains conservative rather than being reclaimed automatically.


## Recovered Compound native license evidence — 2026-10-03

Branch audit against main `76228cc33e44518e5fab5e59f5c754f4051d1e8c` found the unmerged native slice in `feat/rox-compound-workspace-20260930` commit `d141e962185fd808f177a2d01760b211f47f0832`. The canonical WP48 backend was already present; the Settings consumer, strict native evidence schemas and typed license audit operation in the existing encrypted Project intent slot were absent. This recovery retains those additions and their original source-bound proofs without replacing newer main contracts.

Acceptance for this integration is the existing canonical authority and credential storage, strict workspace/window scope, one discriminated pending intent, explicit retry/cancel, receipt and independent event replay plus live readback before intent deletion, uncertainty after a lost response, rejection of unknown formats and preservation of the Project intent path. Private evidence retracts when authority or workspace changes. All user-facing labels retain locale parity. No installed identity, license, authorization or release configuration is changed by integration.

Original proof artifacts and the Compound handoff remain historical evidence tied to their recorded September revisions. They do not establish current native pixels, legal approval, complete WP48 acceptance or full program DoD. Current verification is recorded in [the recovery receipt](integration-history/compound-d141e962/recovery-verification.json); delivery is tracked separately; actual native Settings product acceptance remains a separate gate.


## Cursor Cloud headless server setup (2026-10-03)

Port the useful environment setup from `cursor/cloud-agent-env-setup-2fc0` onto
current ROX. Preparation must terminate, use Bun 1.3.14 and the frozen lockfile,
and build the session MCP/server subprocess helpers. The terminal must bind the
server to loopback, isolate development context by default, persist each new
bearer token with mode 0600, and never print its value. Installation or entropy
failure must stop before subsequent work. Hosted Cursor execution and provider
credentials require their own verification. See `docs/cursor-cloud-server.md`.


## Legacy binding replay recovery (2026-10-03)

Recovered binding idempotency: migrating a legacy unencoded four-slot external binding key must preserve entity identity across all identical encoded-key reimports. Foreign workspace, wrong kind and unrelated entity IDs still quarantine. Owner: historical branch recovery. Source: cursor/contract-status-split-93d2 @fa254fe0f2e2504dd399202ee00e2d3b2a8a7b6b.
The canonical and portable gstack browser clients must send authenticated commands only to their selected literal loopback endpoint. HTTP redirects must fail through the existing non-2xx error contract without forwarding the command body or capability. Real HTTP 307/308 negative controls cover both same-origin and another-port destinations; normal authenticated POST commands retain their arguments and tab scope.


## Connections producer recovery — 2026-10-03

Owner: branch integration lead. Source: `checkpoint/session-audit-20260821-craft-agents` at `86154e8c812746261282bb4c517b16ad7becc0ec`. Dependencies: existing WorkGraph canonical SQLite kernel, credential registry/broker, generated Electron preload and trusted local window/workspace transport.

Restore the seven missing Connections controller operations: lease metadata, inspection, backend move, reconnect, GitHub device start/poll/cancel. Preserve current ROX config resolution, credential migration contracts and legacy broker ID-only revoke API. Only metadata may cross renderer transport. Device flows belong to the initiating authenticated local client/workspace; revoked/cancelled or concurrent polls cannot commit a late approval. Existing OAuth client configuration is required; no new client ID, account/device grant or real credential import is performed by this integration.

Backend move must verify destination contents before deleting the source, refuse existing destinations and simultaneous moves, revoke outstanding leases before attempting a move, restore the source and clear the destination on recoverable failure, and return a distinct rollback failure when storage recovery cannot be proven. Real credential/backend availability and OAuth sign-in remain environment-dependent; fixture proof does not certify a real provider or native UI.

The existing Connections UI remains a separate consumer recovery; this PR restores its missing backend and transport dependency. Acceptance: original source branch retained; current strict types and the configured validation assertions; real temporary SQLite audits and workspace isolation; generated channel/access inventory; deterministic memory-backend write/readback/delete/rollback failures; OAuth pending/approved/cancel race and concurrent-poll controls. Record exact delivered revision and test receipt under `docs/integration-history/connections-86154e8c/`.

## Native Notes Knowledge read projection (2026-10-03)

Recover the useful read-only local-Markdown Knowledge API from codex/rox-ui-dev-loop-20260901 @1f56af31d3658ee9880105361ad5312324f36ab8 as a projection of authenticated canonical Native Notes. List connections, capabilities, ranked search with path/attribute/notebook filters, get, context and backlinks must use the current journal-backed Notes reader and captured authorization fence. Local references retain the current wire contract with provider local-markdown and workspace connection ID. No credential/default connection is persisted and no alternate filesystem producer exists. Mutations, automatic provider promotion, watch and external deep links stay unavailable. Agent native reads remain unavailable until the host supplies authenticated session delegation; session/workspace IDs cannot create a NativePrincipal.

## Bounded historical recovery: browser registry ownership (2026-10-03)

Owner: historical branch integration. Source: `rox-workbench-convergence-bb11` at `07a954df1a19a80d9fcd6670916ff2a779f2e850`. The source's browser lifecycle extraction kept OS-window IPC state independent of visible chrome. Current main retains the guarded, workspace-filtered hook but only mounts it through BrowserTabStrip, which the default browser-surface preference hides. Toolbar browser status therefore has no state producer in that configuration.

AppShell must mount one nonvisual registry inside its workspace provider while browser-surface mode hides the strip; otherwise the visible strip retains ownership. Mini mode has no strip and owns the registry directly. This recovers list/state/removal/interaction updates without adding OS-window chips to SurfaceTabs or changing current glass/navigation, embedded browser ownership, authorization, or the explicit disabled SiYuan decision. Flag transfer and unmount must clean subscriptions/timers and discard late IPC results. Acceptance is actual component/hook behavior with real Jotai atoms and substituted scheduling/IPC, existing browser/chrome tests, and renderer types/build; installed native UI acceptance is separate.

## Bounded historical recovery: Meeting profiles, slash and followup planning (2026-10-03)

Owner: historical integration. Retained sources: `cursor/meetings-shared-skills@8a9bdf2fb790f54b817afe28ef7818999732f888` recipes and `cursor/meetings-server-core@e665e88c9c89975f154e047707075933eceec71f` followup. Profiles bind current packaged role perspectives, playbook/output schema and permitted slash intent. Today's routed LocalMeetingDetail consumes these profiles through its existing explicit analysis callback, current durable claim/attach/finish extraction, ordinary `safe` agent session with no source tools, and source-revision checked result parser. Selected profile persists in the current LocalMeetingStore. The explicit empty source selection must override newly provisioned built-in/workspace defaults and remain empty in managed and persisted session state; no model request is needed to verify that source/default boundary. Unknown/unpermitted slash does not create an agent session. Profile metadata grants no new tool rights; output remains transcript-backed proposals through the existing summary JSON/citation contract.

A separate read-only `meetings:planActions` RPC requires a currently verified NativePrincipal and native read fence. It binds planning to an existing canonical MeetingJournal revision, rejects foreign workspace/meeting/path inputs, and revalidates before exposing its projection. A read-only journal reader must not create directories, acquire writers or quarantine/repair corrupt tails. Followup planning projects cron/occurrence, missed-run, retry, budget, cancellation, device availability and fresh-send rules; it writes no independent schedule JSON and emits no external effect or verified execution receipt.

Investigated alternatives: legacy SessionManager followup restored writable JSON grants and invented system/host identity; it is rejected. Current MeetingDispatcher has no composed per-session authenticated MeetingBackendFactory; current scheduler context has no verified principal/executor delegation port. NativeJournal replicated Meeting entities have no current producer, so the existing MeetingJournal remains the planning source rather than invented migration. Consequently background role execution and followup effects explicitly refuse with `meeting-backend-delegation-unavailable` and `followup-principal-executor-unavailable`; this bounded recovery does not accept native background execution, production cron followups or external sends.

## Voice command transport recovery — 2026-10-03

Recover the missing actual keyboard producer from feat/voice-v2-p0 @1dd90c5031087855e72cd3ecfce7dd057a2a6208 and cursor/meetings-electron-overlay @c0ef036e onto current native voice contracts. Toggle/cancel commands must target one managed window with an authenticated native client handshake. A foreground Right Option press/release pair in the existing push-to-talk preference starts/stops current composer capture; blur or cancellation revokes the held request. No global modifier-only key-up claim, raw IPC fallback or broadcast is permitted. Plain Escape remains a foreground key and keeps normal idle UI behavior.

Keep current cloud consent, host permission, request generation and ASR result authority. Release during a pending microphone request cancels before any late prompt/capture can complete, and cancellation during finalization prevents stale transcript insertion. An idle or failed-start composer cannot cancel a different composer's host recording. Current source modules own backend identity, local/cloud engine policy and native meeting journals; the old singleton/duplicate server backend are not imported. Native microphone/global-key/visual acceptance remains a separate gate.

## Selective editor recovery from September source — 2026-10-03

Branch `codex/rox-ui-dev-loop-20260901` at `1f56af31d3658ee9880105361ad5312324f36ab8` contains absent heading/task-list folding, resizable two/three-column document blocks and portable spoiler/details controls. Recover only these editor behaviors onto main `3d04470f9be127945dd15c582775ed1e0401ed50`, with actual Notes/slash-menu consumers. The source's larger UI rewrite and legacy filesystem provider are outside this PR; native authenticated Notes authority and canonical mutation/journal paths remain authoritative.

The default legacy Markdown engine and official engine must preserve content across parse/edit/export/reopen. Recover the source's portable `:::rox-columns`/`:::rox-column` syntax with validated normalized widths, support the previous slash-menu `:::columns 2/3` aliases, and preserve Obsidian `[!spoiler]-`/`[!details]+` markers without escaping away their meaning. Fold preferences are scoped by workspace/document and separate from Markdown. Read-only callout/resize interactions cannot change document content. Preserve newer comments, mixed task-list handling, trailing nodes, controlled echoes and no-save authority flips. Labels exist in all 12 current locales. Source tests/builds establish bounded integration; native visual interaction acceptance remains separately verifiable.


# Credential locator boundary validation — 2026-10-03

Owner: locator boundary-validation lead; independent reviewer: integration-status worker. User authorization includes source repair, GitHub delivery and merge into main. Initial reproduction base: `635fc495d02c3fe1380740444cb90cf4fbdb58d9`. PR #1407 independently delivered the same executable own-descriptor correction during this validation. PR #1408 preserves that production source and its 54 regressions, and adds 64 cases covering attachment, disk reload, persisted nonmutation, frozen records for all variants and ordinary Proxy get traps.

`validateLocator` must derive the discriminator and every required provider field exclusively from own enumerable data descriptors. Missing fields reject even when Object.prototype supplies data or getters; validation must not execute inherited getters or ordinary locator get traps. Preserve rejection of symbols, accessors, hidden/unknown fields and custom/null prototypes, string normalization, and valid frozen records.

Acceptance covers all ten provider variants through real registration, provider replacement, attachment and disk reload: invalid input cannot change registry or persisted metadata; corrupt persisted rows are skipped without repair writes. Focused regressions must fail on the base and pass on the correction. Full core tests, core TypeScript, unchanged validate:ci, relevant hosted CI/lifecycle checks, independent review and exact remote merge readback establish delivery. No deployment or native UI acceptance is inferred.

## Credential locator inherited-field repair — 2026-10-03

Owner: `fix/credential-locator-own-fields-20261003`, based on main `635fc495d02c3fe1380740444cb90cf4fbdb58d9`. PR #1317 is already merged; this follow-up closes its inherited-field validation gap.

Credential locators must contain their discriminator and every required value as their own enumerable data properties. Capture descriptor values into a null-prototype record before dispatch or normalization; never evaluate an own or inherited getter. Inherited `Object.prototype.value` must not turn an accessor descriptor into a data descriptor. Preserve valid frozen/readonly records, exact field allowlists, registry identity and persistence formats. Failed registration and provider replacement must leave registry state unchanged.

Acceptance: negative data/getter cases for every locator variant and required field, zero getter invocations, unchanged state after rejection, existing valid/frozen positives, complete core suite and TypeScript, unchanged comprehensive CI command, and actual built-server HTTP/WebSocket authentication, shutdown and persistence/restart checks. Bind results to the delivered revision; Linux reproduction and hosted macOS checks are separate evidence.


### Session project membership metadata recovery (2026-10-03)

Recover durable `projectIds` from the cumulative Voice/Meeting branches in the current session owner. `projectId` remains the primary/default compatibility field; the full unique primary-first set is grouping metadata, never project permission, source readability or agent-context authority. Existing primary setter, bulk replacement and task-draft reconciliation update both fields. Current collection filters match secondary metadata memberships; unlinking a primary promotes the next metadata entry and preserves session/transcript. Project deletion updates the live workspace session owner before the existing disk fallback, and external metadata reconciliation/persistence protects the pair. No extra RPC command, grants or parallel membership store is introduced.
## Recovered connection audit action projection — 2026-10-03

Owner: branch integration lead. Source: checkpoint/session-audit-20260821-craft-agents @86154e8c812746261282bb4c517b16ad7becc0ec; dependency: delivered Connections producer PR1414 and current canonical WorkGraph SQLite. Recover the missing additive schema3 action column and creation audit projection. V1/V2 migration SQL/checksums must remain identical; migration3 SQL matches the source. Older ledger rows remain immutable and expose event type as the fallback action. Only metadata action labels cross transport; never restore payload content.

Verify a populated schema2 fixture upgrade, unchanged older checksums/rows/installation, schema3 restart, current actions plus creation event, foreign workspace exclusion and update/delete trigger refusal. The negative control runs the actual new test against unchanged main. Existing kernel/connection/revalidation and consumed server types must pass. Deliver independently and retain the source branch. This supplies audit metadata for the separately recovered Connections UI; no native/provider acceptance is claimed.

## Explicit Connection host import recovery — 2026-10-03

Owner: historical branch worker; integration owner: branch audit lead. Source `checkpoint/session-audit-20260821-craft-agents@86154e8c812746261282bb4c517b16ad7becc0ec` supplies missing production host-runner wiring in workgraph Git/local import adapters. Current Electron local-only import RPC handlers already call these adapters after explicit source/candidate selection. Preserve current broker, provider, scopes, validation and copy/reference semantics.

Selected commits use existing Git credential fill, Docker helper get, AWS credential_process, macOS Keychain metadata/password and SSH-agent public-key runners. Internal injected low-level runner ports permit deterministic tests; IPC requests cannot provide executable callbacks. Git/Docker/AWS candidate preview calls acquire no helper secret and execute no credential_process; Keychain preview reads service/account metadata only; SSH preview reads public identities only. A candidate must exist in a fresh discovery before any password read or provider copy/Connection creation. Secret-reader errors fail closed through existing parsers with generic refusal errors; SSH imports remain references and copy no private key.

Keychain selected-target lookup retains the exact discovered service/account, including slash characters; ambiguous legacy candidate IDs fail before secret access. Tests use only temporary fixture configuration, injected runner output and an in-memory credential backend, never actual host secrets. Acceptance covers consumed adapter behavior and existing importer/parser/handler invariants, plus server and Electron type checks. Actual platform prompts, installed native/UI interaction and real user credential import remain unexercised; the current production process-runner contract is reused rather than represented as new process isolation.

### Calendar synchronization ownership recovery (2026-10-03)

Restore the per-account stale-response fence present in `feat/voice-v2-p0` and the cumulative Meetings branches, adapting it to the current `CalendarStore`. Only the most recently started connected-account sync may commit events, conflict snapshots, cursor and sync timestamps; a later failed request still supersedes an older response. Revocation invalidates outstanding ownership, and different accounts retain independent syncs. Request ownership is process-local and must not be serialized as credential or provider evidence. Current tuple identity, local-draft conflict review and unavailable production adapters remain authoritative. This bounded recovery does not establish live calendar-provider access.


### Voice archive consumer recovery (2026-10-03)

Selective recovery of the real `VoiceSettingsSection` consumer in preserved source `c0ef036e9c9b627589ad4e2a055abac0212b4295`. Current Settings now searches/pages history, opens actor-owned details, appends immutable manual transcript revisions with expected-selected compare-and-swap, selects owned revisions, confirms deletion, exports TXT/JSON/SRT and plays owned audio. Manual edits do not fabricate timestamp alignment; select an ASR revision for timed SRT. Audio is read in 192KiB frames from the actor-owned canonical original, validates file identity/timestamps and path ancestry on each read, carries a fixed stream identity, and verifies the complete original SHA-256 before a renderer playback Blob. Absolute file paths never cross the history/export/audio ports.

Explicit delivery defaults to current draft. The persisted clipboard choice and explicit copy action use a local-only Electron handler, current server-minted binding/workspace/managed-window owner and native write permission; remote clients cannot invoke server OS clipboard or playback. Tests inject the clipboard writer and synthetic WAV fixtures, without accessing user audio, host credentials or actual OS clipboard. Existing cloud/Edge/enhancement/web consent and native actor/permission fences remain canonical. Current mounted Settings/composer generations own outstanding replies, playback URLs and cleanup.

Current foreground PTT also restores the explicit Right Control and disabled presets alongside the default Right Alt/Option. Stored current-schema preferences are normalized and consumed by the same managed foreground key owner; left/wrong modifiers remain untouched, repeat is paired once, changed held modifiers cancel once, and the existing key-up completion contract survives mode changes. These controls do not claim OS-wide modifier capture.

An explicit current-schema trailing-space preference applies to draft and clipboard completion, while the missing/legacy preference preserves current no-trailing-space behavior. Real Chromium completion controls verify both targets.
## Validated personal task file/cache imports — 2026-10-03

Owner: historical worker; integration owner: audit lead. Golden source `5def9ffd36dc160fdc7c908784e0ef97ba6a732e` supplies absent consumed malformed-row validation in `tasks/presentation.ts::parseTaskImport`. Recover its intent at current canonical `PersonalTaskStore.tryFromJson`, which actual TasksPage file import and cache loading already consume. Validate task and related bundle rows, nested current links/checklist/recurrence/reminder metadata, finite numeric values and duplicate row identities before constructing the store. Retain current v1/missing-version and missing-collection compatibility, all eight current link kinds and unknown future fields; do not revive old CatalogPanel or its four-kind link restriction.

Malformed rows return the existing quarantine/invalid-shape result with exact original raw bytes. Cache quarantine retains the canonical original and stages later edits; actual file import shows the existing translated failure and makes no persistence call. Valid input merges through the existing persistence port, without changing current native write authority or synchronization. Tests execute actual TasksPage onImport with fixture Files and a controlled persistence port, current cache behavior, malformed-row matrix and modern positive roundtrip; no server/native mutation is issued by verification.

## Scoped Notes comment drafts — 2026-10-03

Owner: historical worker; integration owner: audit lead. Source `codex/golden-gate-workspace@5def9ffd36dc160fdc7c908784e0ef97ba6a732e` supplies a missing workspace/document-keyed quote/body draft map for the actual NativeNotesPage floating comment composer. Switching document or vault cannot retarget an unsent selection/comment; returning to the original document restores its draft. Captured edit/clear callbacks update their original key, and no bound workspace/document means no draft acquisition. Scope keys use JSON tuple encoding and empty entries are removed.

Recover only this source helper and current page wiring, retaining today's native Notes write authority, mutation revision checks, editor/chrome/layout/focus and comment persistence. Drafts live in the mounted page state and are not durable storage or server write receipts. Verify by executing delivered NativeNotesPage state/setter declarations across route changes, stale edit and clear callbacks, unbound scope and delimiter collisions, with an exact current-main negative control. Native installed UI and relaunch persistence are outside this bounded recovery.

Review qualification: each audio frame binds the opened leaf to captured BigInt dev/ino identities for every ancestor before any read and rechecks them after the frame; canonical path equality alone is insufficient. A deterministic real-directory replacement fixture returns a foreign frame on the earlier helper and rejects before any foreign descriptor read after the repair. All19 newly added labels have authored translations in all12 locales. Native WS fixture initialization is sequenced through authenticated read readiness; 500ms transport and 20s test deadlines, concurrent capture and all privacy assertions remain intact.

## Golden service navigation and workspace guidance recovery — 2026-10-03

Owner: historical branch integration. Source `codex/golden-gate-workspace@5def9ffd36dc160fdc7c908784e0ef97ba6a732e` consumed `focusServicePanelAtom` from ActivityRail and persisted onboarding dismissal through `sidebar-guidance`. Current AppShell root handlers instead replace the focused route, losing a route/draft when the service is already mounted elsewhere. Root service selection must first focus an existing matching panel, preferring the already focused one, through the current single panel-stack owner. If absent, use the current 12-service registry's route. Explicit source filters and Settings subpages retain their normal routes; compact bare Settings retains its drill-in behavior. Preserve panel identities, routes, proportions, mounted views and drafts, current chrome flags, one primary sidebar and disabled SiYuan decision.

The current flat onboarding card gains a localized dismiss control. Its existing source-compatible local-storage key is scoped to the captured workspace; only boolean true hides onboarding, and measured reminders and Memory settings are unaffected. A late callback may persist its original preference but cannot focus the new workspace's profile. Current visible-DOM sidebar keyboard/disclosure navigation remains its existing owner; the old two-sidebar layout and service context presentation are superseded by current application sections. Acceptance exercises actual AppShell and SidebarChrome callbacks with current Jotai atoms and controlled storage, existing keyboard/panel/promo tests, and installed Electron TypeScript. Native visual acceptance remains separate.

Voice archive follow-up: open the leaf with NOFOLLOW/NONBLOCK before validating its regular-file size and current path identity, then verify all ancestor identities before any read and after the frame. This removes reliance on a pre-open leaf path stat while retaining bounded/no-read failure controls.
