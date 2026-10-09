# Port slice briefs (wave 1)

Contract for the eight parallel implementation slices. Each slice: one git worktree, one branch,
one owner. Read your recon report (`agent://Recon<Name>`) — it contains exact landing zones, reuse
inventory, risks and drift.

Worktree map:

| slice | branch | worktree | recon report | ledger rows |
|---|---|---|---|---|
| S1 multiuser-core | `port/slice-1` | `~/Projects/rox-port-s1` | `agent://ReconOwnership` + `agent://ReconPresenceUI` | a1.1, a1.3, a1.4, a2.4(server) |
| S2 multiuser-ui | `port/slice-2` | `~/Projects/rox-port-s2` | `agent://ReconPresenceUI` | a2.1–a2.5 |
| S3 webui-security | `port/slice-3` | `~/Projects/rox-port-s3` | `agent://ReconDashboard` | b1.4, b1.5, b1.6(partial) |
| S4 skills-surface | `port/slice-4` | `~/Projects/rox-port-s4` | `agent://ReconSkills` | c2.2–c2.4, c2.7 |
| S5 memory-recall | `port/slice-5` | `~/Projects/rox-port-s5` | `agent://ReconMemory` | c1.1–c1.4 |
| S6 meetings-observe | `port/slice-6` | `~/Projects/rox-port-s6` | `agent://ReconMeetings` | d2.1–d2.3, d2.8 |
| S7 lifecycle-service | `port/slice-7` | `~/Projects/rox-port-s7` | `agent://ReconLifecycle` | e1.2–e1.5, e2.1 |
| S8 voice-realtime | `port/slice-8` | `~/Projects/rox-port-s8` | `agent://ReconVoice` | d1.1–d1.3, d1.5, d1.6 |

## Rules that apply to every slice

1. **Frozen shared interfaces already exist on your branch** (from the interface-freeze commit):
   `packages/shared/src/protocol/channels.ts`, `routing.ts`, `dto.ts`, `session-attribution.ts`,
   `packages/shared/src/sessions/types.ts`, `packages/shared/src/service-lifecycle.ts`,
   `apps/electron/src/transport/channel-map.ts`, `apps/electron/src/shared/types.ts` (ElectronAPI),
   and `packages/server-core/src/collaboration/session-activity-tracker.ts`.
   **Do NOT edit any of those files** except where your brief explicitly says so. If you need a
   change there, implement everything else first and report the exact needed change in your final
   report (the lead will apply it).
2. **i18n staging.** Do not touch `packages/shared/src/i18n/locales/*.json`. Stage every new
   user-facing key in `docs/openclaw-port/i18n/<slice>.json` as
   `{"<key>": {"en": "...", "ru": "..."}}` (ru = natural Russian, product voice per `DESIGN.md`).
   The lead translates and merges into all 12 locales. Use keys exactly as listed in your brief.
3. **Ledger.** Do not edit `docs/openclaw-port/STATUS.md`; report row status + evidence in your
   final report.
4. **No AI attribution** in commits or comments. Conventional commit messages.
5. **Do not run repo-wide gates** (`validate:ci`, `typecheck:all`, full `bun test`) — they take
   ~15 min and your siblings are working. Run only the focused commands listed for your slice.
6. **No stubs, TODOs, placeholders or fake fallbacks.** Every shipped path must be real behavior
   with a test or an exercised runtime check. If something cannot be completed honestly, leave it
   out and state it in your report.
7. Commit on your own branch. `git add` only your slice's files.
8. Report at the end: rows status, files, exact commands run + observed results, commit sha,
   deviations/uncertainties.

---

## S1 — multiuser-core (server)

**Goal**: sessions carry honest attribution; presence/typing is live and ephemeral; sharing
visibility is enforced server-side.

**Already implemented by the interface-freeze commit** (do not redo; extend and harden):
`SessionManager.assignSessionOwner` / `setSessionVisibility` / `broadcastSessionActivity`, the five
`SessionCommand` arms in `handlers/rpc/sessions.ts`, the dedicated `sessions:assignOwner` handler,
and `collaboration/session-activity-tracker.ts` (TTL-60 s typing + per-connection viewers).

Deliver on top:
- `creator` captured at session creation and never overwritten (`SessionManager.createSession`
  internal options; see `agent://ReconOwnership` §REUSE). If the freeze already set it, verify with
  a test that a later `assignOwner` cannot rewrite `creator`.
- `participants` maintenance: dedup by accountId, cap 32, updated when an actor is assigned or
  writes to the session; persisted via `SESSION_PERSISTENT_FIELDS` (already frozen).
- Presence/typing hardening: TTL sweep interval, bounded maps, heartbeat on watch, and confirm the
  native projection (`native-session-scope.ts`) forwards `session_typing`/`session_presence`/
  `session_owner_changed`/`session_visibility_changed`.
- **Server-side visibility enforcement** on `sessions:sendMessage` and `sessions:command` for
  non-owner actors: `read-only` → typed error (`SESSION_READ_ONLY` code), `draft` → typed error
  (`SESSION_OWNER_ONLY`), `shared`/`suggest` → allowed. Owner = `owner?.id` if set else `creator.accountId`.
- Tests: new `packages/server-core/src/sessions/__tests__/session-attribution.test.ts` and
  `session-visibility.test.ts`; extend the sessions RPC handler tests for `sessions:assignOwner`.

**Owned files**: `packages/server-core/src/sessions/SessionManager.ts`,
`packages/server-core/src/handlers/rpc/sessions.ts`,
`packages/server-core/src/handlers/session-manager-interface.ts`,
`packages/server-core/src/collaboration/session-activity-tracker.ts`,
`packages/server-core/src/handlers/rpc/native-session-scope.ts`, plus your new test files.

**Verify**: `bun test packages/server-core/src/sessions/__tests__/` (focused files you touched),
`bun test packages/server-core/src/handlers/rpc/` (sessions-related files), then
`cd packages/server-core && bun run tsc --noEmit`.

---

## S2 — multiuser-ui (renderer)

**Goal**: shared workspaces feel alive: owner chip + assign submenu, participant history, live
presence avatars, typing indicator, "involving me" sidebar filter, sharing/visibility menu.

Deliver (per `agent://ReconPresenceUI` landing zones):
- Owner chip on `SessionItem` + session header (`ChatPage.tsx`), with assign/unassign submenu in
  `SessionMenu.tsx` + `useSessionMenuActions.ts` (dispatch via `window.electronAPI.assignSessionOwner`
  or `sessionCommand({type:'assignOwner'})`).
- Participant history rendering (creator vs owner vs participants) in the session header popover.
- `SessionPresenceAvatars.tsx`: replace the one-shot poll with live updates from the new
  `session_presence` events (subscribe via the existing `onSessionEvent` path in `App.tsx`; add
  explicit branches — do not restructure the event processor).
- Typing indicator above the composer, driven by `session_typing`; send typing beacons through
  `sessionCommand({type:'setTyping', typing})` (debounced, cleared on send/blur).
- Sidebar filter: `involving me` / owners section in `CompactSessionListFilter.tsx` + `AppShell.tsx`
  (server-evaluated over participants when available; fall back to local match on `creator`/`owner`).
- Sharing menu: visibility selector (`shared|read-only|suggest|draft`) + copy-link stub-free
  behavior: reuse `sharedUrl` when present, otherwise hide the copy action.
- Tests: extend renderer component tests near the touched components (follow existing patterns in
  `apps/electron/src/renderer/components/app-shell/__tests__/`).

**Owned files**: `apps/electron/src/renderer/components/app-shell/SessionItem.tsx`,
`SessionMenu.tsx`, `SessionMenuParts.tsx`, `SessionPresenceAvatars.tsx`,
`CompactSessionListFilter.tsx`, `AppShell.tsx`, `apps/electron/src/renderer/hooks/useSessionMenuActions.ts`,
`apps/electron/src/renderer/atoms/sessions.ts`, `apps/electron/src/renderer/pages/ChatPage.tsx`,
`apps/electron/src/renderer/App.tsx` (event branches only), plus your test files.

**Verify**: your component tests + `cd apps/electron && bun run typecheck`.

---

## S3 — webui-security

**Goal**: the browser dashboard ships with real security headers, a single-use pairing handoff and
an origin allow-list.

Deliver (per `agent://ReconDashboard`):
- `packages/server-core/src/webui/csp.ts`: `buildWebuiCspHeader(html)` with hashed inline scripts
  (`'sha256-...'`), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `connect-src 'self' ws: wss:`, `img-src 'self' data: blob:`, `script-src 'self' <hashes>`,
  `style-src 'self' 'unsafe-inline'` (the shell uses inline styles — keep it honest and documented).
  Apply to every response from `createWebuiHandler` (index, login, static, API).
- Single-use handoff token: mint/redeem in `webui/auth.ts` (hashed at rest, TTL ≤120 s, single
  redemption, never in query strings), a `GET /handoff` route that consumes it and sets the session
  cookie, and redemption of the URL fragment in `apps/webui/src/adapter/transport-bootstrap.ts`.
- WS origin allow-list enforced at upgrade for webui-authenticated connections in
  `packages/server-core/src/transport/server.ts` (configurable, loopback-safe defaults; reject
  mismatched origin before authentication completes).
- Tests: `packages/server-core/src/webui/__tests__/csp.test.ts` (hash + header assertions),
  `handoff.test.ts` (mint/redeem/expiry/replay), extend `http-server.test.ts` (headers present on
  all routes).

**Owned files**: `packages/server-core/src/webui/*`, `packages/server-core/src/transport/server.ts`,
`apps/webui/src/adapter/transport-bootstrap.ts`, `apps/webui/src/login.html`,
`apps/webui/__tests__/*`.

**Verify**: `bun test packages/server-core/src/webui`, `bun run --cwd apps/webui typecheck` (if that
script exists; otherwise `bun run build`), and a runtime check with `startWebuiHttpServer` +
`curl -sI` showing the security headers.

---

## S4 — skills-surface

**Goal**: the 330-skill catalog reaches the agent's prompt and tools, with honest gating.

Deliver (per `agent://ReconSkills`):
- Extend `parseSkillFile` to read `metadata.openclaw`/`metadata.rox` frontmatter (`requires.bins`,
  `requires.env`, `requires.config`, `os`, `skillKey`, `primaryEnv`, `homepage`) into
  `SkillMetadata` (additive; existing packs already carry it).
- New `packages/shared/src/skills/eligibility.ts`: `SkillEligibilityReport` with reasons
  (`operator-not-allowed|missing-bin|missing-env|missing-config|os-mismatch|disabled-pack`) and
  collision reporting (winner + shadowed list) using the existing ordered root plan; bin checks via
  `Bun.which`/PATH probe, env checks against the credential fabric/service keys (never a new store).
- `<available_skills>` block appended to the OMP spawn prompt in
  `composeOmpAppendSystemPrompt` (bounded: cap entries and bytes; group by source; include
  description + when-to-use hint).
- Host tools `skills_search` and `skills_read` in `packages/session-tools-core` (schema + handler +
  registry wiring), exposed through `buildSessionToolDefs` so OMP sees them; results are plain text
  (name, description, path, excerpt/body) and paths are confined to the skill roots.
- `skills:getEligibility` handler in server-core (channel + ElectronAPI already frozen).
- Tests: `packages/shared/src/skills/__tests__/eligibility.test.ts`, prompt-composition assertions,
  tool handler tests in `packages/session-tools-core`.

**Owned files**: `packages/shared/src/skills/*`,
`packages/session-tools-core/src/{tool-defs.ts,context.ts,handlers/*}`,
`packages/shared/src/agent/{session-tool-defs.ts,omp-agent.ts}`,
`packages/server-core/src/handlers/rpc/skills.ts`, plus tests.

**Verify**: `bun test packages/shared/src/skills packages/session-tools-core`, targeted agent tests
(`bun test packages/shared/src/agent/__tests__/omp-*.test.ts` — only the ones you touch), then
`cd packages/shared && bun run tsc --noEmit`.

---

## S5 — memory-recall

**Goal**: provenance-safe memory search with real hybrid recall, exposed to the agent as tools.

Deliver (per `agent://ReconMemory`):
- Chunk index with an honest capability split: FTS5 when `bun:sqlite` is available (Bun runtime),
  deterministic JS BM25 over chunks otherwise (Electron/Node) — one interface, two backends, both
  tested. Include the index identity (chunking version + provider/model) and a rebuild function.
- Provenance gate: `MemoryChunkProvenance.originClass ∈ owner|agent|untrusted|system` computed at
  write time from the producing session kind; **injection is gated** — only `owner|agent` chunks may
  enter the prompt; `untrusted` stays retrievable-but-labelled.
- `memory:search` / `memory:get` / `memory:indexStatus` / `memory:rebuildIndex` handlers in
  server-core (channels + ElectronAPI frozen).
- Host tools `memory_search` / `memory_get` via the frozen `SessionToolCallbacks.memory` seam, wired
  at the tool-callback construction site; results carry provenance and a gated badge.
- Prompt bootstrap: provenance-gated `MEMORY.md`/curated-context block added to the existing
  `buildMemoryBlocks` assembly (bounded tokens; skip when empty).
- Tests: gate tests (untrusted never injects), backend-parity tests (FTS vs JS scorer produce the
  same ordering on a fixture corpus), rebuild/identity tests, tool handler tests.

**Owned files**: `packages/server-core/src/memory/*`, `packages/shared/src/memory/*`,
`packages/server-core/src/handlers/rpc/memory.ts`, the memory callback wiring site in
`packages/session-tools-core` (coordinate: S4 owns that file's tool-defs — do not edit it; implement
against the frozen `memory?` field), plus your tests.

**Verify**: `bun test packages/server-core/src/memory packages/shared/src/memory`, the FTS5 probe
(`bun -e` in /tmp) recorded verbatim in your report, then
`cd packages/server-core && bun run tsc --noEmit`.

---

## S6 — meetings-observe

**Goal**: observe-only meeting capture with per-line provenance and rolling 5-minute notes.

Deliver (per `agent://ReconMeetings`):
- Extend the journal reducer (`packages/server-core/src/meetings/journal.ts`) so `segment.upsert`,
  `manual.note`, `session.*` and `summary.upsert` events actually materialize (today they are
  appended and dropped) — this is the critical gap.
- Session runtime: `MeetingSessionRecord` (state machine
  `idle|joining|in_call|paused|leaving|ended|failed|blocked`), keyed `transport:url` lock, bounded
  transcript store (2000 lines, tail cursor 64, 4 ended transcripts) with an eviction signal.
- Per-line provenance: `{observer, observationId, sessionId, epoch, observedAt, speaker, self}` plus
  `ownEcho` — set `ownEcho` only when agent audio is genuinely observable; never fabricate it.
- Summary cadence: 5-minute rolling lane with a strict-JSON model step and a deterministic
  heuristic fallback (decisions/action-items/risks via the existing RU regex extractor pattern);
  invalidation when the transcript revision advances.
- Device observer (`local-observer.ts`) wired to the existing local store + `LocalTranscriptSegment`
  provenance fields; UI: provenance chip per line + rolling-summary block in `LocalMeetingDetail.tsx`.
- RPC: the five frozen `meetings:observe*` channels registered in `MEETING_HANDLED_CHANNELS`.
- Tests: journal reducer, session runtime, transcript store caps, cadence + heuristic, provenance
  mapping, UI model test.

**Owned files**: `packages/core/src/meetings/{model.ts,rpc.ts}`,
`packages/server-core/src/meetings/*`, `packages/server-core/src/handlers/rpc/meetings.ts`,
`packages/shared/src/meeting-agents/*`, `apps/electron/src/main/meetings/*`,
`apps/electron/src/shared/meetings-local.ts`,
`apps/electron/src/renderer/pages/meetings/*`, plus tests.

**Verify**: `bun test packages/server-core/src/meetings packages/core/src/meetings`,
`bun test packages/shared/src/meeting-agents`,
`bun test apps/electron/src/main/meetings` (files you touched), then
`cd apps/electron && bun run typecheck`.

---

## S7 — lifecycle-service

**Goal**: a transactional service lifecycle with doctor diagnostics and a tray status shell.

Deliver (per `agent://ReconLifecycle`):
- `packages/server-core/src/service/`: pure `launchd-plist.ts` builder (0600 env file / 0700 wrapper
  conventions), transactional `launchd-install.ts` (publish + snapshot rollback), `launchd-runtime.ts`
  (bootstrap/bootout/kickstart in the `gui/<uid>` domain, refusal to mutate from inside the service),
  `app-managed.ts` (Electron-owned child), `service-manager.ts` platform dispatch, and a pure
  `doctor.ts` (service state, port conflicts, runtime/version mismatch, config-dir, logs).
- IPC: `serviceLifecycle.*` + `diagnostics.*` handlers in `apps/electron/src/main/service-lifecycle-ipc.ts`
  (LOCAL_ONLY), tray in `apps/electron/src/main/tray.ts` with a status indicator + navigation dispatch
  (dashboard vs native), broadcasting `menu:trayStatusChanged`.
- Never regress `openclaw/runtime-manager.ts`; reuse its transactional shape.
- Tests: plist/env builder, install/rollback with a fake fs, doctor report cases, tray menu model.

**Owned files**: `packages/server-core/src/service/*`, `apps/electron/src/main/service-lifecycle-ipc.ts`,
`apps/electron/src/main/tray.ts`, `apps/electron/src/main/index.ts` (wiring only), plus tests.

**Verify**: `bun test packages/server-core/src/service apps/electron/src/main/__tests__` (your files),
then `cd apps/electron && bun run typecheck`. Exercise `doctor.ts` against the real machine in a
throwaway script (report the JSON).

---

## S8 — voice-realtime

**Goal**: one voice event vocabulary, one realtime bridge state machine, a provider registry, a
wake-word list, and real TTS/STT relay modules.

Deliver (per `agent://ReconVoice`):
- `packages/shared/src/voice/talk-events.ts` (event types + monotonic sequencer + session controller),
  `realtime-bridge.ts` (connect/retry/pending-audio FSM, bounded queue ≤320 chunks/1 MiB, 30-min
  TTL), `provider-registry.ts` (realtime voice + speech providers resolved from existing service
  keys; typed error when unconfigured — never a fake provider).
- `realtime-transcription.ts`: WS STT session with reconnect + bounded queues, and a real OpenAI
  realtime/transcription adapter (`realtime-providers/openai.ts`) implemented against the documented
  protocol; verify the protocol with a **local WebSocket fixture server** in tests (no network).
- `wake-list.ts` (≤32 triggers, ≤64 UTF-16 units, normalize/dedupe) + `voice:wakeGet/wakeSet/
  wakeChanged` end-to-end in the existing voice RPC handler.
- TTS: `tts/synthesis.ts` + `tts/streaming.ts` + `tts/resolution.ts` with a precedence chain over
  the existing `edge-tts`/system-`say` adapters; streaming is chunked and cancellable.
- Wire `voice:talkStart/talkStop/talkAudio/talkEvent` handlers to the bridge with credentials staying
  in main (ephemeral client secret only).
- Tests: FSM transitions, queue caps, sequencer monotonicity, wake-list limits, adapter protocol
  against the local fixture server, provider resolution failures.

**Owned files**: `packages/shared/src/voice/*`, `packages/server-core/src/handlers/rpc/voice*.ts`,
`apps/electron/src/main/voice/*`, plus tests.

**Verify**: `bun test packages/shared/src/voice`, `bun test packages/server-core/src/handlers/rpc`
(voice files), then typecheck `packages/shared` and `packages/server-core`. Live provider calls are
out of scope (no network); mark them clearly as unverified in the report.