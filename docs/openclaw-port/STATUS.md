# OpenClaw → ROX port — ledger

Source backlog: `port-analysis/port-matrix.md` (study 2026-10-09, `port-analysis/openclaw-features-2026-10-09`).
Target: `port/openclaw-features` from `origin/main` @ `7c2c202b7`.

Statuses: `todo` · `in-progress` · `done` · `deferred (reason)` · `skipped (reason)`. Every `done` row cites evidence (commit/test/demo).

## a1 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| a1.1 | Identity model — three actor kinds profile/channel/agent | adapt | M | todo | — | flattening actor kinds loses creator/participant attribution |
| a1.2 | Named operator roles + scope ceiling at admission | adapt | L | todo | — | ceiling must be intersected at WS admission, not just UI |
| a1.3 | Ownership layers (creator/owner/participants) + sessions.assignOwner | adapt | L | todo | — | creator is write-once; must persist or share authority changes |
| a1.4 | Presence map (connect snapshot + beacon, TTL 5 min) | adapt | M | todo | — | ephemeral-by-design; do not surface as authorization |
| a1.5 | Public session links (AES-256-GCM sealed locator) | reimplement | L | todo | — | token bound to installation device identity; revocation can't recall copies |
| a1.6 | Visitor-access plugin (Cloudflare Access policy, TTL, sweep) | adapt | M | todo | — | Cloudflare policy coupling; serialized mutation queue required |
| a1.7 | trustedProxy / cloudflareAccessOidc ingress identity | skip | S | todo | — | only needed if a hosted ingress is added later |

## a2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| a2.1 | Sidebar filter/sort popover (Owners/Status/Group by) | reimplement | M | todo | — | "Involving me" is Gateway-evaluated over full participant history |
| a2.2 | Owner chip + pair-stack + assign submenu | adapt | M | todo | — | attribution must follow created/owned/archived selection |
| a2.3 | Participant history rendering (creator vs owner vs participants) | adapt | S | todo | — | renaming a person must not rewrite participant history |
| a2.4 | Presence avatars + typing indicator | adapt | M | todo | — | drafts must stay ephemeral, never in transcript/model context |
| a2.5 | Sharing menu: visibility + public link + members | reimplement | M | todo | — | read-only/suggest/draft must be enforced server-side |
| a2.6 | Settings → Profile → Connected accounts (per-person model) | adapt | M | todo | — | reuse ROX secret store, not a second credential path |
| a2.7 | macOS WebChat surfaces (webview-hosted) | adapt | S | todo | — | web + native experience share state, not drafts |

## b1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b1.1 | Serve dashboard static assets from same HTTP host | reuse-as-is | S | todo | — | base-path/route-preload parity with ROX WebUI |
| b1.2 | Build pipeline: stable chunking + boot manifest + locale virtual modules | adapt | M | todo | — | Vite vs Bun bundler; keep boot-manifest *concept* |
| b1.3 | WS transport: hello/snapshot + method+event catalog | adapt | L | todo | — | map Control-UI method inventory onto OMP RPC, not a new socket |
| b1.4 | Auth / pairing handoff (single-use bootstrap token) | adapt | M | todo | — | keep credential out of URL; origin allow-list |
| b1.5 | CSP / security headers + media ticket | adapt | S | todo | — | hash inline scripts; connect-src limited to self+ws |
| b1.6 | Offline/reconnect backoff + warm reload + outbox | adapt | M | todo | — | Electron history/will-navigate replaces web-chrome hooks |
| b1.7 | Operator panels (40+ pages: chat, sessions, cron, logs, usage…) | reimplement | XL | todo | — | port panel-by-panel; not a single cutover |
| b1.8 | Sandboxed plugin/agent widgets | reimplement | M | todo | — | isolated iframe/webview with strict CSP; load/hard timeouts |

## b2 (7 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| b2.1 | Workboard server: workboard.* RPC + SQLite store + CAS | adapt | L | todo | — | card↔session linkage must use ROX session model, not a new registry |
| b2.2 | Workboard browser plugin → React route + IPC bridge | reimplement | L | todo | — | keep "one capability object + subscribe/invalidate" pattern |
| b2.3 | Canvas show_widget → board.widget.put (script CSP sandbox) | adapt | L | todo | — | postMessage bridge is the real trust boundary; ticket-binding required |
| b2.4 | A2UI widget validation (v0.8 strict / v0.9 schema) | adapt | M | todo | — | mixed versions must be rejected, not silently rendered |
| b2.5 | Canvas document host + buildWidgetDocument wrap | adapt | M | todo | — | bridge bytes must precede widget code; default-src 'none' |
| b2.6 | macOS embedded browser → Electron WebContentsView tabs | reimplement | L | todo | — | per-profile session.fromPartition; staged-then-commit downloads |
| b2.7 | WebChat window fleet + route encoding | adapt | M | todo | — | keep "direct WS, no local static server" invariant |

## c1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c1.1 | SQLite index schema + per-agent DB + migrations | adapt | L | todo | — | FTS5 + optional sqlite-vec must exist in ROX's SQLite build |
| c1.2 | Provenance gates (origin_class ∈ owner/agent) — the security property | reimplement | L | todo | — | skipping the gate = memory poisoning from untrusted tool/web output |
| c1.3 | Hybrid search: BM25 + vector → decay → importance → MMR | adapt | L | todo | — | chunking version + provider model form an index identity; rebuild state machine needed |
| c1.4 | Context injection via prompt snapshot → per-turn boundary | reimplement | L | todo | — | ROX has no context-engine equivalent; pass rendered addition over OMP RPC |
| c1.5 | Recall lanes: deterministic trigger + escalation sub-agent | adapt | M | todo | — | lane 1 must stay lexical-only and deterministic (≥0.65, top 3) |
| c1.6 | Standing intents (prospective memory) | adapt | M | todo | — | matched on before_prompt_build; time reminders belong to cron |
| c1.7 | Memory wiki (claims/evidence/contradictions) | adapt | M | todo | — | separable from capture — port after core memory works |
| c1.8 | Flush turn + forget/lineage retention | adapt | M | todo | — | forget must remove corpus lines + chunks + embeddings, not just prose |

## c2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| c2.1 | SKILL.md parse/materialize (frontmatter + body refs) | reuse-as-is | S | todo | — | ROX already ships a 330-skill catalog (SKILLS.lock) |
| c2.2 | Discovery roots + name-keyed precedence/collision report | adapt | M | todo | — | keep ordered root plan; do not collapse tiers silently |
| c2.3 | Gating/eligibility (agent allowlist, requires.bins/env/config) | adapt | M | todo | — | key allowlists on ROX operator identity; map env to credential fabric |
| c2.4 | Prompt surface (<available_skills>) + skills_search/skills_read | adapt | M | todo | — | inject into OMP session prompt; reuse tool-call path |
| c2.5 | Plugin manifest + registration-mode boundary | reimplement | L | todo | — | ROX must NOT copy "in-process, unsandboxed" — worker boundary |
| c2.6 | Plugin lifecycle / hot reload (plugins.reload drain+swap) | adapt | L | todo | — | restartRequired when process-shared code can't swap |
| c2.7 | Registry trust gate (verdict → clean/blocked, fail-closed) | reimplement | M | todo | — | external registry shape; re-specify against ROX's registry |
| c2.8 | Custodian skills → system agent playbooks | adapt | S | todo | — | ship as gated bundled skills, not privileged tools |

## d1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| d1.1 | Talk event vocabulary (TALK_EVENT_TYPES) + sequencer | adapt | M | done | `packages/shared/src/voice/talk-events.ts`; `__tests__/talk-events.test.ts` (sequencer + reorder buffer monotonicity) | one event model shared by renderer/server/future mobile |
| d1.2 | Provider registry (realtime voice + speech) | adapt | M | done | `packages/shared/src/voice/provider-registry.ts`; `realtime-providers/openai.ts`; `__tests__/provider-registry.test.ts`; `voice:wakeGet`/`voice:providers` handlers | resolved from `getServerServiceKey`; typed `unconfigured`/`unknown-provider` errors, never a fake provider |
| d1.3 | Realtime bridge state machine (connect/retry/pending audio) | adapt | L | done | `packages/shared/src/voice/realtime-bridge.ts`; `__tests__/realtime-bridge.test.ts` (every transition, retry/terminal, caps/TTL); OpenAI protocol vs local WS fixture `__tests__/openai-realtime.test.ts` | credentials stay in main; renderer gets ephemeral client secret only |
| d1.4 | TTS pipeline (buffered + streaming + precedence) | adapt | M | done | `packages/shared/src/voice/tts/{synthesis,streaming,resolution}.ts`; `__tests__/tts-streaming.test.ts`; `voice:ttsStreamStart/Stop` handlers | device playback stays renderer/native |
| d1.5 | STT relay (WS reconnect + bounded queues) | adapt | M | done | `packages/shared/src/voice/realtime-transcription.ts`; `__tests__/realtime-transcription.test.ts`; `voice:sttStart/Audio/Stop` + `voice:sttEvent` push | browser codec g711_ulaw@8k / pcm16@24k |
| d1.6 | Voice wake list + broadcast; on-device recognition only | adapt | M | done | `packages/shared/src/voice/wake-list.ts`; `__tests__/wake-list.test.ts`; `voice:wakeGet/wakeSet/wakeChanged` + `voice:trigger` handlers | foreground-gated; route triggers to sessions |
| d1.7 | Telephony voice-call (Twilio/Telnyx/Plivo) | skip | L | todo | — | needs public webhook + tunnel infra; desktop model must host or delegate |
| d1.8 | Meeting realtime engine seam | adapt | M | todo | — | verify ROX meeting stack can host realtime engines |

## d2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| d2.1 | Session runtime (keyed transport:url lock, tab ownership, retry) | adapt | L | todo | — | transport-agnostic orchestrator over ROX meeting package |
| d2.2 | Transport selection (chrome / chrome-node / twilio dial-in) | reimplement | XL | todo | — | Chrome DOM automation fragility; no vendor SDK claimed |
| d2.3 | Caption transcription + per-line provenance/ownEcho | adapt | L | todo | — | without provenance+ownEcho you echo the agent's own TTS into notes |
| d2.4 | Notes/summary pipeline (5-min cadence + heuristic fallback) | adapt | L | todo | — | strict JSON schema + 20s budget; deterministic fallback |
| d2.5 | Participation idempotency (fingerprint dedupe, one correction) | reuse-as-is | M | todo | — | observations never grant action authority |
| d2.6 | Google Meet OAuth + artifacts (PKCE, scopes, Drive) | adapt | M | todo | — | Media API is Developer Preview; Workspace enrolment may block |
| d2.7 | Feishu VC invite trigger (synthetic p2p message) | adapt | M | todo | — | handler must not call a join API directly; default-off |
| d2.8 | Retention: no recording; bounded in-memory caps | adapt | S | todo | — | keep transcripts.enabled kill switch + explicit observe tail |

## e1 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| e1.1 | curl/bash installer + Node provisioning + PATH rc rewrite | skip | S | todo | — | Electron packaging replaces the npm-global flow |
| e1.2 | Runtime capability probe (SQLite WAL-safe + version floor) | adapt | S | todo | — | keep the user-space runtime fallback under <state>/tools/ |
| e1.3 | Onboard --install-daemon tri-state decision | adapt | M | todo | — | quickstart=install default; skip when externally supervised |
| e1.4 | LaunchAgent plist/env wrapper → OS service abstraction | reimplement | L | todo | — | transactional publish+rollback; 0600 env file else bricked service |
| e1.5 | Service authority/status fences | adapt | M | todo | — | refuse mutation from inside the service; system-daemon ownership |
| e1.6 | Doctor diagnostics (foreign jobs, port, runtime mismatch) | adapt | M | todo | — | port-conflict/runtime-mismatch only; skip launchd reaping |
| e1.7 | Update channels + checkOnStart + detached handoff | reuse-as-is | S | todo | — | wait-for-old-PID helper replaces kickstart |
| e1.8 | State dir / logs / uninstall scopes | adapt | S | todo | — | map ~/.openclaw → ~/.rox; stop service before deleting state |

## e2 (8 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| e2.1 | Menu-bar/tray shell + navigation dispatch | adapt | M | todo | — | main-process router: Dashboard(web) vs native chat |
| e2.2 | Operator/node WS client + lease fencing + node.invoke bridge | adapt | L | todo | — | per-connection lease/generation fencing on ROX transport |
| e2.3 | Embedded-surface IPC (webview message handlers) | adapt | L | todo | — | definition of window.roxDesktop; version every handler |
| e2.4 | Node capability model + TCC prompts | reimplement | L | todo | — | TCC/signature+path coupling: bundle-ID/path change resets grants |
| e2.5 | LaunchAgent management from app (install/start/stop, runtime pin, resume) | reimplement | L | todo | — | preserve "who owns the Gateway" or get duplicate gateways |
| e2.6 | Auto-update: Sparkle → electron-updater + channel gating | reuse-as-is | S | todo | — | keep app and gateway/OMP on compatible release trains |
| e2.7 | Helper processes: stdio framing + app-control/exec UDS | reimplement | M | todo | — | 0600 token + HMAC + peer-UID; separate exec-approvals socket |
| e2.8 | Signing / notarization / entitlements | adapt | M | todo | — | JIT entitlements only to runtime binaries; Team-ID audit fails closed |

## f (10 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| f.1 | Process model: single owner + state lock + loopback bind | adapt | L | todo | — | one in-process gateway module; refuse non-loopback without auth |
| f.2 | Transport: req/res/event frames + connect-first handshake | adapt | L | todo | — | one generated contract packet + N-1 window; no Swift codegen |
| f.3 | Method registry + namespace/scope policy | adapt | M | todo | — | plugin methods must not weaken reserved core prefixes |
| f.4 | Sessions/routing/queue steering (steer/followup/collect/interrupt) | adapt | L | todo | — | per-session + global lane serialization as OMP queue policy |
| f.5 | Agent loop: streaming + activeWriterRunId transcript fence | adapt | L | todo | — | agent returns runId immediately; agent.wait waits terminal |
| f.6 | Config JSON5 + SecretRef (env/file/exec) + hot reload | adapt | L | todo | — | map SecretRef onto ROX credential sources; skip invalid reloads |
| f.7 | Plugin activation planner + gateway-startup loading | reimplement | L | todo | — | keep descriptors in the same registry as core |
| f.8 | Cron / hooks / single host-timer scheduler | adapt | M | todo | — | beginClose/stop semantics; coalesce missed ticks |
| f.9 | Node/device model + presence + pending invokes | adapt | M | todo | — | caps/commands are claims; enforce server-side allowlists |
| f.10 | State persistence: shared SQLite + per-agent DBs + writer lock | adapt | M | todo | — | single-writer lock; sessions JSON index + SQLite transcripts |

## g (9 rows)

| id | capability | verdict | effort | status | evidence | notes |
|---|---|---|---|---|---|---|
| g.1 | Typed method→channel map + no raw webContents.send | reuse-as-is | S | todo | — | route every new call through CHANNEL_MAP + RPC_CHANNELS |
| g.2 | Local-vs-remote channel classification (CI-enforced exhaustiveness) | reuse-as-is | S | todo | — | an unclassified new channel fails CI |
| g.3 | WS RPC server/client transport with access modes | reuse-as-is | S | todo | — | re-subscribe listeners across workspace switches |
| g.4 | Per-session event stream attach point | reuse-as-is | S | todo | — | subscribe to the bus, never open a second socket |
| g.5 | OMP RPC runtime + extension_ui_response obligation | reuse-as-is | M | todo | — | unanswered extension_ui_request stalls the whole turn |
| g.6 | Identity + credential fabric | reuse-as-is | S | todo | — | use ROX fabric, not a parallel secret store |
| g.7 | WebUI host (browser dashboard) | reuse-as-is | S | todo | — | tokenized auth host for the web surface |
| g.8 | Russian-first i18n gate (12 locales, t(), parity) | reuse-as-is | S | todo | — | every new key in all 12 files, ASCII-sorted, _one/_few/_many |
| g.9 | Updater + packaging (electron-updater, dmg/nsis/AppImage) | reuse-as-is | S | todo | — | respect ad-hoc-signing detection and update-feed suppression |

