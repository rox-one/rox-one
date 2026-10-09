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

Row status counts (after wave 2): done=43, deferred=29, partial=5, reuse-as-is=16, skipped=3 (96 rows).

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
| a1.6 | Visitor-access plugin (Cloudflare Access policy, TTL, sweep) | adapt | M | deferred | needs Cloudflare Access policy coupling | Cloudflare policy coupling; serialized mutation queue required |
| a1.7 | trustedProxy / cloudflareAccessOidc ingress identity | skip | S | skipped | study verdict skip: only needed with a hosted ingress | only needed if a hosted ingress is added later |

## a2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| a2.1 | Sidebar filter/sort popover (Owners/Status/Group by) | reimplement | M | done | S2: Owners + Involving-me sections in CompactSessionListFilter; sort stays in existing CollectionViewChrome | "Involving me" is Gateway-evaluated over full participant history |
| a2.2 | Owner chip + pair-stack + assign submenu | adapt | M | done | S2 SessionOwnerChip + assign submenu (useSessionMenuActions) | attribution must follow created/owned/archived selection |
| a2.3 | Participant history rendering (creator vs owner vs participants) | adapt | S | done | S2 SessionParticipantsPopover renders creator/owner/participants | renaming a person must not rewrite participant history |
| a2.4 | Presence avatars + typing indicator | adapt | M | done | S2 live avatars + typing indicator; server tracker S1; 3 review findings fixed in port/fix-s2-presence | drafts must stay ephemeral, never in transcript/model context |
| a2.5 | Sharing menu: visibility + public link + members | reimplement | M | partial | visibility selector + members shipped (S2); copy-link only when sharedUrl exists; server-side enforcement in S1 | read-only/suggest/draft must be enforced server-side |
| a2.6 | Settings → Profile → Connected accounts (per-person model) | adapt | M | deferred | connected-accounts UI not built; identity/credential fabric reused as-is | reuse ROX secret store, not a second credential path |
| a2.7 | macOS WebChat surfaces (webview-hosted) | adapt | S | deferred | macOS WebChat surfaces untouched (Electron windows already serve web+runtime) | web + native experience share state, not drafts |

## b1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b1.1 | Serve dashboard static assets from same HTTP host | reuse-as-is | S | reuse-as-is | verified: createWebuiHandler serves the SPA on the RPC host (packages/server-core/src/webui/http-server.ts) | base-path/route-preload parity with ROX WebUI |
| b1.2 | Build pipeline: stable chunking + boot manifest + locale virtual modules | adapt | M | deferred | chunking/boot-manifest concept not ported (Vite build already stable) | Vite vs Bun bundler; keep boot-manifest *concept* |
| b1.3 | WS transport: hello/snapshot + method+event catalog | adapt | L | deferred | method/event catalog not ported; registeredChannelsFor already advertises capabilities | map Control-UI method inventory onto OMP RPC, not a new socket |
| b1.4 | Auth / pairing handoff (single-use bootstrap token) | adapt | M | done | S3 6b663b00b: single-use handoff token (hashed at rest, TTL<=120s, no URL credential) + fragment redemption; tests handoff.test.ts, handoff-fragment.test.ts | keep credential out of URL; origin allow-list |
| b1.5 | CSP / security headers + media ticket | adapt | S | done | W2-9 388067a39: CSP + security headers (S3) plus signed media tickets — GET /media/...?ticket=… authorised solely by an HMAC ticket (v1.<payload>.<sig>) bound to media path + session-cookie fingerprint, key domain-separated from the server secret, 5-min TTL (clamped 15 min), constant-time sig compare, uniform 403 on expired/tampered/cross-session/malformed, reused within TTL (media elements issue several requests per source), authenticated same-origin POST /media/ticket mints, ticket never logged; CSP unchanged. Tests: __tests__/media-ticket.test.ts | hash inline scripts; connect-src limited to self+ws |
| b1.6 | Offline/reconnect backoff + warm reload + outbox | adapt | M | done | S3: WS origin allow-list at upgrade (fail-closed); reconnect backoff already in WsRpcClient | Electron history/will-navigate replaces web-chrome hooks |
| b1.7 | Operator panels (40+ pages: chat, sessions, cron, logs, usage…) | reimplement | XL | reuse-as-is | apps/webui renders the full Electron renderer over CHANNEL_MAP (createWebApi); operator panels already reachable | port panel-by-panel; not a single cutover |
| b1.8 | Sandboxed plugin/agent widgets | reimplement | M | deferred | sandboxed widget host not ported (no ROX consumer identified) | isolated iframe/webview with strict CSP; load/hard timeouts |

## b2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b2.1 | Workboard server: workboard.* RPC + SQLite store + CAS | adapt | L | deferred | workboard/kanban server RPC not built in wave 1 | card↔session linkage must use ROX session model, not a new registry |
| b2.2 | Workboard browser plugin → React route + IPC bridge | reimplement | L | deferred | workboard browser plugin not built | keep "one capability object + subscribe/invalidate" pattern |
| b2.3 | Canvas show_widget → board.widget.put (script CSP sandbox) | adapt | L | deferred | canvas show_widget/board.widget.put not built | postMessage bridge is the real trust boundary; ticket-binding required |
| b2.4 | A2UI widget validation (v0.8 strict / v0.9 schema) | adapt | M | deferred | A2UI validation not ported | mixed versions must be rejected, not silently rendered |
| b2.5 | Canvas document host + buildWidgetDocument wrap | adapt | M | deferred | canvas document host not ported | bridge bytes must precede widget code; default-src 'none' |
| b2.6 | macOS embedded browser → Electron WebContentsView tabs | reimplement | L | deferred | embedded browser WebContentsView tabs not built | per-profile session.fromPartition; staged-then-commit downloads |
| b2.7 | WebChat window fleet + route encoding | adapt | M | deferred | WebChat fleet not built | keep "direct WS, no local static server" invariant |

## c1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c1.1 | SQLite index schema + per-agent DB + migrations | adapt | L | done | S5: chunk index with FTS5 (Bun) + JS BM25 (Electron) backends, index identity + rebuild; tests memory-index.test.ts | FTS5 + optional sqlite-vec must exist in ROX's SQLite build |
| c1.2 | Provenance gates (origin_class ∈ owner/agent) — the security property | reimplement | L | done | S5 provenance-gate.ts: originClass owner|agent|untrusted|system; untrusted retrievable-but-never-injected; bootstrap gated | skipping the gate = memory poisoning from untrusted tool/web output |
| c1.3 | Hybrid search: BM25 + vector → decay → importance → MMR | adapt | L | partial | BM25 + deterministic scorer shipped and parity-tested; vector leg blocked - sqlite-vec not loadable in bun:sqlite (probe recorded in S5 report) | chunking version + provider model form an index identity; rebuild state machine needed |
| c1.4 | Context injection via prompt snapshot → per-turn boundary | reimplement | L | partial | provenance-gated bootstrap block wired into buildMemoryBlocks (spawn-time); per-turn injection hook deferred | ROX has no context-engine equivalent; pass rendered addition over OMP RPC |
| c1.5 | Recall lanes: deterministic trigger + escalation sub-agent | adapt | M | done | W2-5: code+ledger in commit 0baf53092 (branch port/w2-lanes): lane 1 lexical-only selector (score >= 0.65, top 3, no model, stable order) + lane 2 bounded escalation in shared context-select.ts, wired into MemoryService.buildMemoryBlocks (single prompt path); tests context-select-recall.test.ts, memory-recall-lanes.test.ts | lane 1 stays lexical-only/deterministic; escalation is budgeted (3s, ≤8 candidates, ≤3 picks) and provenance-gated — untrusted chunks never escalate |
| c1.6 | Standing intents (prospective memory) | adapt | M | done | W2-5 (same commit as c1.5, 0baf53092; branch port/w2-lanes): StandingIntentStore ({workspace}/memory/standing-intents.jsonl) + matchStandingIntents/buildStandingIntentBlock, matched in buildMemoryBlocks (before_prompt_build equivalent), once per turn, deduplicated, provenance-gated; tests context-select-recall.test.ts, memory-recall-lanes.test.ts | time-only reminders belong to cron: rejected at add and ignored at match; per-turn hook is still the spawn-time blocks snapshot (see c1.4); intent create/list/cancel tool/RPC surface not in this slice |
| c1.7 | Memory wiki (claims/evidence/contradictions) | adapt | M | deferred | memory wiki not implemented | separable from capture — port after core memory works |
| c1.8 | Flush turn + forget/lineage retention | adapt | M | done | S6 @ 3d77c93: flush-turn.ts commits pending proposal write-intents at the session boundary (deterministic id order, receipt-idempotent, durable-intent-before-corpus = crash-safe; approve-memory-proposal.ts fault seam); forget.ts removes the corpus line (md block + lessons.jsonl line), rebuilds the chunk index and purges episodic embeddings, appends a hash-only lineage record to AuditLog (queryable, never injected); memory_forget tool (`memory-forget.ts` handler + registry); tests flush-turn.test.ts, forget.test.ts, memory-tool-callbacks.test.ts, memory-tools.test.ts | vector/embedding gap: c1.3's sqlite-vec leg is still blocked, so forget purges episodic.jsonl embeddings — when chunk vectors land they must join the same purge |

## c2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c2.1 | SKILL.md parse/materialize (frontmatter + body refs) | reuse-as-is | S | done | S4: SKILL.md frontmatter metadata.openclaw/rox parsed (requires/os/skillKey/primaryEnv/homepage) | ROX already ships a 330-skill catalog (SKILLS.lock) |
| c2.2 | Discovery roots + name-keyed precedence/collision report | adapt | M | done | S4 eligibility.ts detectSkillCollisions over the ordered root plan; reasons per code; fix-skills (F2/defect (e)): a collision-enabled pass reuses the SAME catalog walk's per-tier scans (`loadAllSkillsWithTierScans` caches catalog+scans; only cheap OMP tiers re-read) — single full-store walk, no ~12 s second walk (storage.test.ts "loadAllSkillsWithTierScans") | keep ordered root plan; do not collapse tiers silently |
| c2.3 | Gating/eligibility (agent allowlist, requires.bins/env/config) | adapt | M | done | S4 eligibility gating incl. missing-bin/env/config/os/allowlist/disabled-pack; skills:getEligibility RPC | key allowlists on ROX operator identity; map env to credential fabric |
| c2.4 | Prompt surface (<available_skills>) + skills_search/skills_read | adapt | M | done | S4 <available_skills> block in the OMP append prompt (bounded) + skills_search/skills_read host tools with root confinement; fix-skills (F1): eligibility now realpath-confines every entry to its discovered root BEFORE gating, so the report (and the block built from `report.eligible`) only advertises readable slugs — real store advertised_unreadable 25→0 (was 25/27; runtime keeps the same filter as defense-in-depth); skills-tool-runtime.test.ts "advertised implies readable", eligibility.test.ts realpath-confinement regression | inject into OMP session prompt; reuse tool-call path |
| c2.5 | Plugin manifest + registration-mode boundary | reimplement | L | deferred | sandboxed plugin worker boundary not built | ROX must NOT copy "in-process, unsandboxed" — worker boundary |
| c2.6 | Plugin lifecycle / hot reload (plugins.reload drain+swap) | adapt | L | deferred | plugin lifecycle/hot reload not built | restartRequired when process-shared code can't swap |
| c2.7 | Registry trust gate (verdict → clean/blocked, fail-closed) | reimplement | M | deferred | registry trust gate (fail-closed verdicts) not built | external registry shape; re-specify against ROX's registry |
| c2.8 | Custodian skills → system agent playbooks | adapt | S | done | W2-8: apps/electron/resources/skills/rox-custodian/{add-model-provider,configure-channel,diagnose-gateway}/SKILL.md (Gather→Mutate→Repair→Prove→Report; gated via metadata.openclaw requires.env=OPENCLAW_GATEWAY_TOKEN, diagnose-gateway os=darwin|linux); registered in SKILLS.lock + REQUESTED-SKILLS.json; eligibility.test.ts "rox-custodian gated bundled playbooks" | cloud-image-bake deliberately excluded (crabbox/AWS/Hetzner/Firecracker image bake has no ROX analogue); playbooks operate the ROX-managed OpenClaw gateway as skills, no new tool/channel |

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
| e2.2 | Operator/node WS client + lease fencing + node.invoke bridge | adapt | L | deferred | node/operator WS client lease fencing not built | per-connection lease/generation fencing on ROX transport |
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
| f.7 | Plugin activation planner + gateway-startup loading | reimplement | L | deferred | plugin activation planner not built | keep descriptors in the same registry as core |
| f.8 | Cron / hooks / single host-timer scheduler | adapt | M | partial | W2-3 `port/w2-cron` e56143594: HostScheduler single host timer (once/every/cron) with coalesced missed ticks + drift-free anchors + beginClose/stop, HookRegistry ordered dispatch, wired into bootstrapServer; tests scheduler/__tests__/{scheduler,cron-expr,hooks}.test.ts | in-process scheduler + hook registry shipped; unsatisfiable cron expressions (e.g. `0 0 30 2 *`) are rejected at registration with NO_MATCH; external HTTP `/hooks` webhook ingress not ported |
| f.9 | Node/device model + presence + pending invokes | adapt | M | done | NodeRegistry + PresenceTracker + PendingInvokeTracker (packages/server-core/src/nodes/); nodes:* RPC handlers + HandlerDeps.nodes seam; 7 channels classified REMOTE_ELIGIBLE (IPC inventory regenerated for the nodes:* namespace); tests: nodes/__tests__/registry.test.ts, pending-invokes.test.ts, handlers/rpc/__tests__/nodes-rpc.test.ts, protocol/__tests__/routing.test.ts; corrective type repairs ecf82c88c | claims enforced against server allowlist before dispatch; host still needs to supply deps.nodes + a device client |
| f.10 | State persistence: shared SQLite + per-agent DBs + writer lock | adapt | M | partial | memory index uses a per-scope SQLite DB; no unified writer-lock layer | single-writer lock; sessions JSON index + SQLite transcripts |

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

