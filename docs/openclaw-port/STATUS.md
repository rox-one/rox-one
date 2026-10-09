# OpenClaw → ROX port — ledger

Source backlog: `port-analysis/port-matrix.md` (study 2026-10-09, `port-analysis/openclaw-features-2026-10-09`).
Target: `port/openclaw-features` from `origin/main` @ `7c2c202b7`.

Statuses: `todo` · `in-progress` · `done` · `partial` (shipped subset, gap named) · `deferred (reason)` · `skipped (reason)` · `reuse-as-is` (verified existing capability).

## Wave 1 summary (2026-10-09)

Eight parallel slices shipped and merged on `port/openclaw-features`; per-area evidence below.

| slice | branch | commit | what shipped |
|---|---|---|---|
| S1 multiuser-core | `port/slice-1` | `dcf2064b8` | creator write-once, participants upkeep, presence/typing tracker hardening, server-side visibility enforcement |
| S2 multiuser-ui | `port/slice-2` | `dcfb411ec` | owner chip + assign submenu, participants popover, live presence avatars, typing indicator, involving-me filter, visibility menu |
| S3 webui-security | `port/slice-3` | `6b663b00b` | CSP with hashed inline scripts, single-use handoff token, WS origin allow-list (runtime-verified headers) |
| S4 skills-surface | `port/slice-4` | `4b27f7468` | frontmatter metadata, eligibility + collision report, bounded `<available_skills>` prompt block, `skills_search`/`skills_read` |
| S5 memory-recall | `port/slice-5` | (merge) | provenance gate, dual-backend chunk index (FTS5/JS BM25), `memory_search`/`memory_get`, gated MEMORY.md bootstrap |
| S6 meetings-observe | `port/slice-6` | `d2ca26ca2` | journal reducer fix, session runtime + bounded transcript store, per-line provenance, 5-min rolling summaries |
| S7 lifecycle-service | `port/slice-7` | (merge) | transactional launchd install/rollback, service fences, doctor report, tray + status broadcast |
| S8 voice-realtime | `port/slice-8` | `ef3faf11f` | talk events + sequencer, bridge FSM, provider registry, wake list RPC, TTS/STT relay with real OpenAI adapter |

Row status counts (after wave 4): done=57, deferred=13, partial=5, reuse-as-is=18, skipped=3 (96 rows).

## Wave 2 summary (2026-10-09)

Nine further slices plus the fixes from the first RUNTIME verification of wave 1, merged on
`port/w3-int` and gated by `tools/run-gates.sh --full`.

| slice | row(s) | branch | commit(s) | what shipped |
|---|---|---|---|---|
| W2-1 operator roles | a1.2 | `port/w2-a12` | `d99ae18e8`, `148636beb`, `13863e51e` | named operator roles + scope ceiling intersected AT WS ADMISSION (fail-closed; LOCAL_ONLY never remotely reachable; durable tombstone so a removed role denies the live connection) |
| W2-2 steering + fence | f.4, f.5 | `port/w2-ff45` | `1d5994411` | per-session queue lane + global lane, verb semantics (steer/followup/collect/interrupt), `activeWriterRunId` transcript fence (stale writers rejected, `wait` correlates by runId) |
| W2-3 host scheduler | f.8 | `port/w2-cron` | `e56143594`, `171001e8f`, `445cf9065` | single host-timer scheduler (cron + hooks): coalesced missed ticks, drift-free anchors, beginClose/stop, unsatisfiable expressions rejected at registration |
| W2-4 node/device model | f.9 | `port/w2-nodes` | `31f70be8a`, `ecf82c88c` | node registry (declared caps are claims; server allowlist enforced before dispatch), presence TTL, bounded pending invokes with typed terminal results, `nodes:*` RPC (7 channels classified) |
| W2-5 recall lanes + intents | c1.5, c1.6 | `port/w2-lanes` | `0baf53092` | deterministic lexical lane (>=0.65, top-3, no model call) + bounded escalation lane, standing intents matched on before_prompt_build (time-only intents rejected) |
| W2-6 flush + forget | c1.8 | `port/w2-forget` | `3d77c9398`, `7abebb430` | crash-safe idempotent flush at the session boundary; forget removes corpus + chunks + embeddings and keeps a content-free lineage record |
| W2-7 runtime probe + onboard | e1.2, e1.3 | `port/w2-ops` | `4cf5d6082` | real SQLite WAL-write + version-floor probe returning a typed report with the user-space fallback; onboard `--install-daemon` tri-state decision with documented precedence |
| W2-8 custodian playbooks | c2.8 | `port/w2-skills` | `be6468a3f` | 3 gated bundled system-agent playbooks (cloud-image-bake excluded: no ROX analogue, reason recorded) |
| W2-9 media ticket | b1.5 | `port/w2-media` | `388067a39` | HMAC media tickets bound to path + expiry + session; media served without relaxing CSP |

### Fixes from the runtime verification of wave 1

| fix | branch | sha | defect |
|---|---|---|---|
| FX-2 launchd settle race | `port/w2-fix-launchd` | `6dadb6b7a` | `getStatus()` right after stop/uninstall could report a stale `running` (launchd applies bootout asynchronously) - bounded settle window added |
| FX-3 CSP connect-src | `port/w2-fix-csp` | `8c76095ed` | `connect-src 'self' ws: wss:` authorized WebSockets to ANY host; now `'self'` plus explicit configured origins, never a bare scheme source |
| FX-4 read-side visibility | `port/w2-fix-readvis` | `878547bf4` | `sessions:get`, `getMessages` and `searchContent` served another actor's private draft (writes were gated, reads were not) |
| FX-9 skills single source of truth | `port/w2-fix-skills` | `2847f143b` | 25/27 advertised skills were unreadable (`skills_read` -> SKILL_NOT_FOUND) because the prompt block used the unconfined catalog; a collision-enabled pass walked every tier twice (warm ratio ~144x) |
| FX-1 / FX-5 / FX-6 / FX-7 / FX-8 / FX-10 | slice branches (shas above) | - | repairs found by the union gates: hook disposer + parse-time NO_MATCH, operator-role fail-closed corrections, node/scheduler/memory type errors, and the owner-host bundle regression (a value import of the `@rox/shared/orgs` barrel pulled `@anthropic-ai/claude-agent-sdk` into the load path) |

Evidence for the runtime verification: `docs/openclaw-port/verification/v{1..8}-*-runtime.md`.

## Post-review fixes (2026-10-09)

Six independent adversarial reviewers audited the merged S1–S5/S8 slices against source and
reproduction; every confirmed defect was fixed with a red→green regression test.

| branch | sha | defects fixed |
|---|---|---|
| `port/fix-s1-access` | `086fcec34` | assignOwner privilege escalation (non-owner could self-assign and then write), `sessions:bulkUpdate` visibility bypass, native sharing gate unreachable, native snapshot missing attribution fields, local actor id space vs cloud account |
| `port/fix-s2-presence` | `7c85640a2` | viewer presence expired after 5 min (no heartbeat), typing beacon cleared the wrong session on switch, local user saw their own typing |
| `port/fix-s3-handoff` | `202d5ac75` | pairing page could not load its session-gated bundle cookie-less (now a self-contained hashed-inline-script page), nothing in the product could mint a token (authenticated `POST /handoff/mint` + startup printer) |
| `port/fix-s4-skills` | `73935f565` | prompt advertised unresolved bare tool names (now `mcp__session__skills_*`), shipped `skills_read` followed escaping directory symlinks (realpath confinement), per-slug collisions were unreachable, duplicate full-store walk per spawn |
| `port/fix-s5-memory` | `471244853` | curated bootstrap block was dead code (now injected in system + OMP prompts), provenance gate bypassed by project/workspace/lesson prompt paths, memory tools wired for `temporary` sessions, FTS5-vs-JS ranking divergence, corpus/backend staleness, Windows path bug |
| `port/fix-s8-voice` | `0e609814f` | socket handlers not bound to their socket (queued audio lost), voice error codes not wire `ErrorCode` members, `voice:ttsStreamChunk`/`voice:trigger` missing from native push allow-lists, input transcription never enabled, STT connect timeout |
| (inline) | `2fae60203` | meetings observe test union narrowing so `server-core` typecheck passes |

## Wave 3 summary (2026-10-09)

Ten slices on top of a frozen wave-3 contract commit, plus four integration corrections found by the union
gates and by the wave-3 runtime verification. Every slice branched from `port/w3-iface` and landed on the
integration branch `port/w3-int`.

| slice | row(s) | branch | commit | what shipped |
|---|---|---|---|---|
| W3-IFACE | contract freeze | `port/w3-iface` | `1a05fd652` | 17 channel contracts + routing classification + CHANNEL_MAP/ElectronAPI + push-event map + regenerated IPC inventory (extensionHost descriptors/activate/reload, workboard read/move/changed, board widget put/get/mount/release/changed, memory wiki list/get/apply/lint); routing 27/27, inventory 8/8 |
| W3-PA | f.7, c2.5 | `port/w3-pa` | `2aafca6cc` | manifest-first descriptor plane readable **without executing code** (import-spy proven), pure activation planner over `activationEvents`, startup loading wired into the window auto-start, `extensionHost:listDescriptors|activate` |
| W3-PB | c2.6, c2.7 | `port/w3-pb` | `ecd5358dc` | honest hot swap: revision-busted worker imports + `deactivate()` hook, per-extension generation/drain with `EXTENSION_RELOADING`, entry-only → `swapped`, dependency change → `restartRequired`, typed trust verdict gate (`clean|review-required|blocked`) enforced BEFORE any install with the assessment persisted |
| W3-B1 | b2.1 | `port/w3-b1` | `165a4629b` | `workboard:read|move` over the existing `WorkspaceWorkStore` CAS (`expectedRevision`), `unchanged` short-circuit, typed `REVISION_CONFLICT/NOT_FOUND/WORKSPACE_MISMATCH/FORBIDDEN/DOCUMENT_BUSY`, `workboard:changed` push |
| W3-B2 | b2.2 | `port/w3-b2` | `6911a112d` | board live path: a pure coalescer (epoch/revision, single-flight, hidden defer, in-flight defer + retry, regression → full reload) wired into the kanban container with the optimistic drag preserved |
| W3-B3 | b2.4, b2.5-prereq | `port/w3-b3` | `5a299d4ce` | strict A2UI validator (unversioned v0.8 vs versioned v0.9, mixed versions rejected, extra keys rejected) + `buildWidgetDocument` with the bridge bytes strictly before widget code and `default-src 'none'` CSP |
| W3-B4 | b2.3 | `port/w3-b4` | `84891d736` | widget store (atomic + sha256 readback + path confinement), view tickets, `board:widgetPut|get|mount|release`, `show_widget` agent tool writing through the SAME store |
| W3-B5 | b2.5 | `port/w3-b5` | `10babe36a` | renderer surface: `WidgetFrame` (sandbox `allow-scripts`, opaque origin, exact leased bytes, same-frame message filter, typed runtime-error chrome) + `WidgetCard` (lease/remount/release) consumed by the card detail; no CSP change needed (proven under the real renderer CSP) |
| W3-M1 | c1.7 | `port/w3-m1` | `318e40b98` | claim store (evidence links, contradiction edges, caps, owner filter, audit actions) + deterministic lint/digest + `memory:wiki*` RPC + `wiki_search|get|apply` tools; never injected into prompts (byte-identical blocks proven) |
| W3-M2 | f.10 | `port/w3-m2` | `c0aae92ea` | state substrate: cross-process writer lock with typed `STATE_LOCKED`, per-store FIFO write queue with disjoint-key concurrency, schema-versioned state SQLite (WAL — `user_version` migrations only, no per-write version) and a derived sessions projection (index + transcript rows) rebuilt from the JSONL source of truth |
| W3-M3 | f.8 (remainder) | `port/w3-m3` | `51d0fb42a` | external `POST /hooks/<event>` ingress: bearer/`X-Rox-Hook-Token` with a timing-safe compare, per-IP 401 throttle, bounded bodies, 404-before-body for unknown events, `/hooks/wake` delivering through the real session path, no route at all without a configured token |

Integration corrections (all found by the union gates or the wave-3 runtime verification, each with a red→green test):

| fix | sha | what it fixed |
|---|---|---|
| widget i18n staging | `98e1e5cc4` | the b5 staging carried only en/ru; the 10 keys were translated into all 12 locales (`lint:i18n:coverage` green) |
| hook body typing | `4407bc340` | `hooks-node.ts` passed a `Buffer` into `BodyInit`; the DOM-lib program in `apps/electron` rejected it → converted to a `Uint8Array` view (no cast); `typecheck:all` exit 0 |
| shadow descriptor | `24a5a4674` | a last-wins id index let an INVALID duplicate descriptor override the valid one, silently preventing activation (V20 D-1) |
| ticket enforcement | `8b5924f08` | `WidgetTicketRegistry.validate` had no production caller → added `board:widgetValidate` (contract + handler + ElectronAPI + inventory) so replay/forgery refusals are reachable over the wire (V19 D1) |

Wave-3 runtime verification: `docs/openclaw-port/verification/v18..v23-*.md` (six verifications, real WS RPC, real HTTP,
real Chromium, real processes). Results: V18 workboard CAS + coalescer all-PASS, V19 widget lifecycle all-PASS,
V20 plugin subsystem all-PASS (one defect, fixed), V21 state substrate all-PASS, V22 hooks ingress all-PASS (12/12),
V23 memory wiki all-PASS.

Documented boundaries from that verification (no code change, recorded so nobody re-discovers them):

- V18: a read-only operator is stopped by the transport permission fence (`AUTH_FAILED`) before the handler's domain
  `FORBIDDEN`; the same principal can read the board. Intended layering — relaxing the fence would weaken every write handler.
- V21: the legacy `.server.lock` is acquired before the state lock, so a second server normally dies on the legacy lock and
  the typed `STATE_LOCKED` error only surfaces when the legacy lock is absent (proven by driving it directly; the lock
  module itself is genuinely cross-process — the loser gets the typed error naming the holder). There is NO per-write
  version (`user_version` is schema-only; the only per-write stamp is the caller-supplied `updated_at`, observed
  decreasing). Two processes opening the store without the lock silently lost updates (400+400 → 398); that is being
  fixed in this PR by making the store fail closed without the lock. The safety property (one writer, JSONL
  authoritative, projection rebuildable) is verified.
- V22: the standalone binary reads `ROX_HOOKS_TOKEN` (the un-prefixed name is not read); `/hooks/wake` awaits the whole
  session turn; the pre-existing inline bundled-skills sync still stalls HTTP acceptance for ~18–48 s after listen.
- V20: the utilityProcess fork path is exercised through the in-process worker; a packaged worker bundle was not booted.
- V23: contradiction edges are caller-supplied (no automatic discovery); per-owner isolation and the caps were not exercised.

Row status counts (after wave 4): done=57, deferred=13, partial=5, reuse-as-is=18, skipped=3 (96 rows).
`f.10` stays **partial**: the substrate is real and verified and its INDEX half now has a reader (wave-4 s5 — boot
and single-session import read `readFreshHeaders` behind the count+maxHeaderMtime cookie, with a JSONL fallback,
a queued rebuild and a read-only drift guard), but the TRANSCRIPT half is unwired on both ends: nothing writes
`session_transcript` and nothing reads it.

## Wave 4 summary (2026-10-09)

Wave 4 was preceded by an adversarial verification pass over the wave-3 runtime claims (six claims, each with a
runnable probe) and a broad sweep of the ported packages.

**Verification fixes (separate PR #1719).** Three claims SURVIVED: the descriptor plane executes no extension code
(a fixture whose module body writes a counter file is never imported by `listDescriptors`, which forks nothing);
the hooks ingress fence is real (no token → 404 even with a valid-looking bearer, wrong bearer → 401, correct → 200,
malformed → 400, GET → 405, unknown event → 404 — and replay is NOT deduped: an identical body is dispatched twice);
the wiki is never injected into prompts (assembled payload SHA identical after wiki writes, lint deterministic,
contradiction edges caller-supplied only). Three were REFUTED in part or wholly — each reproduced with a runnable
probe and fixed:

1. `widget-store` confinement was bypassable by an INTERMEDIATE symlink (`root/board` → outside): `put()` wrote
   outside the root with no error. Now realpath-based for every component, with stepped directory creation.
2. `WidgetFrame` accepted `{type:'rox:widget-size',height:1e308}` unchanged (applied raw to the host box = layout
   DoS) and prototype-inherited `type`/`height`; both are clamped/rejected now, at the parser and the use site.
3. The state store silently lost updates when opened without the writer lock (400+400 read-modify-writes → 398);
   writes now fail closed (`StateStoreWriteLockRequiredError`, code `STATE_LOCKED`) unless a live lock handle or an
   explicit `'allow-unlocked'` opt-out is supplied.

v19/v20/v21/v22 carry "Post-verification corrections" sections with the probe evidence, and four
attribution/over-claim errors were corrected: the descriptor plane lives in
`apps/electron/src/main/extension-host/` (there is no `packages/server-core/src/extensions`), the hooks wiring is
`bootstrap/headless-start.ts:557-569` + `hooks-node.ts` (the webui host holds no hooks code), ticket refusals are the
separate `board:widgetValidate` RPC rather than a bridge function, and "version-monotonic writes" was never true
(`user_version` is schema-only; the only per-write stamp is the caller-supplied `updated_at`, observed decreasing).

**Seven slices (this PR).** b1.3 — the protocol catalog (`flattenChannelCatalog`/`flattenEventCatalog`, advertised as
optional `features` + `policy` on the existing ack) and the restored `scripts/ipc-inventory.ts` generator (1,022
channels) with drift guards; a2.5 — the real suggestion flow (`SESSION_SUGGEST_ONLY` for non-owner writes on a
`suggest` session, exactly-once owner resolve); a1.6 — fail-closed `accessPolicyPlugin` admission (a role naming an
unregistered plugin is refused with the same typed denial as a scope denial, no oracle); c1.4 — the per-turn memory
hook (recall + intent only; the spawn-time bootstrap is never re-injected); f.10 — the projection's first reader
(boot + single-session import, cookie-gated, JSONL fallback, drift guard); c1.3 — the vector leg as in-process cosine
over per-backend embeddings (0.6·BM25norm + 0.4·cosine, FTS5≡JS parity, opt-in via `memory.semantic`) after the
spike settled the blocked claim factually (with `sqlite-vec` installed, `loadExtension` fails with "This build of
sqlite3 does not support dynamic extension loading"); e2.2 — node-plane lease fencing (server-minted connection
identity, `SUPERSEDED`/`NODE_CONNECTION_MISMATCH`, the invoke push addressed to the owning connection instead of
`{to:'all'}`) plus a dependency-free node client.

The broad sweep (1,304 files / ~12.7k tests in ONE bun process) reported 318 failures. Per-file re-runs showed that
most are a batching artifact — files that fail in the batch pass alone (mcp client suites, siyuan, logger.errors,
browser-broadcast, extension-host descriptors, notes-autocreate, dream-notes, omp-history-recovery …). The
genuinely red files, with their pre-port baselines, are recorded under "Known pre-existing failures".

## Known pre-existing failures (verified on pristine `origin/main` @ `7c2c202b7`, not caused by this port)

- `packages/shared/src/skills/__tests__/skill-summaries.test.ts` + `storage.test.ts`: 11 failures — per-test 5 s timeouts against this machine's ~9.1k-entry skill store (reproduced on pristine main: 1/2 and 27/37).
- `apps/electron/src/main/meetings/__tests__/local-ipc-binding.test.ts`: 1 failure (stale fixture vs `bootstrap-window-workspace.ts`).
- `scripts/check-raw-sends.sh` (`lint:ipc-sends`): 6 raw `webContents.send` sites fail the gate on pristine main; the port adds none.
- `packages/server/src/__tests__/smoke.test.ts`: "Server did not stop on SIGTERM" (reproduced with the port changes stashed).
- `packages/server-core/src/memory/__tests__/skill-pending-queue.test.ts` → "does not surface .pending candidates as skills": borderline 5 s per-test budget; passes consistently in isolation (38/38, ~5.1 s, identical to pristine main) and fails only when the suite runs under load.

## a1 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| a1.1 | Identity model — three actor kinds profile/channel/agent | adapt | M | done | S1 dcf2064b8: creator captured once at createSession, actor kinds profile|channel|agent; test session-attribution.test.ts | flattening actor kinds loses creator/participant attribution |
| a1.2 | Named operator roles + scope ceiling at admission | adapt | L | done | d99ae18e8 + corrective fix: operator-role-policy.ts (scope implications + channel classification + fail-closed resolver; LOCAL_ONLY refusal now unconditional, even for an unconfigured ceiling); NativeAuthority operator_roles table + define/assign/default + resolveOperatorCeiling with a durable `operator_roles_configured` tombstone so removing the last role re-resolves live connections to deny-all; WS admission persists per-connection ceiling and enforces it in the request path with OPERATOR_ACCESS_DENIED; tests operator-role-policy.test.ts, operator-role-admission.test.ts | remaining gap: no users.setRole-style IPC/admin UI yet (roles are managed through NativeAuthority admin methods on the host credential); sessions.others/agents/modelPolicy/accessPolicyPlugin validated+stored but only scopes enforced. Invariant: once the boundary is ever modelled, the registry never returns to legacy "no boundary" (durable tombstone) - unassigned principals get DENY-ALL |
| a1.3 | Ownership layers (creator/owner/participants) + sessions.assignOwner | adapt | L | done | 54ca1dff + S1: creator/owner{assignedBy,assignedAt}/participants persisted; sessions:assignOwner RPC; tests sessions-attribution.test.ts; CORRECTION w2-fix-readvis: read-side visibility enforcement was missing — sessions:get and sessions:getMessages served another actor's private draft; now enforced by evaluateSessionReadAccess + canReadSession on every read projection (get list, getMessages, searchContent) | creator is write-once; must persist or share authority changes |
| a1.4 | Presence map (connect snapshot + beacon, TTL 5 min) | adapt | M | done | S1: session-activity-tracker TTL sweep + bounds + heartbeat; S2 live UI; tests session-visibility.test.ts, session-presence.test.ts | ephemeral-by-design; do not surface as authorization |
| a1.5 | Public session links (AES-256-GCM sealed locator) | reimplement | L | deferred | public links reuse existing sharedUrl/sharedId; sealed-locator crypto not built | token bound to installation device identity; revocation can't recall copies |
| a1.6 | Visitor-access plugin (Cloudflare Access policy, TTL, sweep) | adapt | M | partial | W4-S3 makes the pre-carved seam fail CLOSED: `accessPolicyPlugin` was parsed but never consulted, so a role naming a plugin was silently admitted without it — admission now consults `registerAccessPolicyPlugin`, refuses with the SAME typed `OPERATOR_ACCESS_DENIED` as a scope denial (no oracle) and advertises zero channels when no authorizer is registered; unregistered / denied / throwing all refuse (7 new tests) | the Cloudflare Access client, grant store, TTL sweep and visitor_* tools stay deferred: they need a hosted ingress + Cloudflare account (a1.7 is skipped for the same reason) |
| a1.7 | trustedProxy / cloudflareAccessOidc ingress identity | skip | S | skipped | study verdict skip: only needed with a hosted ingress | only needed if a hosted ingress is added later |

## a2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| a2.1 | Sidebar filter/sort popover (Owners/Status/Group by) | reimplement | M | done | S2: Owners + Involving-me sections in CompactSessionListFilter; sort stays in existing CollectionViewChrome | "Involving me" is Gateway-evaluated over full participant history |
| a2.2 | Owner chip + pair-stack + assign submenu | adapt | M | done | S2 SessionOwnerChip + assign submenu (useSessionMenuActions) | attribution must follow created/owned/archived selection |
| a2.3 | Participant history rendering (creator vs owner vs participants) | adapt | S | done | S2 SessionParticipantsPopover renders creator/owner/participants | renaming a person must not rewrite participant history |
| a2.4 | Presence avatars + typing indicator | adapt | M | done | S2 live avatars + typing indicator; server tracker S1; 3 review findings fixed in port/fix-s2-presence | drafts must stay ephemeral, never in transcript/model context |
| a2.5 | Sharing menu: visibility + public link + members | reimplement | M | done | visibility selector + members shipped (S2); W4-S2 closes the row's named risk: `suggest` was treated as an open write — `evaluateSessionWriteAccess` now refuses a non-owner write with typed `SESSION_SUGGEST_ONLY`, and the real flow ships: suggestion store (add/list/resolve, author-bound), owner-only resolve that is exactly-once (`dispatched:false` + the original message id on replay, claim rolled back if the dispatch fails), `sessions:suggestAdd|List|Resolve` + routing + channel-map + 16 i18n keys × 12 locales, minimal renderer surface | copy-link still only when `sharedUrl` exists (the hosted viewer share, a1.5); add/remove-member-by-identity not built |
| a2.6 | Settings → Profile → Connected accounts (per-person model) | adapt | M | deferred | connected-accounts UI not built; identity/credential fabric reused as-is | reuse ROX secret store, not a second credential path |
| a2.7 | macOS WebChat surfaces (webview-hosted) | reuse-as-is | S | reuse-as-is | the web surface IS the renderer: the Electron shell already hosts the same web UI over the shared WS transport, so there is no separate surface to build; `openControlUi` (apps/electron/src/main/openclaw-host-control.ts:310-332) is the precedent for a hardened web-hosted window — exact control-UI origin (fail-closed), a fresh ephemeral session partition, storage/cache cleared on close, webview attach and outside-origin navigation blocked | web + native experience share state, not drafts |

## b1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b1.1 | Serve dashboard static assets from same HTTP host | reuse-as-is | S | reuse-as-is | verified: createWebuiHandler serves the SPA on the RPC host (packages/server-core/src/webui/http-server.ts) | base-path/route-preload parity with ROX WebUI |
| b1.2 | Build pipeline: stable chunking + boot manifest + locale virtual modules | adapt | M | deferred | chunking/boot-manifest concept not ported (Vite build already stable) | Vite vs Bun bundler; keep boot-manifest *concept* |
| b1.3 | WS transport: hello/snapshot + method+event catalog | adapt | L | done | W4-S1 `catalog.ts`: `flattenChannelCatalog()` (every RPC channel exactly once + its routing classification) and `flattenEventCatalog()` (every `BroadcastEventMap` key, compile-time exhaustive); the handshake ack now carries optional `features:{methods,events,capabilities}` + `policy:{maxPayloadBytes}` (100 MiB = ws's real default) beside `registeredChannels`; `client.ts` stores `serverFeatures`; the webui adapter refuses unadvertised channels typed (`CHANNEL_NOT_FOUND`); `scripts/ipc-inventory.ts` restored (1,022 channels) with two drift guards so the snapshot can no longer be hand-edited | the `features.methods` list is the GLOBAL channel inventory (`buildProtocolFeatures()` over `flattenChannelCatalog`, `packages/shared/src/protocol/catalog.ts:208-214`, sent at `transport/server.ts:1257`), NOT the per-connection AUTHORISED set — only `registeredChannels` is resolved per connection (`registeredChannelsFor`), so the webui client gate (`isMethodAdvertised`) can only catch an UNKNOWN channel, never a registered-but-forbidden one; capabilities are the routing tokens, not per-user grants |
| b1.4 | Auth / pairing handoff (single-use bootstrap token) | adapt | M | done | S3 6b663b00b: single-use handoff token (hashed at rest, TTL<=120s, no URL credential) + fragment redemption; tests handoff.test.ts, handoff-fragment.test.ts | keep credential out of URL; origin allow-list |
| b1.5 | CSP / security headers + media ticket | adapt | S | done | W2-9 388067a39: CSP + security headers (S3) plus signed media tickets — GET /media/...?ticket=… authorised solely by an HMAC ticket (v1.<payload>.<sig>) bound to media path + session-cookie fingerprint, key domain-separated from the server secret, 5-min TTL (clamped 15 min), constant-time sig compare, uniform 403 on expired/tampered/cross-session/malformed, reused within TTL (media elements issue several requests per source), authenticated same-origin POST /media/ticket mints, ticket never logged; CSP unchanged. Tests: __tests__/media-ticket.test.ts | hash inline scripts; connect-src limited to self+ws |
| b1.6 | Offline/reconnect backoff + warm reload + outbox | adapt | M | done | S3: WS origin allow-list at upgrade (fail-closed); reconnect backoff already in WsRpcClient | Electron history/will-navigate replaces web-chrome hooks |
| b1.7 | Operator panels (40+ pages: chat, sessions, cron, logs, usage…) | reimplement | XL | reuse-as-is | apps/webui renders the full Electron renderer over CHANNEL_MAP (createWebApi); operator panels already reachable | port panel-by-panel; not a single cutover |
| b1.8 | Sandboxed plugin/agent widgets | reuse-as-is | M | reuse-as-is | wave 3 built the hard part: the `WidgetFrame` sandbox surface (`sandbox="allow-scripts"`, opaque origin, same-frame-message filter, typed runtime-error chrome), `buildWidgetDocument`/wrap.ts (CSP `default-src 'none'`, bridge bootstrap emitted strictly before widget code, byte offset asserted), and the widgets store + size/view tickets with generation rotation (b2.3/b2.5) | residual is a plugin-DECLARED widget contribution kind; NO named consumer exists yet, so nothing is built. Recorded option only: add `'widgets'` to `EXTENSION_CONTRIBUTE_KEYS` (packages/shared/src/extensions/types.ts:98) — a declaration-only entry; unknown keys still fail closed at parse. Not built work |

## b2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b2.1 | Workboard server: workboard.* RPC + SQLite store + CAS | adapt | L | done | W3-B1 `165a4629b`: `WorkboardService` over the EXISTING `WorkspaceWorkStore` CAS (`commit(expectedRevision)` → REVISION_CONFLICT/DOCUMENT_BUSY/typed receipt) + the `workspaceWorkContext` actor seam; `workboard:read` (`unchanged` short-circuit) + `workboard:move` handlers + `workboard:changed` push; tests `workboard/__tests__/workboard.test.ts` (9, incl. a real WS handler test); verified v18 (CAS replay leaves the state sha256 byte-identical, two racers → one conflict, no lost update) | card↔session linkage uses the ROX workspace-work model (links already point at sessions/projects/pages), not a new registry; `rank`/`priority` are NOT persisted (the canonical task schema has no ordering field) → `move.rank` is a typed UNSUPPORTED_OPERATION rather than a silent no-op |
| b2.2 | Workboard browser plugin → React route + IPC bridge | reimplement | L | done | W3-B2 `6911a112d`: pure `board-live-refresh` coalescer (epoch/revision compare, single-flight, hidden-defer + visibilitychange, in-flight-write defer then retry, revision regression → full reload) + `KanbanBoardContainer` subscription/reload + kanban board revision/epoch atoms; 96 kanban tests incl. 11 coalescer cases; verified v18 (two rapid events → one read; regression → full read; hidden defers) | the route, IPC bridge and "one capability object + subscribe/invalidate" pattern reuse the existing kanban feature; the optimistic drag and its `restorePrior()` rollback are unchanged |
| b2.3 | Canvas show_widget → board.widget.put (script CSP sandbox) | adapt | L | done | W3-B4 `84891d736` + W3-B5 `10babe36a` + `8b5924f08`: `WidgetStore` (`{workspaceRoot}/board/widgets/<name>`, atomic write + sha256 readback + path confinement), `board:widgetPut|get|mount|release` + `board:widgetValidate`, size/view tickets with generation rotation on re-put, the `show_widget` agent tool writing through the SAME store, and a sandboxed renderer surface (`sandbox="allow-scripts"`, opaque origin, exact leased bytes, same-frame message filter only, typed runtime-error chrome); tests board/* (22) + renderer board/* (19); verified v19 (bridge offset < widget-code offset, old ticket refused after re-put, 300 mounts → bounded store, foreign-window messages dropped in real Chromium) | the postMessage bridge is the trust boundary: v1 exposes NO privileged bridge and never opens the MessagePort, so the ticket is enforced at the RPC boundary (`board:widgetValidate`) and before any future privileged action; an `a2ui` payload is refused with a typed UNSUPPORTED_WIDGET_KIND until an A2UI renderer bundle ships (never stored half-baked) |
| b2.4 | A2UI widget validation (v0.8 strict / v0.9 schema) | adapt | M | done | W3-B3 `5a299d4ce`: `packages/shared/src/widgets/a2ui.ts` — strict JSONL envelope validator: v0.8 UNVERSIONED (an explicit `0.8` is an error), v0.9 versioned, exactly one action key per line, unknown/extra keys rejected, mixed v0.8+v0.9 rejected, empty rejected, `</script>` rejected, line-numbered malformed-JSON errors; 51 validator cases; verified v20 (an a2ui widget is refused by the store with a typed error and nothing is written) | v0.9 is validated structurally (the repo does not depend on `@a2ui/web_core`); the validator documents exactly what it does NOT guarantee (no schema-driven payload semantics) rather than accepting silently-wrong renders |
| b2.5 | Canvas document host + buildWidgetDocument wrap | adapt | M | done | W3-B3 `5a299d4ce` (`buildWidgetDocument`: escaped title, `default-src 'none'; sandbox allow-scripts`, `connect-src` = granted origins only, bridge bootstrap emitted STRICTLY before widget code, byte-offset asserted) + W3-B5 `10babe36a` (the renderer host that consumes it); verified v19 under the real renderer CSP in Chromium: the opaque-origin frame loaded, bridge 700 < widget code 1375, only same-frame size reports accepted, a throwing widget rendered the typed fallback | widgets are delivered over RPC (`board:widgetMount` returns the leased content) rather than an HTTP document route, so no new HTTP surface or CSP relaxation was needed; no `canvas.*` node-panel presentation path was ported (no ROX consumer for paired-device presentation yet) |
| b2.6 | macOS embedded browser → Electron WebContentsView tabs | reimplement | L | partial | STALE NOTE corrected: `apps/electron/src/main/browser-pane-manager.ts` + the browser tab strip already exist (WebContentsView-backed panes with a tab strip) | residual: `window.open` popups are not converted to tabs (popup-not-tab), only a single manually-created partition is supported (no per-profile `session.fromPartition`), and downloads are not staged-then-commit (auto-downloads only) |
| b2.7 | WebChat window fleet + route encoding | adapt | M | deferred | the WebChat window fleet is SUPERSEDED: the web surface is a single hosted renderer (see a2.7), so no per-window fleet or route encoding is needed. The real remaining gap is the DEAD `menu:OPEN_DASHBOARD` — declared in `packages/shared/src/protocol/channels.ts:419` and dispatched by the tray (`TRAY_ITEM_CHANNEL`) but with no handler/consumer — alongside the equally unconsumed `menu:runDoctor` and `menu:showServiceStatus`, and `menu:trayStatusChanged` (broadcast + listener API exposed, no subscriber) | keep "direct WS, no local static server" invariant |

## c1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c1.1 | SQLite index schema + per-agent DB + migrations | adapt | L | done | S5: chunk index with FTS5 (Bun) + JS BM25 (Electron) backends, index identity + rebuild; tests memory-index.test.ts | FTS5 + optional sqlite-vec must exist in ROX's SQLite build |
| c1.2 | Provenance gates (origin_class ∈ owner/agent) — the security property | reimplement | L | done | S5 provenance-gate.ts: originClass owner|agent|untrusted|system; untrusted retrievable-but-never-injected; bootstrap gated | skipping the gate = memory poisoning from untrusted tool/web output |
| c1.3 | Hybrid search: BM25 + vector → decay → importance → MMR | adapt | L | partial | BM25 + deterministic scorer parity-tested; vector leg now in-process cosine (no sqlite-vec) over per-backend embeddings (FTS5 chunk_embeddings BLOB / JS sidecar), fused 0.6·BM25norm+0.4·cosine with the shared chunkId tie-break so FTS5 and JS order identically; gated by memory.semantic, OFF byte-identical; tests memory-vector-leg.test.ts. sqlite-vec probe: require.resolve + native vec0.dylib both present but db.loadExtension fails verbatim "Error: This build of sqlite3 does not support dynamic extension loading" (bun 1.4.2; DatabaseSync exposes no loadExtension) | decay → importance → MMR still deferred |
| c1.4 | Context injection via prompt snapshot → per-turn boundary | reimplement | L | done | W4-S4: `getPerTurnMemoryBlock` on the shared backend config, awaited in `BaseAgent.chat()` (one site covers Claude/Pi/OMP), rendered by `formatPerTurnMemoryBlock` composing ONLY recall + intent — the spawn-time bootstrap block is never re-injected; callback absent → the message is byte-identical to before; an untrusted chunk never enters the per-turn block; standing intents fire once per turn (store dedupe) | per-turn content rides the user turn (OMP allows prompt/steer/follow_up only), so the static system prompt stays cache-stable and the spawn snapshot is untouched |
| c1.5 | Recall lanes: deterministic trigger + escalation sub-agent | adapt | M | done | W2-5: code+ledger in commit 0baf53092 (branch port/w2-lanes): lane 1 lexical-only selector (score >= 0.65, top 3, no model, stable order) + lane 2 bounded escalation in shared context-select.ts, wired into MemoryService.buildMemoryBlocks (single prompt path); tests context-select-recall.test.ts, memory-recall-lanes.test.ts | lane 1 stays lexical-only/deterministic; escalation is budgeted (3s, ≤8 candidates, ≤3 picks) and provenance-gated — untrusted chunks never escalate |
| c1.6 | Standing intents (prospective memory) | adapt | M | done | W2-5 (same commit as c1.5, 0baf53092; branch port/w2-lanes): StandingIntentStore ({workspace}/memory/standing-intents.jsonl) + matchStandingIntents/buildStandingIntentBlock, matched in buildMemoryBlocks (before_prompt_build equivalent), once per turn, deduplicated, provenance-gated; tests context-select-recall.test.ts, memory-recall-lanes.test.ts | time-only reminders belong to cron: rejected at add and ignored at match; per-turn hook is still the spawn-time blocks snapshot (see c1.4); intent create/list/cancel tool/RPC surface not in this slice |
| c1.7 | Memory wiki (claims/evidence/contradictions) | adapt | M | done | W3-M1 `318e40b98`: `WikiClaimStore` (`{memoryDir}/wiki/claims.jsonl` — atomic rewrite, corrupt-line skip, caps, owner filter, `AuditLog knowledge.claim.add|update|retire`, secret redaction) + deterministic `wiki-lint`/digest (`WIKI.md`) + `memory:wikiList|get|apply|lint` + `wiki_search|get|apply` tools; 18 store/tool tests + a real RPC round trip; verified v23 (digest byte-identical across runs, dangling contradiction + empty text rejected over the wire, `buildMemoryBlocks` BYTE-IDENTICAL before/after wiki writes = never injected, forget → `evidence-missing` lint without crashing) | claim edges are caller-supplied — there is NO automatic contradiction-discovery pass (the deterministic lint is the shipped form); the tool schema deliberately omits the edge key, so the RPC is the only edge-carrying surface |
| c1.8 | Flush turn + forget/lineage retention | adapt | M | done | S6 @ 3d77c93: flush-turn.ts commits pending proposal write-intents at the session boundary (deterministic id order, receipt-idempotent, durable-intent-before-corpus = crash-safe; approve-memory-proposal.ts fault seam); forget.ts removes the corpus line (md block + lessons.jsonl line), rebuilds the chunk index and purges episodic embeddings, appends a hash-only lineage record to AuditLog (queryable, never injected); memory_forget tool (`memory-forget.ts` handler + registry); tests flush-turn.test.ts, forget.test.ts, memory-tool-callbacks.test.ts, memory-tools.test.ts | vector/embedding gap: c1.3's sqlite-vec leg is still blocked, so forget purges episodic.jsonl embeddings — when chunk vectors land they must join the same purge |

## c2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c2.1 | SKILL.md parse/materialize (frontmatter + body refs) | reuse-as-is | S | done | S4: SKILL.md frontmatter metadata.openclaw/rox parsed (requires/os/skillKey/primaryEnv/homepage) | ROX already ships a 330-skill catalog (SKILLS.lock) |
| c2.2 | Discovery roots + name-keyed precedence/collision report | adapt | M | done | S4 eligibility.ts detectSkillCollisions over the ordered root plan; reasons per code; fix-skills (F2/defect (e)): a collision-enabled pass reuses the SAME catalog walk's per-tier scans (`loadAllSkillsWithTierScans` caches catalog+scans; only cheap OMP tiers re-read) — single full-store walk, no ~12 s second walk (storage.test.ts "loadAllSkillsWithTierScans") | keep ordered root plan; do not collapse tiers silently |
| c2.3 | Gating/eligibility (agent allowlist, requires.bins/env/config) | adapt | M | done | S4 eligibility gating incl. missing-bin/env/config/os/allowlist/disabled-pack; skills:getEligibility RPC | key allowlists on ROX operator identity; map env to credential fabric |
| c2.4 | Prompt surface (<available_skills>) + skills_search/skills_read | adapt | M | done | S4 <available_skills> block in the OMP append prompt (bounded) + skills_search/skills_read host tools with root confinement; fix-skills (F1): eligibility now realpath-confines every entry to its discovered root BEFORE gating, so the report (and the block built from `report.eligible`) only advertises readable slugs — real store advertised_unreadable 25→0 (was 25/27; runtime keeps the same filter as defense-in-depth); skills-tool-runtime.test.ts "advertised implies readable", eligibility.test.ts realpath-confinement regression | inject into OMP session prompt; reuse tool-call path |
| c2.5 | Plugin manifest + registration-mode boundary | reimplement | L | done | W3-PA `2aafca6cc`: the manifest-first descriptor plane (`apps/electron/src/main/extension-host/descriptors.ts`) scans `{configDir}/extensions/sandbox/*/manifest.json` WITHOUT executing package code (import-spy proven), realpath-confines dir/manifest/entry, parses per package fail-closed (an invalid package never aborts the scan), reports `shadowed` duplicates and hashes manifest+entry+file list; the registration-mode boundary is now descriptor-read vs runtime-load (`listDescriptors` never forks, `activate` is the only runtime path); verified v20 | CORRECTION: the wave-2 note "sandboxed plugin worker boundary not built" was WRONG — the `ExtensionHostManager` utilityProcess boundary, path allowlist and capability broker already existed; this row completed the manifest-first half on top of them. The package code still runs in that sandboxed worker, never in-process |
| c2.6 | Plugin lifecycle / hot reload (plugins.reload drain+swap) | adapt | L | done | W3-PB `ecd5358dc`: revision-busted worker imports (`?rev=sha256(entry)` — the old code re-imported the cached ESM module) + a bounded `deactivate()` before unload; `reloadExtension` → `swapped|restartRequired|failed` with a per-extension generation, in-flight drain under a budget (`EXTENSION_RELOADING` for new calls, late replies dropped by id), entry-only change → swap, any non-entry change → `restartRequired` with ZERO load messages, manifest identity change → rejected; `extensionHost:reload` (grants re-resolved from permissions.json only); verified v20 (real worker: v1→v2 swap, helper edit → restartRequired) | `restartRequired` is REPORTED, never auto-restarted: an automatic restart would silently discard every other extension's in-memory state; the packaged utilityProcess fork was exercised in-process, not through a packaged bundle |
| c2.7 | Registry trust gate (verdict → clean/blocked, fail-closed) | reimplement | M | done | W3-PB `ecd5358dc`: pure `assessRegistryTrust` → `clean|review-required|blocked` with reason codes (`catalog-signature-missing`, `invalid-ref`, `missing-content-pin`, `provider-unverified`, `oem-allowlist-empty`) and a fail-closed default; the marketplace INSTALL/UPDATE path asserts the verdict BEFORE any fetch and persists `trustVerdict/trustReasons/assessedAt` on the lock record after the content-pin verify; verified v20 (an unsigned catalog entry → `REGISTRY_TRUST_BLOCKED` with a fetch spy proving ZERO install/clone fetches and no lock write; a signed+pinned entry installs and records `trustVerdict: clean`) | re-specified against ROX's own catalog shape rather than ClawHub's API; OpenClaw's `review-recommended` is deliberately collapsed (no verdict service exists here, so it would have no producer); the gate never replaces the existing pins — both must hold |
| c2.8 | Custodian skills → system agent playbooks | adapt | S | done | W2-8: apps/electron/resources/skills/rox-custodian/{add-model-provider,configure-channel,diagnose-gateway}/SKILL.md (Gather→Mutate→Repair→Prove→Report; gated via metadata.openclaw requires.env=OPENCLAW_GATEWAY_TOKEN, diagnose-gateway os=darwin|linux); registered in SKILLS.lock + REQUESTED-SKILLS.json; eligibility.test.ts "rox-custodian gated bundled playbooks"; fix `7d5daa7a3` (from the wave-2 verification): `always`-flagged skills are emitted FIRST in `<available_skills>`, so an eligible gated playbook survives the block's byte/entry cap — V16 found them eligible but never advertised in a default session | cloud-image-bake deliberately excluded (crabbox/AWS/Hetzner/Firecracker image bake has no ROX analogue); playbooks operate the ROX-managed OpenClaw gateway as skills, no new tool/channel; the promotion guarantees priority over the tier groups, not immunity under an extreme cap |

## d1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| d1.1 | Talk event vocabulary (TALK_EVENT_TYPES) + sequencer | adapt | M | done | S8 talk-events.ts: vocabulary + monotonic sequencer + reorder buffer; tests 138 voice tests | one event model shared by renderer/server/future mobile |
| d1.2 | Provider registry (realtime voice + speech) | adapt | M | done | S8 provider-registry.ts with typed unconfigured error (no fake provider) | resolved from `getServerServiceKey`; typed `unconfigured`/`unknown-provider` errors, never a fake provider |
| d1.3 | Realtime bridge state machine (connect/retry/pending audio) | adapt | L | done | S8 realtime-bridge.ts FSM: connect/retry/pending-audio, bounded queue (320 chunks/1 MiB), 30-min queued-frame TTL (no session lifetime cap) | credentials stay in main; renderer gets ephemeral client secret only |
| d1.4 | TTS pipeline (buffered + streaming + precedence) | adapt | M | done | S8 tts/{synthesis,streaming,resolution}.ts with precedence chain + ordered chunk stream | device playback stays renderer/native |
| d1.5 | STT relay (WS reconnect + bounded queues) | adapt | M | done | S8 realtime-transcription.ts with reconnect + bounded queues; OpenAI adapter verified against a local WS fixture | browser codec g711_ulaw@8k / pcm16@24k |
| d1.6 | Voice wake list + broadcast; on-device recognition only | adapt | M | done | S8 wake-list.ts (<=32 triggers, <=64 UTF-16) + voice:wakeGet/wakeSet/wakeChanged end-to-end | foreground-gated; route triggers to sessions |
| d1.7 | Telephony voice-call (Twilio/Telnyx/Plivo) | skip | L | skipped | study verdict skip: needs a public webhook/tunnel | needs public webhook + tunnel infra; desktop model must host or delegate |
| d1.8 | Meeting realtime engine seam | adapt | M | deferred | meeting realtime engine seam not wired; shared/voice meeting-capture path unchanged | verify ROX meeting stack can host realtime engines |

## d2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| d2.1 | Session runtime (keyed transport:url lock, tab ownership, retry) | adapt | L | done | S6 session-runtime.ts keyed transport:url lock + state machine; tests session-runtime.test.ts | transport-agnostic orchestrator over ROX meeting package |
| d2.2 | Transport selection (chrome / chrome-node / twilio dial-in) | reimplement | XL | deferred | no browser/dial-in transport adapters shipped (declared-blocked states only) | Chrome DOM automation fragility; no vendor SDK claimed |
| d2.3 | Caption transcription + per-line provenance/ownEcho | adapt | L | done | S6 observation-provenance.ts per-line provenance + honest ownEcho (mic-only => unset); journal reducer gap fixed | without provenance+ownEcho you echo the agent's own TTS into notes |
| d2.4 | Notes/summary pipeline (5-min cadence + heuristic fallback) | adapt | L | done | S6 summary-cadence.ts 5-min lane + strict JSON + deterministic heuristic fallback + revision invalidation | strict JSON schema + 20s budget; deterministic fallback |
| d2.5 | Participation idempotency (fingerprint dedupe, one correction) | reuse-as-is | M | deferred | participation idempotency rules reused as-is but not exercised by a live join path | observations never grant action authority |
| d2.6 | Google Meet OAuth + artifacts (PKCE, scopes, Drive) | adapt | M | deferred | Google Meet OAuth/Developer-Preview path not built | Media API is Developer Preview; Workspace enrolment may block |
| d2.7 | Feishu VC invite trigger (synthetic p2p message) | adapt | M | deferred | Feishu VC invite trigger not built | handler must not call a join API directly; default-off |
| d2.8 | Retention: no recording; bounded in-memory caps | adapt | S | done | S6 bounded transcript caps (2000 lines / 4 ended / tail 64) with eviction signals; no audio/video recording anywhere | keep transcripts.enabled kill switch + explicit observe tail |

## e1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| e1.1 | curl/bash installer + Node provisioning + PATH rc rewrite | skip | S | skipped | study verdict skip: Electron packaging replaces curl|bash | Electron packaging replaces the npm-global flow |
| e1.2 | Runtime capability probe (SQLite WAL-safe + version floor) | adapt | S | done | 4cf5d608 runtime/capability-probe.ts: real WAL write in <state>/tmp + WAL-reset-safe version floor + NUL round-trip, typed downgrade; tests capability-probe.test.ts; machine bun 1.4.2 / node 26.3.0 / sqlite 3.54.0 | user-space fallback under <state>/tools/ reported in the typed downgrade; probe is called at server startup |
| e1.3 | Onboard --install-daemon tri-state decision | adapt | M | done | 4cf5d608 service/onboard-daemon-decision.ts tri-state (install/skip/refuse) + supervisor detection, wired at main service setup; tests onboard-daemon-decision.test.ts | quickstart=install default; --skip-daemon/supervision skip; explicit flags beat defaults; non-interactive+neither = refuse |
| e1.4 | LaunchAgent plist/env wrapper → OS service abstraction | reimplement | L | done | S7 launchd-plist.ts + launchd-install.ts transactional publish/rollback (0600 env, 0700 wrapper) | transactional publish+rollback; 0600 env file else bricked service |
| e1.5 | Service authority/status fences | adapt | M | done | S7 launchd-runtime.ts gui/<uid> fences: refuses mutation from inside the service and for system paths | refuse mutation from inside the service; system-daemon ownership |
| e1.6 | Doctor diagnostics (foreign jobs, port, runtime mismatch) | adapt | M | done | S7 doctor.ts pure checks (service-state/port-conflict/runtime-mismatch/config-dir/logs) + real-machine run; launchd status settle window (~1s bounded re-poll after a mutation) so a status read right after stop/uninstall cannot report a stale loaded state | port-conflict/runtime-mismatch only; skip launchd reaping |
| e1.7 | Update channels + checkOnStart + detached handoff | reuse-as-is | S | reuse-as-is | electron-updater channels + ad-hoc signing detection retained (detectMacAdHocSigned exported for doctor/tray) | wait-for-old-PID helper replaces kickstart |
| e1.8 | State dir / logs / uninstall scopes | adapt | S | done | S7 uninstall scopes (service/state/logs/runtime/app) + config-dir reporting | map the legacy home dot-dir onto the ROX config dir resolved via resolveConfigDir()/getConfigPaths(); stop the service before deleting state |

## e2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| e2.1 | Menu-bar/tray shell + navigation dispatch | adapt | M | done | S7 tray.ts status indicator + menu dispatch + navigation (dashboard vs native) + menu:trayStatusChanged | main-process router: Dashboard(web) vs native chat |
| e2.2 | Operator/node WS client + lease fencing + node.invoke bridge | adapt | L | partial | server half shipped (f.9/V12) + W4-S7: connection identity is the server-minted `clientId` (the payload `connId` is no longer read, so a client cannot name another connection's identity); re-registration cancels that node's in-flight invokes (`SUPERSEDED`); `nodes:invokeResult` must present the owning connection (`NODE_CONNECTION_MISMATCH`, new protocol error code) and an impostor's settlement is dropped; the invoke push is addressed to the owning connection instead of `{to:'all'}`; stale heartbeats refused; dependency-free `node-client.ts`; runtime-proven with two real WS clients | device-auth challenge semantics remain transport-reconnect only; Electron main wiring (and the capability advertisement built on it) is e2.4 |
| e2.3 | Embedded-surface IPC (webview message handlers) | adapt | L | deferred | embedded-surface IPC versioning not built | definition of window.roxDesktop; version every handler |
| e2.4 | Node capability model + TCC prompts | reimplement | L | deferred | node capability model + TCC prompts not built (macOS-only surface) | TCC/signature+path coupling: bundle-ID/path change resets grants |
| e2.5 | LaunchAgent management from app (install/start/stop, runtime pin, resume) | reimplement | L | done | S7 service lifecycle install/start/stop/restart/uninstall from the app (LOCAL_ONLY channels) | preserve "who owns the Gateway" or get duplicate gateways |
| e2.6 | Auto-update: Sparkle → electron-updater + channel gating | reuse-as-is | S | reuse-as-is | electron-updater + channel gating already present | keep app and gateway/OMP on compatible release trains |
| e2.7 | Helper processes: stdio framing + app-control/exec UDS | reimplement | M | deferred | helper-process stdio/UDS framing not built | 0600 token + HMAC + peer-UID; separate exec-approvals socket |
| e2.8 | Signing / notarization / entitlements | adapt | M | deferred | signing/notarization/entitlements work not done (no Apple credentials) | JIT entitlements only to runtime binaries; Team-ID audit fails closed |

## f (10 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| f.1 | Process model: single owner + state lock + loopback bind | adapt | L | reuse-as-is | verified: single-owner .server.lock + loopback default 127.0.0.1 (bootstrap/headless-start.ts) | one in-process gateway module; refuse non-loopback without auth |
| f.2 | Transport: req/res/event frames + connect-first handshake | adapt | L | reuse-as-is | WsRpcServer req/res/event + per-connection auth already implemented | one generated contract packet + N-1 window; no Swift codegen |
| f.3 | Method registry + namespace/scope policy | adapt | M | reuse-as-is | RpcServer.handle + registeredChannelsFor/canRequest method gating; S3 added upgrade-time origin enforcement | plugin methods must not weaken reserved core prefixes |
| f.4 | Sessions/routing/queue steering (steer/followup/collect/interrupt) | adapt | L | done | 1d5994411: QueueSteering per-session lane + global lane (runGlobal mutex) with shared planSteeringSubmit kernel; 4 verbs honored in SessionManager mid-stream (steer=redirect/coalesce, followup=FIFO, collect=coalesce, interrupt=drop+abort); queueMode on SendMessageOptions; tests queue-steering.test.ts | steer in-flight delivery still rides agent.redirect (the existing 2-mode seam), not a lane task; interrupt dropped ids are logged, not surfaced as a new UI status |
| f.5 | Agent loop: streaming + activeWriterRunId transcript fence | adapt | L | done | 1d5994411: TranscriptFence rejects stale-run appends (StaleTranscriptWriterError); AgentRunRegistry correlates runId->terminal; BaseAgent.startRun returns runId immediately + waitForRun blocks; SessionManager claims/releases the per-turn writer; tests transcript-fence.test.ts, agent-run-registry.test.ts | only the streaming driver's own transcript append goes through the fence today; processEvent's per-event appends still write direct (threading the runId there is the remaining gap) |
| f.6 | Config JSON5 + SecretRef (env/file/exec) + hot reload | adapt | L | reuse-as-is | credential fabric + settings:getSecretRefs cover env|file|exec-style refs | map SecretRef onto ROX credential sources; skip invalid reloads |
| f.7 | Plugin activation planner + gateway-startup loading | reimplement | L | done | W3-PA `2aafca6cc`: pure `planExtensionActivations` over `activationEvents` (undefined/`[]` → activate-now, `onStartup`/`onWorkspaceOpen` → activate-now on that trigger, `onCommand:<id>`/`onSurface:<kind>` → defer, unknown token → skip, undeclared command → skip, non-craft-sandbox → skip, disabled → skip; deterministic order) + `applyStartupActivations` wired into the window auto-start with per-extension failure isolation, plus the frozen `extensionHost:listDescriptors|activate`; verified v20 (a real manager activated exactly the expected ids; a disabled extension never loaded; an invalid duplicate can no longer shadow a valid descriptor — fix `24a5a4674`) | only the startup trigger has a production call site today; `workspace-open`/command/surface triggers are supported by the planner and reachable through `extensionHost:activate`; descriptors live in the same registry as core contributions (no second registry) |
| f.8 | Cron / hooks / single host-timer scheduler | adapt | M | done | W2-3 `e56143594`: HostScheduler single host timer (once/every/cron) with coalesced missed ticks + drift-free anchors + beginClose/stop, HookRegistry ordered dispatch, wired into bootstrapServer. W3-M3 `51d0fb42a`: the external `POST /hooks/<event>` ingress — bearer / `X-Rox-Hook-Token` via the timing-safe compare, `?token=` → 400, non-POST → 405 + Allow, a per-IP 401 throttle (20/60 s → 429 + Retry-After, bounded map), a body bounded BEFORE buffering (413/400), an unregistered event → 404 before the body is read, listener failures → 200 with a failure count, and `/hooks/wake` delivering through the real `SessionManager.sendMessage` (no second delivery path); no route at all without a configured token. Verified v22 (12/12 over real HTTP, incl. the real binary and a real session read-back; the token never appears in the logs) | unsatisfiable cron expressions are rejected at registration with NO_MATCH; replay/idempotency (dedupe-by-id) is explicitly NOT implemented — every accepted POST dispatches (documented in the module header); the standalone binary reads `ROX_HOOKS_TOKEN`; `/hooks/wake` awaits the whole session turn |
| f.9 | Node/device model + presence + pending invokes | adapt | M | done | NodeRegistry + PresenceTracker + PendingInvokeTracker (packages/server-core/src/nodes/); nodes:* RPC handlers + HandlerDeps.nodes seam; 7 channels classified REMOTE_ELIGIBLE (IPC inventory regenerated for the nodes:* namespace); tests: nodes/__tests__/registry.test.ts, pending-invokes.test.ts, handlers/rpc/__tests__/nodes-rpc.test.ts, protocol/__tests__/routing.test.ts; corrective type repairs ecf82c88c | claims enforced against server allowlist before dispatch; the production hosts now compose the registry (`packages/server/src/handler-deps.ts` + the Electron main host, fix `6a3701ab2` from V12) and arm the presence sweep on the bootstrap scheduler, so `nodes:*` is live instead of CHANNEL_NOT_FOUND; a real device client remains the remaining gap |
| f.10 | State persistence: shared SQLite + per-agent DBs + writer lock | adapt | M | partial | W3-M2 `c0aae92ea`: `acquireStateWriterLock` (O_EXCL 0600, dead-PID/previous-boot/recycled-PID takeover, typed `STATE_LOCKED` naming the holder) + a per-store FIFO write queue (disjoint-key concurrency, no wedge on rejection) + a schema-versioned state SQLite (WAL, `user_version` migrations only — no per-write version) + a DERIVED sessions projection; wired into `SessionManager` flush/delete and held for the server lifetime; verified v21 (a duplicate boot refused on the legacy `.server.lock` — the typed `STATE_LOCKED` only with that lock absent, F1; SIGKILL mid-flush → rebuild purges a phantom and matches the JSONL exactly; deleting the DB still rebuilds; a stale lock is reclaimed; no per-write version and lockless writers lose updates (400+400→398), both fixed in the verification-fixes PR) | NAMED GAP: the TRANSCRIPT half is unwired on BOTH ends — nothing calls `replaceSessionTranscript` (no writer), nothing calls `readSessionTranscript` (no reader) and `rebuildWorkspace` never touches `session_transcript`, so those rows are never populated; the INDEX half now has its reader (wave-4 s5 `W4S5`: boot and single-session import read `readFreshHeaders` behind the count+maxHeaderMtime cookie, with a JSONL fallback + queued rebuild and a read-only drift guard) and writes now fail closed without the writer lock; the legacy `.server.lock` is acquired first, so the typed `STATE_LOCKED` surfaces only when it is absent (V21 F1, documented); cross-process serialisation is SQLite-level while each process keeps its own in-process queue |

## g (9 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| g.1 | Typed method→channel map + no raw webContents.send | reuse-as-is | S | reuse-as-is | verified: 905 channels in the auto-generated inventory test; raw-sends gate has 6 PRE-EXISTING violations on main (unchanged by this port) | route every new call through CHANNEL_MAP + RPC_CHANNELS |
| g.2 | Local-vs-remote channel classification (CI-enforced exhaustiveness) | reuse-as-is | S | reuse-as-is | verified: routing exhaustiveness test 26 pass / 0 fail after 42 new channels | an unclassified new channel fails CI |
| g.3 | WS RPC server/client transport with access modes | reuse-as-is | S | reuse-as-is | WsRpcClient/Server with access modes unchanged | re-subscribe listeners across workspace switches |
| g.4 | Per-session event stream attach point | reuse-as-is | S | reuse-as-is | SessionEventBus + sessions.EVENT projector used by every slice (no second socket) | subscribe to the bus, never open a second socket |
| g.5 | OMP RPC runtime + extension_ui_response obligation | reuse-as-is | M | reuse-as-is | OMP RPC host contract unchanged; skills/memory tools ride set_host_tools | unanswered extension_ui_request stalls the whole turn |
| g.6 | Identity + credential fabric | reuse-as-is | S | reuse-as-is | identity + credential fabric reused (skills env checks read service keys, never a new store) | use ROX fabric, not a parallel secret store |
| g.7 | WebUI host (browser dashboard) | reuse-as-is | S | done | S3 hardened the WebUI host (CSP, handoff, origin allow-list) | tokenized auth host for the web surface |
| g.8 | Russian-first i18n gate (12 locales, t(), parity) | reuse-as-is | S | reuse-as-is | verified: 135 new keys in all 12 locales; parity 57/57, sorted clean, coverage OK | every new key in all 12 files, ASCII-sorted, _one/_few/_many |
| g.9 | Updater + packaging (electron-updater, dmg/nsis/AppImage) | reuse-as-is | S | reuse-as-is | electron-updater packaging untouched | respect ad-hoc-signing detection and update-feed suppression |

