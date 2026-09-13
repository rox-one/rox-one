# Rox — Integration Audit (product surfaces inventory)

- **Audited repo:** `rox-one/rox-one` @ `5797f431` (branch `main`), 2026-08-12
- **Donor repo:** `agisota/craft-agents-oss` @ `5797f43` — **identical commit** to destination `main` (see §1)
- **Upstream:** `craft-ai-agents/craft-agents-oss` @ `50ffa14` (v0.11.4)
- **Website repo:** `rox-one/rox-one-website` — private, **inaccessible** from this environment (404 for both authenticated and anonymous access); audited only via references from this repo
- **Environment:** Linux x64 cloud VM, Bun 1.3.14, no Rox gateway credentials (`~/.omp/agent/config.yml` absent), no LLM API keys

## Status legend

| Status | Meaning |
|---|---|
| `NOT_STARTED` | No implementation on `main` (may exist as spec/branch only) |
| `STUB` | Types/placeholder/dead artifact only; no working path |
| `PARTIAL` | Implemented but with material gaps that block or degrade the primary flow |
| `FUNCTIONAL` | Code-complete and plausibly works end-to-end; not exercised live in this audit |
| `VERIFIED` | Exercised live during this audit (build/run/tests/HTTP/browser probes) with evidence below |

## 0. Executive summary

The Rox stack **builds and runs from `main`**: `bun install` (1785 packages), subprocess bundles, webui production build, and the headless server all succeed on a clean Linux VM. The web/API stack was verified over HTTP and in a real browser (login → SPA → session creation). The server's built-in CLI validation passes its infrastructure steps (connect, credentials, workspaces, sessions CRUD, connections, sources) and fails exactly where a live LLM is required — the seeded default connection is the OMP backend, which needs Rox gateway credentials that are not present on a fresh machine.

Status matrix (details per surface in §3):

| # | Surface | Status | One-line verdict |
|---|---|---|---|
| 3.1 | OMP backend (`OmpAgent`) | **VERIFIED (protocol/infra) / PARTIAL (turn E2E on clean host)** | Full v2 implementation (G1–G4) matches docs; RPC handshake verified live against omp 17.2.10; no dedicated unit tests; spawn-failure **hang** without credentials (reproduced in CLI and browser) |
| 3.2 | Agent runtime controls | **FUNCTIONAL** | Modes/thinking/model/steer/abort complete for all 3 backends; minor default drift (`ask` fallback vs `allow-all` bundle) |
| 3.3 | Notes / PKM / Knowledge (SiYuan) | **PARTIAL** | P1–P6 + surfaces merged and well-tested, but requires an external SiYuan kernel; navigator tree and agent-panel CTAs are stubs; skills reference agent tools that don't exist; managed kernel NOT_STARTED (legal gate) |
| 3.4 | Sources / MCP | **FUNCTIONAL** (registry VERIFIED live) | Mature system with real 3-backend parity incl. OMP proxies; SSE transport is advertised but not implemented |
| 3.5 | Secrets / Infisical / toolchain / marketplace | **VERIFIED (toolchain live) / NOT_STARTED (Infisical as secrets backend)** | Toolchain auto-installed ~19 tools incl. omp on first boot; Infisical is only an opt-in CLI download; signed marketplace functional |
| 3.6 | Session collections & views | **FUNCTIONAL** | list/table/board + multi-select/bulk/rank landed with tests; filters not persisted (FR-11), list rank-drag missing (FR-45) |
| 3.7 | Remote sessions / cloud | **VERIFIED (server, webui, CLI, viewer prod) / FUNCTIONAL (gateways, messaging) / PARTIAL (iOS)** | Web/API stack verified over HTTP+browser; share API live but unauthenticated; Rox Connect desktop-only and blocked on private website repo |
| 3.8 | Artifact / design surfaces | **FUNCTIONAL** (`dashboard.html` = STUB orphan; design canvas NOT_STARTED) | Rich chat artifact rendering (HTML/mermaid/diff/mindmap) with tests; no first-class artifact entity |
| 3.9 | White-label / Rox branding / unified shell | **PARTIAL** | Shell waves W1–W6 merged (W1 chrome behind default-OFF flag); brand split-brain: Rox cloud identity vs Craft shipping identity (~92 files still Craft-branded) |

Top cross-cutting risks: (1) fresh-install default connection cannot produce a turn without out-of-band `~/.omp` credentials, and the failure mode is a **silent hang** — reproduced in both the CLI harness and the real browser UI; (2) the public viewer share API accepts unauthenticated POST/PUT/DELETE; (3) product docs drift from code in several load-bearing places (§4, §6); (4) the private website repo is a hard dependency for Connect/billing and cannot be audited from here.

Method: static audit of `main` plus live execution on this VM (installs, builds, server boot, HTTP probes, CLI validation, OMP RPC probe, targeted `bun test` suites, Chromium browser session against the running webui) and read-only GET probes of production `agents.rox.one`. No third-party code was copied; no production infrastructure was modified.

---

## 1. Repository relationships

- `rox-one/rox-one` `main` **HEAD == `agisota/craft-agents-oss` `main` HEAD** (`5797f431`). The "donor" is the same code line; treating agisota as legacy means its 7 residual branches (`fix/sessions-*`, `fix/renderer-*`, `feat/shell-ext-activate2`, `fix/rox-connect-onboarding-followup`) are the only unique donor material, and all appear to be merged-PR leftovers (e.g. `fix/sessions-fr38-fr47` = merged PR #64).
- `rox-one/rox-one` carries ~87 branches, but the big feature series are **already on `main`** via squash merges with stale branch tips left behind: `feat/knowledge-p1…p7` / `feat/knowledge-w2-knowledge-mode` / `feat/p4-siyuan-surfaces` (knowledge PRs #4–#12), `feat/shell-w1…w6` + `feat/shell-plugin-feed` (shell PRs #5–#20), and `feat/runtime-context-finish` (verified 0 commits ahead / 154 behind). The `feature/pr-NNN-*` family (~80 branches) is the bulk-port pipeline of upstream PRs #663–#1005 (`integration/2026-08-06-pr-bundle`); several of those remain genuinely unmerged. Branch hygiene: most of the list is prunable.
- Upstream `craft-ai-agents/craft-agents-oss` is at v0.11.4; this fork self-versions v0.11.5. Upstream already contains `apps/{cli,electron,viewer,webui}` and `packages/{server,server-core,messaging-gateway,messaging-whatsapp-worker,…}` — i.e. **webui/viewer/CLI/remote server/messaging are upstream Craft features**, not Rox inventions. The Rox delta is enumerated in §5.
- `rox-one/rox-one-website` (better-auth, device APIs, cabinet, Neon source-of-truth per `docs/ROX_CLOUD_CONNECT.md`) is private and 404 for this environment — its API surface is audited only from the desktop-side contract (§3.7.8).

## 2. Build & run verification (what was actually executed)

| Step | Command | Result |
|---|---|---|
| Install | `bun install` | **OK** — 1785 packages, no failures |
| Subprocess bundles | `bun run server:build:subprocess` | **OK** — session-mcp-server (4.65 MB cjs), pi-agent-server (28.73 MB esm) |
| Web UI build | `bun run webui:build` | **OK** — vite 6, 5401 modules; large-chunk warnings only |
| Headless server | `CRAFT_SERVER_TOKEN=… CRAFT_WEBUI_DIR=apps/webui/dist CRAFT_BUNDLED_ASSETS_ROOT=$PWD/apps/electron CRAFT_DEBUG=true bun run packages/server/src/index.ts` | **OK** — `ws://127.0.0.1:9100` + webui on same port; seeds `rox-kimi` connection, syncs 5 bundled skill packs, seeds soul.md/rules.md, schedules toolchain install |
| Web UI HTTP | `POST /api/auth` (password) → cookie → `/api/config`, `/` | **OK** — JWT cookie issued; `{"wsUrl":"ws://127.0.0.1:9100"}`; SPA served; unauth `/` → 302 `/login` |
| Web UI browser | Chromium session (login → app → new chat → settings) | See §3.7.2 |
| CLI integration test | `bun run apps/cli/src/index.ts --validate-server --url ws://127.0.0.1:9100 --token …` | Steps 1–10/40 **pass** (handshake, credentials health, versions, homeDir, workspaces, sessions, connections list, sources list, session create, getMessages). Step 11 `send message + stream` **times out after 60 s** — see OMP finding §3.1 |
| Typecheck | `tsc --noEmit` in `packages/shared`, `packages/server-core`, `apps/electron` | shared **OK**, server-core **OK**, electron **OK** |
| Test suites | `bun test` on toolchain / skills / webui / i18n / agent / knowledge / views | **All green**: 57, 49, 8, 90, 867 (+1 skip), 154, 11 pass respectively |
| OMP RPC probe | spawn `omp --mode rpc` (toolchain-installed 17.2.10), answer `extension_ui_request`, send `get_state`, `get_available_models`, `set_host_tools` | **OK** — ready frame `{protocolVersion:1, supportedProtocolVersions:[1,2], maxFrameBytes:1048576, maxReassembledFrameBytes:67108864}` exactly as documented; `set_host_tools` ack `{toolNames:[…]}` |
| Viewer prod probe (read-only) | `GET https://agents.rox.one/` and `/s/api/<bogus-id>` | **OK** — 200 on root; share API responds `{"error":"Not found"}` |

Notes:
- `bun run server:dev:webui` sets `CRAFT_WEBUI_PORT=3100`, but **nothing reads that env var** — the webui is embedded on the RPC port (9100). Dead knob in the root script.
- Root scripts `marketing:*` and `docs:dev` reference `apps/marketing` / `apps/online-docs`, which **do not exist** in this repo (excluded in `workspaces` and physically absent).
- The AGENTS.md build/test workflow ("Bun, `bun install`, `bun test <path>`, per-package `tsc --noEmit`") was followed and works as documented; AGENTS.md contains no additional web-stack-specific instructions, so the canonical run path is the root `server:*`/`webui:*` scripts used above.

---

## 3. Surface audits

Every surface records: implementation files, UI entry point, backend/API, persistence, auth, runtime dependency, test coverage, actual runnable status, missing work.

### 3.1 OMP backend (provider `omp`) — **VERIFIED (protocol/infra) / PARTIAL (turn E2E on a clean host)**

**Implementation files**
- `packages/shared/src/agent/omp-agent.ts` (1889 lines) — `OmpAgent extends BaseAgent`; spawn/RPC plumbing, event mapping, host-tools bridge, branching, permissions, one-shot completions.
- `packages/shared/src/agent/backend/factory.ts` — `case 'omp'` in `createBackend`, provider mapping, `getDefaultAuthType('omp') === 'none'`.
- `packages/shared/src/agent/backend/internal/drivers/omp.ts` — no-op driver (auth/model config owned by the OMP CLI itself).
- `packages/shared/src/agent/session-tool-defs.ts` — shared `buildSessionToolDefs()` (registry + mcpPool proxy defs) used by both PiAgent and OmpAgent (PRD G1 §1.5 "single source of truth" satisfied).
- `packages/shared/src/skills/omp-discovery.ts` — G4 skills discovery (`~/.omp/agent/skills`, `~/.agents/skills`, `<ws>/.omp/skills`; 60 s TTL + dir-mtime cache); export via `skills:importOmp` RPC (`packages/shared/src/protocol/channels.ts`, renderer `SkillsListPanel.tsx`).
- `packages/shared/src/toolchain-runtime.ts` — `resolveOmpExecutableOrExplain()` (`OMP_CLI_PATH` env → toolchain → PATH → "still installing" explainer → literal `omp`), `withToolchainPathPrefix()`.
- `packages/shared/src/config/storage.ts` — `seedDefaultLlmConnection()` creates `rox-kimi` (providerType `omp`, authType `none`, defaultModel `kimi-K3`, baseUrl `https://api.rox.one/v1`); optional `ROX_API_KEY` env mirrored into the credential store for a potential `pi_compat` fallback.
- Thinking-stream plumbing (G2): `packages/core/src/types/message.ts`, `packages/shared/src/protocol/dto.ts`, `packages/server-core/src/sessions/SessionManager.ts`, `apps/electron/src/renderer/event-processor/handlers/thinking.ts`, `packages/ui/src/components/chat/ThinkingCard.tsx`.
- Branch anchors (G3): `omp_turn_anchor` event → SessionManager persists `meta/omp-turn-anchors.json` (same pattern as pi-turn-anchors).

**UI entry points** — onboarding provider preset (`components/onboarding/ProviderSelectStep.tsx`, `hooks/useOnboarding.ts`), `AiSettingsPage.tsx` connection label, model picker group (`components/app-shell/input/model-picker-helpers.ts`), provider icon (`lib/provider-icons.ts`), OMP skills group + export in `SkillsListPanel.tsx`, toolchain banner `ToolchainStatusBanner.tsx`.

**Backend/API** — NDJSON over stdio to `omp --mode rpc` (spawn args: `--session-dir <ws>/sessions/<id>/omp`, `--append-system-prompt <craft context+prefs+project+context-docs+memory>`, `--approval-mode yolo` iff craft mode `allow-all`). Commands used: `prompt`, `steer`, `abort`, `get_state`, `get_available_models`, `set_model {provider,modelId}`, `set_thinking_level`, `set_host_tools`, `switch_session`, `branch {entryId}`. One-shot `omp -p` for `runMiniCompletion`/`queryLlm`.

**Persistence** — craft session store owns history; OMP mirror transcript at `<workspace>/sessions/<craftSessionId>/omp/*.jsonl`; branch anchors sidecar `omp-turn-anchors.json`; OMP model/auth config in user-owned `~/.omp/agent/` (read-only from craft).

**Auth** — none in craft (`authType: 'none'`); the OMP CLI reads gateway credentials from `~/.omp/agent/config.yml`. Nothing in this repo provisions that file.

**Runtime dependency** — `omp` binary: toolchain auto-installs npm `@oh-my-pi/pi-coding-agent` 17.2.10 (critical/core tier, depends on toolchain `bun`+`node`). Verified live: on first server boot the toolchain downloaded and installed omp at `~/.craft-agent/toolchain/omp/current/bin/omp` within ~35 s.

**Test coverage** — **no dedicated OmpAgent unit tests.** Indirect only: `context-docs/__tests__/acceptance-prd.test.ts` exercises `composeOmpAppendSystemPrompt`; `pi-browser-tool-toggle.test.ts` covers `buildSessionToolDefs`; `skills` suite covers discovery storage (49 pass); toolchain suite (57 pass) covers install machinery. The event-mapping layer (message_update/thinking/tool events), the host-tool bridge dispatch, `applyOmpBranchHandshake`, and the permission proxying have zero unit coverage. The PRD's own acceptance criteria (§6 C–G, live checks) are not represented as automated tests in the repo.

**Actual runnable status**
- VERIFIED live in this audit: toolchain install of omp; spawn of `omp --mode rpc`; full documented handshake (`ready` → `extension_ui_request(setWidget)` → `available_commands_update`); `get_state` / `get_available_models` / `set_host_tools` request-response including the `loadMode: 'essential'` shape and `{toolNames:[…]}` ack.
- NOT verifiable here: an actual model turn (requires `~/.omp/agent/config.yml` for the Rox gateway or any provider API key; neither available). On the seeded fresh install the first message therefore fails.
- **Bug found (live):** when omp exits before sending the `ready` frame (exactly what happens on a credential-less host: `No models available… code=1`), the turn **hangs forever** instead of erroring. `handleSubprocessExit` nulls `subprocess`/`subprocessReadyResolve`, so the 20 s ready-timeout guard in `spawnSubprocess` (`if (this.subprocess === childRef && this.subprocessReadyResolve)`) can never reject, the ready race never settles, and `chatImpl` stays awaiting `ensureSubprocess()` (observed: CLI `send message + stream` timing out at 60 s with no error event; server log ends at `OMP subprocess exited: code=1` with no follow-up).

**Missing work**
1. Fix the pre-ready exit hang (reject the ready promise from `handleSubprocessExit`, or resolve+check `spawnError`).
2. First-run credential story: nothing provisions `~/.omp/agent/config.yml`; onboarding completes with a connection that cannot run a turn, and the failure is silent (see hang). At minimum surface the omp stderr guidance ("No models available…") as a typed error/auth prompt.
3. Unit tests for the event adapter, host-tool dispatch, and branch handshake (parse fixtures exist in docs).
4. `queryLlm` ignores `request.model`/`maxTokens`/`temperature` and reports `this._model` as the effective model while `omp -p` actually uses OMP's own default model — violates the repo's documented `queryLlm` backend contract ("MUST NOT return a fabricated model").
5. Stale header comment in `omp-agent.ts` (~line 41): "MCP source-proxy tools from the pool are NOT bridged in v1" — contradicted ~1000 lines later by the v2 G1 implementation in the same file.
6. Attachments are text-flattened into the prompt (images not passed over RPC) — acknowledged in code as unverified wire contract, still a functional gap vs pi/claude.

### 3.2 Agent runtime controls — **FUNCTIONAL**

**Implementation files** — `packages/shared/src/agent/mode-types.ts` + `mode-manager.ts` (modes `safe`/`ask`/`allow-all`, canonical display map explore/ask/execute, bash AST validation), `permissions-config.ts` (+ layered `permissions.json` app/workspace/source), `core/permission-manager.ts`, `thinking-levels.ts` (`off…max`, legacy `'think'`→`'medium'` normalization), per-backend enforcement in `claude-agent.ts` (PreToolUse hooks over SDK `bypassPermissions`), `pi-agent.ts` (PermissionManager at PreToolUse), `omp-agent.ts` (spawn-time `--approval-mode yolo` + permission-dialog proxying); `packages/server-core/src/sessions/SessionManager.ts` (`setSessionPermissionMode`, `defaultRestorePermissionMode`, `updateSessionModel`, `cancelProcessing`, mid-stream `resolveMidStreamBehavior` steer-vs-queue).

**UI entry** — chat input `CompactPermissionModeSelector` / `CompactModelSelector` / thinking menu in `FreeFormInput.tsx`; `Shift+Tab` cycle (`chat.cyclePermissionMode`); Settings → Runtime (`RuntimeSettingsPage.tsx`), Workspace, AI (`AiSettingsPage.tsx`).

**Backend/API** — `sessions:command` (`setPermissionMode`, `setThinkingLevel`, `setSessionStatus`, …), `sessions:getPermissionModeState`, `sessions:respondToPermission`, `sessions:cancel`, `session:setModel`; push event `permission_mode_changed`.

**Persistence** — session JSONL header (`permissionMode`, `previousPermissionMode`, `thinkingLevel`, `model`, `llmConnection`); workspace `config.json` `defaults.*`; app `~/.craft-agent/config-defaults.json` (synced from bundle each launch: `permissionMode: "allow-all"`, cyclable `["safe","allow-all"]` — `ask` deliberately out of the cycle); explore rules in `~/.craft-agent/permissions/default.json`.

**Auth** — n/a (LLM credentials handled by connections; see §3.4/§3.5).

**Runtime dependency** — backend-specific: OMP mode flip across the allow-all boundary **kills and respawns** the subprocess (spawn-time flag), pi/claude flip in-process; model switch is live on all three (OMP via `set_model` RPC).

**Test coverage** — extensive: `mode-manager*` suites, `permission-manager.test.ts`, `permissions-config-migration`, `jsonl-permission-mode-normalization`, `previous-permission-mode`, `default-thinking-level`, `claude-thinking-config`, `model-picker-helpers.test.ts`, renderer `permission-mode-changed.test.ts` (all part of the green 867-test agent run in §2).

**Status** — FUNCTIONAL end-to-end (UI → RPC → SessionManager → modeManager + agent + persistence + events).

**Missing work**
1. Default drift: TS fallback `FALLBACK_CONFIG_DEFAULTS.permissionMode = 'ask'` vs bundled `config-defaults.json` `allow-all` (fallback only used if the bundle is missing, but should agree).
2. Bundled `thinkingLevel: "think"` relies on the legacy normalizer; set it to `"medium"` and retire the compat path.
3. The seeded "permission-mode change audit" automation ships **disabled**; enable or remove.
4. Claude steering is hook-emulated (injected at next PreToolUse) — weaker than Pi/OMP native `steer`; document the UX difference.

### 3.3 Notes / PKM / Knowledge (SiYuan) — **PARTIAL** (large functional core, external kernel required, several stubs)

The knowledge series (P1–P6, P7-prep, SiYuan surfaces P4.x, W2 knowledge mode) is **already on `main`** via squash PRs (#4, #6, #7, #9–#12 …); the `feat/knowledge-*` and `feat/p4-siyuan-surfaces` branch tips are stale, not pending work. Feature gate: `CRAFT_FEATURE_KNOWLEDGE` (`packages/shared/src/feature-flags.ts`) — **enabled by default**; when off, `KnowledgeSurfacePage` degrades to disabled copy.

**Sub-surface status**

| Sub-surface | Status | Key gap |
|---|---|---|
| Legacy Notes vault (markdown) | FUNCTIONAL (demoted) | Primary nav removed in P4.2; `routes.view.notes()` aliases to knowledge; reachable via "Open legacy notes"/deep links |
| Knowledge home (search/proposals/views) | FUNCTIONAL (needs kernel+token) | — |
| Knowledge navigator tree | **STUB** | No notebook-list RPC; Inbox/Daily/Recent/Databases/Tags/Favorites sections are static-empty by design (comment in `KnowledgeNotebookTree.tsx`) |
| Embedded SiYuan surface / entity tabs | FUNCTIONAL | Needs local SiYuan kernel at `127.0.0.1:6806` |
| KnowledgeAgentPanel CTAs | **STUB** | "Ask about document"/"open session" intentionally disabled (comment: no renderer helper to create session with initial text) |
| SiYuan provider (read + whitelisted writes) | FUNCTIONAL | Write whitelist: `createDocWithMd`, `appendBlock`, `updateBlock`, `setBlockAttrs` only |
| Write-back proposals / diff / audit | FUNCTIONAL | Human approve always required; `safe` mode denies propose/approve/apply |
| Distill / session→knowledge publish | FUNCTIONAL | — |
| Knowledge settings + kernel bootstrap | PARTIAL | `baseUrl` field read-only; no save-connection RPC; auto-start darwin-only default |
| Bundled knowledge skills | **PARTIAL** | Skills declare `alwaysAllow: knowledge.search/read/get_backlinks` + `requiredSources: [siyuan]`, but **no such session tools or marketplace source exist** — the skill contract is unimplemented |
| Saved knowledge views (P5) | FUNCTIONAL | Navigator "Saved views" section still empty stub |
| Knowledge automations (P6) | FUNCTIONAL (config-dependent) | E2E depends on live kernel + enabled automations |
| Notes→SiYuan migration (P4.4) | FUNCTIONAL | Rail `notes` links ignore the migration map |
| Managed kernel (P7) | **NOT_STARTED** | `mode: 'managed'` fail-closed (`CAPABILITY_DISABLED`); G2 legal decision OPEN — SiYuan is **not bundled or downloaded** |

**Implementation files** — contract `packages/core/src/knowledge/*`; SiYuan `packages/core/src/knowledge/providers/siyuan/{client,adapter,mutation-adapter,deep-links}.ts`; bridge `packages/server-core/src/knowledge/bridge-service.ts` + stores, `change-watcher.ts`, `automation-actions.ts`, `publication-service.ts`, `notes-migration.ts`, `siyuan-detect.ts`, `siyuan-bootstrap.ts`, `siyuan-plugins-fs.ts`; RPC `packages/server-core/src/handlers/rpc/knowledge.ts` (~37 channels) + `notes.ts`; renderer `apps/electron/src/renderer/knowledge/*` (`KnowledgeHome`, `KnowledgeNotebookTree`, `KnowledgeInspector`, `KnowledgeDiff`, `KnowledgeAgentPanel`, `siyuan-url.ts`), pages `KnowledgeSurfacePage/KnowledgeEntityPage/NotesPage/settings/KnowledgeSettingsPage`; permissions `packages/shared/src/agent/knowledge-permissions.ts`; automations handler `packages/shared/src/automations/handlers/knowledge-handler.ts`; skills `apps/electron/resources/skills/craft-knowledge/*`.

**UI entry** — activity rail / sidebar `nav:knowledge` → `routes.view.knowledge()`; omnibox `knowledge.openHome`/`knowledge.search`; `@`-mentions in chat composer; session menu "Publish to Knowledge"; Settings → Knowledge.

**Backend/API** — `knowledge:*` RPC (read/search/context/backlinks, proposals lifecycle, views/envelopes, watch, migrate, engine detect/start/status, metrics); `notes:*` CRUD; `siyuan:*` LOCAL_ONLY BrowserView lifecycle; SiYuan kernel HTTP (`/api/search/fullTextSearchBlock`, readonly `/api/query/sql`, `/api/block/*`, `/api/export/exportMdContent`, whitelisted mutations).

**Persistence** — `~/.craft-agent/knowledge/connections.json` (registry, no secrets); workspace `knowledge/{proposals/, audit.jsonl, snapshots/, publications.jsonl, drafts, links, metrics.json}`; `views.json` (v2 with knowledge views); legacy `{workspace}/notes/`; `.craft/notes-migration-map.json`; canonical content lives in SiYuan.

**Auth** — SiYuan `api.token` entered in Settings, stored via CredentialManager as `source_bearer::{workspaceId}::{connectionId}`; soft `conf.json` token fallback for the plugin feed.

**Runtime dependency** — user-installed SiYuan kernel (default `http://127.0.0.1:6806`); Craft can spawn an already-installed binary (`shouldAutoStartSiyuan()`, darwin default on) but never ships one (G2). Connection auto-seeded as `siyuan-local`.

**Test coverage** — 154 tests green in `packages/server-core/src/knowledge` alone (17 files: bridge, mutations, watcher, publication, migration, detect/bootstrap, plugin-fs); plus core provider tests, `views-p5.test.ts`, `knowledge-permissions.test.ts`, renderer `knowledge-home/diff/siyuan-url` tests. Kernel interactions are mocked — no live-kernel CI.

**Missing work** — implement agent-facing `knowledge.*` session tools (unblock the two bundled skills), notebook-list RPC + navigator tree, agent panel CTA wiring, editable connection (baseUrl/save RPC), managed-kernel decision (G2), rail-notes migration-map redirect.

### 3.4 Sources / MCP — **FUNCTIONAL** (registry/config/list VERIFIED via CLI steps 8 and live server log)

**Implementation files** — `packages/shared/src/sources/{types,storage,index,builtin-sources,server-builder,api-tools,credential-manager,token-refresh-manager}.ts`; MCP `packages/shared/src/mcp/{client,mcp-pool,api-source-pool-client,pool-server,validation}.ts`; auth `packages/shared/src/auth/{google,slack,microsoft,generic}-oauth.ts` + `oauth-relay.ts`; server-core `sources/source-index.ts` (SQLite FTS) + `handlers/rpc/{sources,oauth}.ts`; session tools `packages/session-tools-core` (`source_test`, `source_oauth_trigger`, `source_credential_prompt`); standalone `packages/session-mcp-server`.

**UI entry** — sidebar Sources → `SourcesListPanel` / `SourceInfoPage`; add flows via agent-assisted `EditPopover` (`add-source`, `add-source-api`, `add-source-mcp`, `add-source-local`); same UI in webui. Verified live: fresh server seeds 3 sources (`notes` vault + `exa` + `firecrawl`).

**Backend/API** — `sources:get/create/update/delete/saveCredentials/getPermissions/getMcpTools/reindex/search` + push `sources:changed`; `oauth:start/complete/cancel/revoke`; webui `/api/oauth/callback` (wired in `packages/server/src/index.ts`).

**Persistence** — `~/.craft-agent/workspaces/{id}/sources/{slug}/{config.json,guide.md,permissions.json,icon}`; credentials in `credentials.enc` (AES-256-GCM, machine-ID PBKDF2); local-source FTS index at `{workspace}/.craft/source-index.sqlite`.

**Auth** — OAuth (Google per-source or env client IDs; Slack/Microsoft env-only client IDs — packaged OAuth **requires env at build/run**), bearer/basic/header/multi-header, renew-endpoint refresh; webui OAuth uses the Craft-branded relay `https://agents.craft.do/auth/callback`.

**Runtime dependency** — stdio MCP servers need host runtimes (`npx`, `node`, `uvx`, …) — not toolchain-managed; workspace toggle `localMcpServers.enabled` gates stdio entirely; HTTP MCP needs outbound network.

**Backend parity (how source tools reach agents)** — one shared path: `SessionManager.buildServersFromSources` → `McpClientPool.sync` → per-backend advertisement: Claude = per-source SDK MCP servers; Pi = `register_tools` proxy defs; OMP = `set_host_tools` via shared `buildSessionToolDefs({includePoolProxyDefs:true})` with idle refresh. **Parity is real in code**; only docs lag (§4). Local folder sources bypass the pool by design (guide + file tools + FTS).

**Test coverage** — strong on config/credentials/refresh (`source-config-validation`, `credential-manager-*`, `token-refresh-manager`, `multi-header-*`, `mcp-pool.test.ts` incl. token-refresh reconnect, `source-index.test.ts`, `source-test.test.ts`, webui `oauth-callback.test.ts`); **no OMP host-tool proxy regression test**; no stdio spawn e2e.

**Status** — FUNCTIONAL. CLI validation exercised `sources:get` live (3 sources); large-response guard (`guardLargeResult` → `long_responses/` + mini-model summary) wired for pool + API tools with unit coverage.

**Missing work**
1. **SSE transport is not actually implemented** — `CraftMcpClient` only has `StreamableHTTPClientTransport`; declared `transport:'sse'` is coerced to HTTP and fails against pure legacy SSE servers (`mcp/validation.ts` admits this). Implement or demote SSE.
2. `sources:getMcpTools` stdio path skips `resolveStdioConfig` platform/var expansion (uses raw config).
3. Document/release-gate OAuth env vars (`GOOGLE_*`, `SLACK_*`, `MICROSOFT_*`); replace Craft-branded OAuth relay if leaving craft.do infra.
4. Decide the fate of `session-mcp-server` / `McpPoolServer` / `bridge-mcp-server`: with anthropic/pi/omp all `needsHttpPoolServer:false`, the standalone stdio server is legacy (Codex-era) and untested as a binary.
5. Env blocklist for stdio MCP is a short fixed list duplicated in `session-tools-core`.

### 3.5 Secrets / Infisical / Toolchain / Runtime-context marketplace — **VERIFIED (toolchain live) / NOT_STARTED (Infisical as secrets backend)**

**Infisical verdict:** Infisical exists **only as an opt-in downloadable CLI** in the toolchain manifest (`packages/shared/src/toolchain/manifest-data.ts`, v0.43.120, sha256-pinned GitHub release binaries, `tier: 'opt-in'`). There is **no Infisical secrets backend**: no SDK, no login/project binding, no secret sync, no env injection from Infisical at agent spawn. If the product intends Infisical-backed secrets, that surface is NOT_STARTED. The incumbent secrets mechanism is `packages/shared/src/credentials/` (`credentials.enc`, AES-256-GCM, PBKDF2 from machine UUID; the alternative `EnvironmentBackend` is disabled stub).

**Toolchain download manager — VERIFIED live.** On first server boot, `ensureAll({background:true})` downloaded and installed the full default-on set into `~/.craft-agent/toolchain/` (observed on this VM: bun, node, python(uv), uv, ffmpeg, pandoc, gh, jq, yq, just, fzf, mise, worktrunk, gbrain, omp, opencode-ai, oh-my-codex, oh-my-claude-sisyphus, skills), and `OmpAgent` immediately resolved the freshly installed `omp` binary. Suite `packages/shared/src/toolchain` 57 tests green.

- **Files:** `toolchain/{types,manifest,manifest-data,manager,downloader,installer,resolver,status,exec,npm-locks,git-locks,pip-locks}.ts`, `toolchain-runtime.ts`, `scripts/toolchain-locks.ts`; spec `docs/superpowers/specs/2026-08-06-toolchain-download-manager-design.md`.
- **UI entry:** Settings → Runtime (`RuntimeSettingsPage.tsx`, absorbed old toolchain page) with per-tool enable/disable + status; `ToolchainStatusBanner` in app shell.
- **Backend/API:** `toolchain:status/statusChanged/update/getDisabled/setDisabled` (LOCAL_ONLY).
- **Persistence:** `~/.craft-agent/toolchain/` + `state.json`; `config.json` `toolchain.disabled`.
- **Auth:** none (pinned public URLs, sha256 fail-closed; npm kinds carry embedded lockfiles).
- **Runtime dependency:** network; installs are wave-ordered via `dependsOn` (omp depends on toolchain bun+node).
- **Missing:** `oh-my-openagent` blocked by an unpublished upstream transitive dep (documented in manifest); PRD errata (infisical opt-in, gstack/hermes exclusions) is accurate but the PRD header still says draft.

**Runtime-context marketplace — FUNCTIONAL** (branch `feat/runtime-context-finish` is fully merged: 0 ahead / 154 behind `main`).
- **Files:** `packages/shared/src/marketplace/{catalog,catalog-signing,installer,lock,stats}.ts`; bundled signed catalog `apps/electron/resources/marketplace/{catalog.json,.sha256,.sig}`; RPC `handlers/rpc/marketplace.ts`; UI `MarketplaceSettingsPage.tsx`.
- **Auth/integrity:** ed25519-signed catalog + sha256 sidecar + per-item content-SHA pins; installs restricted to curated GitHub pins; skills install to `~/.agents/skills`.
- **Persistence:** `~/.craft-agent/marketplace/{catalog.cache.json,stats-cache.json,lock.json}`.
- **Tests:** catalog/signing/installer/lock/stats suites green.
- **Missing:** PRD/plan docs not rewritten to "shipped" state; no Infisical-as-secret-pack (consistent with the verdict above).

**Env/secrets injection at spawn — FUNCTIONAL:** `runtime.envOverrides` (Settings → Runtime editor) + per-session `envOverrides` merged into every agent subprocess env (`omp-agent.ts` spawn, `options.ts:buildClaudeSubprocessEnv`, Pi runtime), plus `withToolchainPathPrefix`. Covered by `env-overrides.test.ts`. No secret-manager pipeline beyond this.

**Context docs + bundled skills (adjacent runtime-context surfaces) — FUNCTIONAL and observed live at boot:** `soul.md`/`rules.md` seeded from templates (`packages/shared/src/context-docs/`, Settings → Context, `contextDocs:*` RPC) and injected into system prompts incl. OMP `--append-system-prompt` (observed in the live spawn args); 5 bundled skill packs synced (`craft-knowledge`, `mattpocock-skills` 35, `superpowers` 14, `vercel-agent-skills` 9, `vercel-next-skills` 4) with `bundledSkills:setDisabled` opt-out.

### 3.6 Session collections & views — **FUNCTIONAL** (filters persistence PARTIAL; generic engine NOT_STARTED)

"Collection" = the Linear-style ops surface over workspace sessions (modes `list|board|table`, shared `CollectionFilters` + `CollectionDisplay`, fields `rank`/`priority`/`dueDate`, multi-select/bulk, LexoRank ordering). Spec: `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md` (FR-1…FR-52); plan marks slices B0–B6 done, corroborated by code.

**Implementation files** — shared model `packages/shared/src/sessions/{collection-types,collection-query,collection,collection-display-storage,lexorank}.ts`; DTO fields + bulk ops in `packages/shared/src/protocol/dto.ts`; server `packages/server-core/src/{handlers/rpc/collection.ts, handlers/rpc/sessions.ts (bulkUpdate, max 200, rank forbidden), sessions/SessionManager.ts (setPriority/setDueDate/setRank/reorderRank, rank backfill), sessions/bulk-labels.ts}`; renderer atoms `collection-display.ts` / `collection-filters.ts`; views: list `SessionList.tsx`/`SessionItem.tsx` + `CollectionViewChrome`, table `session-table/SessionTableHost.tsx` (+ virtualization/drag/due helpers), board `kanban/KanbanBoardContainer.tsx` (+ `priority-groups.ts`), bulk `collection/CollectionBulkBar.tsx`, multi-select `hooks/useMultiSelect.ts`; branch families `utils/session-families.ts` (+ persisted `branchFromSessionId`).

**UI entry** — Sessions navigator; view toggle (`CollectionViewToggle`) → routes `view.board()` / `view.table()`; filter chips + Display popover; checkboxes/Shift-range for multi-select; bulk bar on selection. Branch families render automatically under parents in the list.

**Backend/API** — `collection:getDisplay/setDisplay` + `collection:changed`; `sessions:command` (`setPriority`, `setDueDate`, `setRank`, `reorderRank`, status/flag); `sessions:bulkUpdate` + `sessions:bulkChanged`.

**Persistence** — display: workspace `collection/display.json`; fields on session JSONL headers; **filters: in-memory jotai only (not persisted — FR-11 half-done)**; list grouping still legacy `localStorage` `view-filters`; smart views in `views.json` (separate Filtrex system, ANDed with chips per FR-9).

**Auth** — n/a (workspace-local; webui reaches it through the same RPC).

**Runtime dependency** — Electron renderer (webui inherits via the adapter); no external services.

**Test coverage** — `collection-query/collection-fields/collection-ec/collection-display-storage/lexorank` shared suites; server `session-collection-fields`, `sessions-bulk`, `session-bulk`, `bulk-labels`; renderer `table-virtualization/table-drag/rank-drag/table-due/table-empty-groups`, `collection-reorder`, `useMultiSelect` (38 cases), `session-families`, `priority-groups`. All green in §2 runs.

**Missing work**
1. FR-11: persist `CollectionFilters` per navigator key (currently reset on workspace switch).
2. FR-45: list-view LexoRank drag not wired (table/board only).
3. List grouping uses legacy `ChatGroupingMode`, not `CollectionDisplay.groupBy`.
4. Duplicated bulk UI in list mode (legacy `MultiSelectPanel` + new `CollectionBulkBar` both mount).
5. K-09 generic collection engine (`packages/ui-collections`) — NOT_STARTED (draft spec only, `docs/specs/2026-08-07-siyuan-integration/09-collection-view-engine.md`).
6. Deferred per PRD: column resize/reorder persistence, CSV export; stale "B0 placeholder host" comment in `MainContentPanel.tsx`.

### 3.7 Remote sessions / cloud surfaces

#### 3.7.1 Headless server (`packages/server` + `server-core`) — **VERIFIED**
Bun WS-RPC server (default `127.0.0.1:9100`), bearer-token handshake (min-length+entropy checks, `--generate-token`), TLS via `CRAFT_RPC_TLS_*` with a hard refusal to bind non-localhost without TLS, embedded webui HTTP handler on the same port, optional health port, messaging bootstrap, VPS browser panes via `agent-browser`, `Dockerfile.server` (multi-stage, exposes 9100). Files: `packages/server/src/index.ts`, `server-core/src/bootstrap/headless-start.ts`, `transport/server.ts`, `handlers/rpc/*`. Persistence: `~/.craft-agent` (config, credentials, workspaces, sessions) + config-dir process lock. Tests: `packages/server/src/__tests__/smoke.test.ts` + broad server-core suites. **Verified live in this audit** (boot, seeding, RPC handshake, CLI steps 1–10). Missing: `Dockerfile.server` builds only the WhatsApp worker — Discord worker dist is absent from the container image.

#### 3.7.2 Web UI (`apps/webui`) — **VERIFIED (renders, auth, settings) / core chat blocked by §3.1 hang**
Thin wrapper: fetches `/api/config`, opens WS with cookie auth, sets `window.electronAPI` via `adapter/web-api.ts` (`CHANNEL_MAP` + LOCAL_ONLY no-op overrides), then lazy-loads the **full Electron renderer App** — so all Rox surfaces (knowledge, collections, marketplace, runtime settings…) exist in the web surface. Auth: argon2id-verified password (`CRAFT_WEBUI_PASSWORD` or server token) → HS256 JWT cookie (24 h), rate-limited `/api/auth`.

Browser verification results (Chromium, this audit):
- Login redirect, auth, and SPA load: **работает**; login page is English/Craft-branded ("Craft Agents", "Enter your server token to continue") while the app itself is Russian-first — branding/i18n inconsistency.
- Main UI is full desktop parity: sidebar (Сессии with status workflow, Метки, Проекты, Память, Источники, Навыки, База знаний, Автоматизация, Настройки), model picker showing "Kimi K3", onboarding "rules" modal.
- Settings pages render without blocking errors (Application, AI incl. rox-kimi connection, Sources with 3 seeded sources; 15+ settings categories visible incl. Runtime/Marketplace/Knowledge/Extensions/Organizations/Messengers/Cloud Runs).
- **Chat: user message accepted, then indefinite processing** (status phrases cycling past 5–6 min, no response, no error surfaced; console repeats `[StaleSecurity] Session … stuck in processing for 120s+ — refreshing`). Same root cause as §3.1 (OMP without credentials + pre-ready-exit hang) — independently confirms both the hang and the missing user-facing error.
- Console errors: `manifest.json` fetch 401 (PWA manifest behind auth), `No handler for notification:getEnabled` from `AppSettingsPage.tsx:144` (web-adapter parity gap for a desktop-only channel).

Missing work: surface turn errors in UI; fix the two console errors (serve manifest unauthenticated; stub `notification:getEnabled` in the web adapter); rebrand `login.html`; remove dead `CRAFT_WEBUI_PORT`; decide whether the Rox Connect gate should exist in webui (its channels are Electron LOCAL_ONLY today).

#### 3.7.3 CLI (`apps/cli`) — **VERIFIED**
Commands (`ping/health/versions/workspaces/sessions/connections/sources/session */send/cancel/invoke/listen/run/--validate-server`) over the same WS RPC; self-contained `run` spawns its own server. Tests: `commands/client/run.test.ts`. Verified live against the running server (steps 1–10 pass; step 11 fails on the OMP credential gap). Doc drift: `docs/cli.md` says "21-step" validation; `getValidateSteps()` has ~40 (labels, branching, automations, webhooks, MCP sources, skills).

#### 3.7.4 Viewer / session share (`apps/viewer` + agents.rox.one) — **VERIFIED (prod live) with a security gap**
Cloudflare Pages app + Pages Functions + R2 (`craft-session-shares`, 25 MB cap): `POST /s/api` (create), `GET/PUT/DELETE /s/api/:id`. Desktop "Share Online" posts full session JSON from `SessionManager` to `VIEWER_URL = 'https://agents.rox.one'` (`packages/shared/src/branding.ts`). Live probes: root 200, share API responds correctly to unknown ids. **Gap: the share API is completely unauthenticated (CORS `*`)** — anyone can POST uploads and PUT/DELETE by id; id secrecy is the only ACL. No viewer API tests. Viewer header still titles "Craft Agent".

#### 3.7.5 `apps/cloud-gateway` — **FUNCTIONAL** (code-complete CF Worker + Durable Object + Containers; unverifiable here without secrets)
Endpoints `/healthz`, `/runs*` (create/status/events/ws/artifacts/delete/share/revoke) behind a shared bearer `CLOUD_RUNS_TOKEN`; DO SQLite workspace; container images (`Dockerfile`, shelved `Dockerfile.omp` — the F21 omp-runner spike failed on lazy-install wall-clock and is parked); LLM via `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` (docs point at `api.rox.one`). Missing: craft-JWT auth (v1 uses one shared token), F17 nightly CI secrets, F18 E2B provider.

#### 3.7.6 `apps/modal-gateway` — **FUNCTIONAL** (Modal.com mirror of the same HTTP contract)
Single `app.py`: Modal ASGI app `craft-cloud-runs`, per-subtask `modal.Sandbox` with an embedded Python research runner, `modal.Dict` state, `modal.Volume` artifacts, secret `craft-cloud-runs`. No Python unit tests in-tree; conformance claimed live in PRD. Runner feature parity with the CF `runner.mjs` needs maintenance.

#### 3.7.7 `packages/cloud-runner` + Cloud Runs — **FUNCTIONAL (local provider) / PARTIAL (cloud legs unverified here)**
Provider contract + `LocalSubprocessProvider` (offline, stub runner), `CloudflareComputerProvider`, `ModalProvider`, research packs, conformance suite, unit tests. App integration: `cloudRuns:*` RPC family (18 channels incl. schedules, artifacts, share, import, aggregate) + `CloudRunsSettingsPage` + composer chip. Secrets in `<configDir>/cloud-runs.env`. Docs (`docs/cloud-runs-prd.md`, `docs/cloud-runs-features-spec.md`): G1–G4 done, F1–F16/F19/F20/F22 done, F17/F18/F21 open — consistent with code.

#### 3.7.8 Rox Cloud Connect — **FUNCTIONAL on desktop only; blocked on private website repo**
Device flow (`packages/shared/src/auth/rox-cloud.ts`): `POST {ROX_AUTH_BASE_URL}/api/auth/device/start` → user approves at rox.one → poll → token stored as `service_oauth::global::rox-cloud`. Electron-only (`onboarding:startRoxConnect|getRoxCloudState|clearRoxCloud` are LOCAL_ONLY; not registered headless/webui/iOS). `ROX_CLOUD_REQUIRED` defaults true → onboarding gate. `fetchRoxBalance` (`GET /api/me/balance`) implemented but **no UI caller**. Depends entirely on `rox-one/rox-one-website` (private, unauditable from here): device APIs, better-auth, cabinet, Neon. Tests cover URL/required-flag parsing + wizard render only; no device-flow e2e. clientId is still `'craft-agents-desktop'`.

#### 3.7.9 Messaging gateways — **FUNCTIONAL** (Telegram/Lark/WeChat in-process; WhatsApp/Discord via Node workers)
`packages/messaging-gateway` (bootstrap/registry/gateway/router/pairing/binding + adapters), workers `messaging-whatsapp-worker` (Baileys) and `messaging-discord-worker` (discord.js) spawned as Node subprocesses (`CRAFT_MESSAGING_NODE_BIN`). RPC `messaging:*` (config, per-platform connect/test, pairing codes, access control) + pushes (`wa:qr`, `platformStatus`). Persistence per workspace `messaging/`. Extensive unit tests. Risks/missing: WeChat adapter is a vendored unofficial iLink personal-bot surface (ban/API risk); Docker image lacks the Discord worker build; package description stale ("Telegram & WhatsApp").

#### 3.7.10 iOS app (`apps/ios`) — **PARTIAL**
Native SwiftUI client (not RN): `CraftAgentKit` SwiftPM (WS RPC transport/codec/models) + `CraftAgentsApp` (onboarding with server URL+token, session list/chat/permissions, Keychain token, SwiftData offline cache). Talks the same WS RPC subset; no Rox Connect, no push, no sources management (deferred by design doc). Unit tests exist for kit and view models; requires macOS+Xcode 16+XcodeGen — not buildable/verifiable in this Linux audit. Missing: APNs, sources UI, product identity (still Craft-named), CI signing.

### 3.8 Artifact / design surfaces — **FUNCTIONAL** (chat artifacts) / **STUB** (`dashboard.html`) / **NOT_STARTED** (design canvas)

Terminology note: in this codebase "artifact" mostly means build/deploy tarballs (`apps/electron/src/main/ssh-tunnel/server-artifact.ts`) and cloud-run artifacts — there is **no first-class "Artifact" chat entity**. The de-facto artifact surfaces are rich markdown blocks and overlays.

| Sub-surface | Status | Facts |
|---|---|---|
| Chat HTML/Mermaid/Diff blocks | FUNCTIONAL | `packages/ui/src/components/markdown/Markdown.tsx` routes fences `html-preview` → sandboxed-iframe `MarkdownHtmlBlock`, `mermaid` → `MarkdownMermaidBlock` (`beautiful-mermaid`), ```diff → `MarkdownDiffBlock`; fullscreen `HTMLPreviewOverlay` / `MermaidPreviewOverlay` / `MultiDiffPreviewOverlay`; agent-side `mermaid-validate` session tool. Tests: rich-block parity, tiptap-mermaid helpers, mermaid-validate. Content persists only inside session transcripts. |
| Mindmap | FUNCTIONAL | `packages/core/src/mindmap/` (derive from session/note/knowledge, `hash.ts` stability — commit `9f11bfd9`, pins, layout, enrich) + renderer `mindmap/MindMapHost.tsx` SVG engine. Entries: ChatPage (`sessionView === 'mindmap'`), NotesPage, KnowledgeEntityPage. RPC `mindmap:enrich/pinLoad/pinSave/pinClear`; pins in workspace FS + localStorage. Well-tested (hash/pin/layout/enrich/derive + pin-store). |
| File diff viewers | FUNCTIONAL | `ShikiDiffViewer`/`UnifiedDiffViewer` (`@pierre/diffs` + shiki), multi-file overlay for Edit/Write turns; knowledge write-back has its own `diff/{proposalId}` surface (§3.3). |
| Theme system / design tokens | FUNCTIONAL | `packages/shared/src/config/theme.ts` (`ThemeOverrides`, `themeToCSS`, scenic mode) + `ThemeContext`, 15 bundled presets (`apps/electron/resources/themes/*.json`), app theme `~/.craft-agent/theme.json` + workspace overrides, Appearance settings. Missing: unified-shell spec S-05 "themes as extension runtime" not implemented; paths still `craft-agent`. |
| `packages/ui` | FUNCTIONAL | Platform-agnostic component library (SessionViewer, TurnCard, overlays incl. PDF/JSON/Code/Image/Terminal/DataTable, code-viewer, primitives) consumed by electron + viewer + webui via `PlatformProvider`. Still named/branded `@craft-agent/ui`. |
| `dashboard.html` (repo root) | **STUB / orphan** | Static Russian "Панель аналитики" (repo issues/PRs/labels/authors from an embedded snapshot of `.github-archive`, 594 issues / 267 PRs). Zero references anywhere; not built, routed, or regenerated. Decide: wire in, move to docs, or delete. Still Craft-branded. |
| Design mode / canvas / drawing | **NOT_STARTED** | No excalidraw/tldraw/whiteboard/canvas surface exists; closest interactive visuals are mindmap SVG, mermaid, and HTML preview. |

### 3.9 White-label / Rox branding / unified shell — **PARTIAL**

**Branding status: split-brain.** Rox-owned: cloud identity (Rox Connect device flow, `ROX_AUTH_BASE_URL`/`ROX_CLOUD_REQUIRED`/`ROX_API_KEY` env family), default LLM `rox-kimi` via `api.rox.one`, viewer at `agents.rox.one` (`VIEWER_URL` in `packages/shared/src/branding.ts`), Russian-first localization. Still Craft-owned (shipping identity): `electron-builder.yml` `appId: com.lukilabs.craft-agent` + `productName: Craft Agents`, deep-link scheme `craftagents://`, config dir `~/.craft-agent`, npm scope `@craft-agent/*` + root package name `craft-agent`, `CRAFT_*` env/flag namespace, ASCII `CRAFT_LOGO`, README/TRADEMARK, webui `login.html`, viewer header title, OAuth relay `agents.craft.do`, Rox Connect clientId `'craft-agents-desktop'`. Rough counts: ~92 files still say "Craft Agent(s)" vs ~26 mentioning Rox. `RoxConnectStep.tsx` additionally hardcodes English strings outside `t()` — violating the repo's own i18n rule.

**i18n — FUNCTIONAL and Russian-first:** `fallbackLng: ['ru','en']`, detector reads localStorage only, 10 locales in `LOCALE_REGISTRY`, parity/sort/coverage lint gates (90 i18n tests green). Browser check confirmed the running product is Russian-first while the login page is English — localization is ahead of the brand rename.

**Unified shell (docs/specs/2026-08-07-unified-shell, S-00…S-10, waves W1–W6):** all waves are **merged to `main`** (W1 `bf82a197`#5, W3 omnibox `e2db510b`#13, W4 identity `8675f7fc`#14, W5 extensions `393f3c57`#16, W6 bridge `48ed532b`#17 + plugin feed #19/#20); the `feat/shell-*` branches are stale tips, not pending work.

| Shell sub-surface | Status | Facts |
|---|---|---|
| W1 shell scaffold (activity rail, surface tabs, inspector, layout snapshot) | **PARTIAL — behind a default-OFF flag** | `featureUnifiedShellAtom` defaults `false` (`atoms/unified-shell.ts`); registries in `packages/core/src/platform/{surfaces,panels,commands,context-keys,identity}`; renderer `ActivityRail/SurfaceTabs/InspectorHost/layout-snapshot/surface-tab-model`; **no `PanelHost`** yet; URL `?panels=` remains layout source of truth. Users see the classic AppShell. |
| W3 Omnibox | FUNCTIONAL | `<OmniboxHost />` mounted unconditionally in `App.tsx` (⌘K, incl. from embedded BrowserViews via `omnibox:open` IPC); command/resource providers + plugin command projection; tests for helpers/providers/logic/ids. Missing: full S-04 prefix set, federated SiYuan search depth. |
| W4 Identity Center | FUNCTIONAL | `identity:*` RPC (getState/updateProfile/connect/disconnect/refreshStatus + changed), `AccountMenu` + `AccountsSettingsPage`; secrets only via CredentialManager. Gap: Rox Connect gate remains a parallel auth surface — spec's "no two account switchers" not yet true. |
| W5 Extension Center | FUNCTIONAL | `ExtensionsSettingsPage` (catalog/installed/updates/permissions), `extensions:*` RPC, `extension-host-manager.ts` sandbox (utilityProcess, capability broker, CSP/URL allowlists). Gap: theme runtime type empty; spec'd `ExtensionCenter.tsx` platform surface replaced by a settings page. |
| W6 Plugin bridge + SiYuan plugin feed | FUNCTIONAL (L0–L1) | `plugin-bridge.ts` RPC (`LIST_PLUGINS/GET_PROJECTIONS/SET_ENABLED/OPEN_COMPAT/INSTALL_BAZAAR/UNINSTALL_BAZAAR`), fixture → kernel → filesystem feed (`siyuan-plugins-fs.ts`), enablement in extension state store (never rewrites SiYuan `petals.json`), omnibox command projection. Gap: deeper L2/L3 plugin projections, dock→panel mapping (needs PanelHost). |

**Missing work (white-label track)**
1. Finish the rename: appId/productName/deep-link/config-dir/npm-scope/env-prefix migration plan (config-dir + deep-link changes need explicit migration code).
2. Rebrand user-visible leftovers: webui login, viewer header, OAuth relay host, `RoxConnectStep` strings → `t()`.
3. Decide the unified-shell default (flag ON + PanelHost + status bar) or descope S-01 geometry.
4. Collapse Rox Connect into Identity Center per S-07.

## 4. OMP documentation vs. actual implementation

The repo has three OMP docs. There is **no `OmpEngine` symbol anywhere in the codebase** — the implementation class is `OmpAgent` (`packages/shared/src/agent/omp-agent.ts`); if external materials refer to an "OmpEngine", they describe this class. Claim-by-claim comparison:

### 4.1 `docs/omp-rpc-notes.md` (protocol contract) vs code and live binary

| Doc claim | Implementation / live probe | Verdict |
|---|---|---|
| Ready frame `{protocolVersion:1, supportedProtocolVersions:[1,2], maxFrameBytes:1048576, maxReassembledFrameBytes:67108864}` | Live probe against toolchain-installed omp **17.2.10** returned byte-identical fields | ✅ accurate (doc pinned to 17.2.9; 17.2.10 unchanged) |
| "Host MUST answer every `extension_ui_request`" (turn-stall blocker) | `handleExtensionUiRequest` answers everything: auto-answers `setWidget`/`cancel`, auto-approves under yolo, proxies the rest to craft permissions; `abort`/`destroy`/subprocess-exit paths deny all pending | ✅ implemented |
| `set_model` takes `{provider, modelId}` (NOT `{model}`) | `applyOmpModel()` sends exactly `{provider, modelId}` after fuzzy match over `get_available_models` | ✅ |
| `branch {entryId}` requires a USER entry id; cut at `parentId`; tail fork = transcript copy + `switch_session` | `applyOmpBranchHandshake()` implements both paths precisely (finds first user entry after anchor, else copies transcript) | ✅ |
| Respawn with same `--session-dir` does NOT auto-resume; `switch_session` required | Craft never resumes from the OMP store by design (craft owns history); `switch_session` used only for branching | ✅ consistent |
| Print mode `omp -p` for mini-completions | `runOneShot()` spawns `omp -p` (with explicit stdin end — Bun `execFile` stdio caveat documented in code) | ✅ |
| Event order (`agent_start → turn_start → message_* → tool_execution_* → agent_end`) | `handleLine()` switch covers all listed events; `tool_execution_update` intentionally dropped (no craft streaming-tool-output event) | ✅ (with a known omission: partial tool output not surfaced) |
| `set_env`??/`stop`?? marked unverified | Not used by the implementation | ✅ honest |

### 4.2 `docs/omp-integration-gap.md` + `docs/omp-v2-prd.md` (claims "G1–G4 complete, verified live") vs code

| Claim | Reality on `main` | Verdict |
|---|---|---|
| G1 MCP source proxies bridged via shared `buildSessionToolDefs` | `registerHostTools()` uses `buildSessionToolDefs({includePoolProxyDefs:true})`; proxy calls dispatch `mcpPool.callTool` before the session registry; idle-only re-registration (`refreshHostToolsFromPool`) on source activation, matching the PRD's race mitigation | ✅ implemented |
| G2 thinking stream (`thinking_delta`/`thinking_complete`) end-to-end incl. «Рассуждение» card | Full chain present: OmpAgent mapping → core types → protocol DTO → SessionManager → renderer handler → `ThinkingCard` | ✅ implemented |
| G3 branching via anchors + fork handshake | `omp_turn_anchor` capture at `agent_end` (deferred past transcript flush; race documented in code), sidecar persistence, `ensureBranchReady()` preflight, mid-history and tail-fork strategies, loud failure for legacy sessions | ✅ implemented |
| G4 skills sync (discovery + badge + export + @-mention activation) | `omp-discovery.ts`, `skills:importOmp` channel, `SkillsListPanel` OMP group, `extractSkillPaths` merge (observed live in server logs: skill registry scan on OMP session start) | ✅ implemented |
| PRD acceptance: "tsc 0 errors, bun test 0 regressions" | Reproduced in this audit (shared/server-core/electron tsc clean; agent suite 867 pass) | ✅ |
| PRD acceptance C–G "live checks" | Not reproducible without gateway credentials; **no automated tests encode them** | ⚠️ unverifiable here; test debt |
| Gap doc "Остаток до полного" list (items 1–5) | Stale: items 1–4 (proxies, thinking, branching, skills sync) are implemented on `main` and even marked "Закрыто в v2" earlier in the same file — the leftover list was not updated | ⚠️ doc drift within one file |
| AGENTS.md: "MCP source-proxy tools **not** bridged (v1, осознанно)" | Superseded by v2 code; AGENTS.md (repeated verbatim in both repos) describes v1 | ⚠️ doc drift |
| `omp-agent.ts` header: "source proxies NOT bridged in v1" | Contradicted by the same file's implementation | ⚠️ doc drift |

### 4.3 Behavior implemented but **undocumented** in the OMP docs
- Permission-mode flip (`allow-all` boundary) kills the subprocess and respawns on next chat (documented in AGENTS.md, absent from rpc-notes).
- Craft context prompt content (`OMP_CRAFT_CONTEXT_PROMPT`) now also carries preferences, project context, context-docs (soul.md/rules.md) and memory blocks — the docs only mention the briefing.
- Host-tool permission gate in ask/safe with the 120 s fail-safe deny (AGENTS.md mentions it; rpc-notes/PRD do not).
- `host_tool_cancel` handling.

## 5. Craft Agents (upstream) vs Rox — deltas and reusable code

Baseline: upstream `craft-ai-agents/craft-agents-oss` v0.11.4 (`50ffa14`) vs `rox-one/rox-one` main (v0.11.5). Upstream **already ships** the CLI, Electron app, viewer, webui, headless server (`packages/server`/`server-core`), messaging gateway + WhatsApp worker, session-mcp-server, pi-agent-server, session-tools-core, ui — those surfaces are inherited, and Rox's value-add is on top of them.

### 5.1 Rox-only additions (not in upstream v0.11.4)

- **Apps:** `apps/cloud-gateway`, `apps/modal-gateway`, `apps/ios`.
- **Packages:** `packages/cloud-runner`, `packages/messaging-discord-worker`.
- **`packages/shared/src` new subsystems:** `toolchain/` (+`toolchain-runtime.ts`), `knowledge/`, `memory/`, `context-docs/`, `extensions/`, `marketplace/`, `kanban/`, `gamification/`, `orgs/`, `os/`, `skills/omp-discovery.ts`, `agent/omp-agent.ts` + `agent/session-tool-defs.ts` + `agent/knowledge-permissions.ts`, `auth/rox-cloud.ts`, `automations/knowledge-handler.ts` + `automations/default-seeds.ts`, `config/kimi-coding.ts`.
- **`packages/server-core` new RPC handler families** (each ≈ a product surface): `browser-pane`, `bundled-skills`, `cloud-runs`, `collection`, `context-docs`, `extensions`, `gamification`, `identity`, `kanban`, `knowledge`, `marketplace`, `memory*` (io/insights/fts/conflicts), `mindmap`, `notes`, `orgs`, `plugin-bridge`, `skills-pending`, `toolchain`; plus `sessions/bulk-labels`, session-collection fields, provenance, memory modes.
- **Electron renderer pages** only in Rox: `NotesPage`, `KnowledgeSurfacePage`, `KnowledgeEntityPage`, `BrowserPanelPage`, `ExtensionSurfacePage`, settings `Accounts/CloudRuns/Context/Extensions/Knowledge/Marketplace/Organizations/Runtime`.
- **i18n:** 10 locales incl. `ru` default (`fallbackLng: ['ru','en']`) vs upstream's smaller set; +3 locale files.
- **Branding:** `packages/shared/src/branding.ts` differs (see §3.9).

### 5.2 Upstream features Rox already reuses wholesale (keep tracking upstream)
- The whole remote-session stack (`server`, `server-core` transport/webui, CLI, webui adapter) — Rox extends handlers but the transport/auth core is upstream code; upstream fixes should be merged regularly (the `integration/2026-08-06-pr-bundle` branch and 80+ `feature/pr-NNN-*` branches show this porting pipeline mid-flight; several `feature/pr-*` branches remain unmerged to `main`).
- Sources/MCP system, credentials store, permission modes, automations engine, session persistence/labels — upstream-derived with Rox extensions on top.

### 5.3 Reusable from upstream not yet in Rox (reverse gaps)
- `packages/shared/src/mcp/proxy-tool-name.ts` + test — upstream extracted the sanitized proxy-name builder (issue #864) into a single module; Rox has an equivalent inline implementation in `mcp-pool.ts` (`sanitizeToolNamePart`), but the repo's own `packages/shared/CLAUDE.md` documents the upstream file layout — either port the module or fix the doc.
- Upstream `main` beyond the bundle cut (post-#1005 PRs) — the porting pipeline needs a refresh pass; `feature/pr-*` branches that are already on `main` should be pruned.

### 5.4 Donor (`agisota/craft-agents-oss`) residual material
`main` is identical to the destination. Of the 7 donor-only branches, `fix/sessions-fr38-fr47` is fully merged (0 commits ahead). The other 6 carry small real deltas vs `main` (measured with `git diff main...branch`):

| Donor branch | Delta vs main | Content |
|---|---|---|
| `feat/shell-ext-activate2` | 10 files, +266 | Extension Host `list-commands` RPC (sandbox command export read) — overlaps the unified-shell series |
| `fix/electron-renderer-node-shims` | 6 files, +256/−17 | Renderer node stubs + packaged SDK/ripgrep extras |
| `fix/renderer-node-polyfills` | 8 files, +299/−23 | Browser-safe renderer bundle, unsigned local DMG, SDK import stubs |
| `fix/renderer-review-followup` | 3 files, +117/−19 | Mindmap hash preservation refinement (main has an earlier variant, `9f11bfd9`) |
| `fix/rox-connect-onboarding-followup` | 4 files, +127 | Rox Connect local render/route + device-flow state tests (main has earlier `44e32db3`) |
| `fix/sessions-list-shared-filters` | 4 files, +117/−1304 | Post-review cleanup of shared collection filters |

These look like rebased/superseded follow-ups to commits already on `main` — each needs a one-time triage (port or discard) before the donor repo is archived.

## 6. Cross-cutting gaps, risks, and doc drift

### 6.1 Functional & security risks
1. **Fresh-install first turn fails silently (OMP hang)** — §3.1. The default seeded connection targets a runtime whose credentials (`~/.omp/agent/config.yml`) no repo component provisions, and the failure path hangs the turn instead of erroring. Reproduced twice: CLI validation step 11 (60 s timeout) and the browser UI (6+ min of cycling status text, `[StaleSecurity] Session … stuck in processing` console warnings, stale-guard "recovery" that never recovers). This blocks the primary "install → chat" happy path everywhere the Rox gateway config isn't pre-provisioned.
2. **Viewer share API unauthenticated** — `POST/PUT/DELETE https://agents.rox.one/s/api[...]` have no auth and CORS `*` (§3.7.4); id secrecy is the only ACL on a live production bucket.
3. **Private-website coupling** — Rox Connect (`ROX_CLOUD_REQUIRED` default true per `docs/ROX_CLOUD_CONNECT.md`) gates the desktop app on `rox.one` device APIs owned by the inaccessible `rox-one-website` repo; no mock/dev server exists in this repo (only `ROX_CLOUD_REQUIRED=0` bypass). `fetchRoxBalance` has no UI caller yet.
4. **WeChat adapter risk** — vendored unofficial iLink personal-account bot; account-ban and API-stability exposure (§3.7.9).
5. **Branch/port pipeline debt** — 80+ `feature/pr-NNN-*` port branches plus stale `feat/knowledge-*`/`feat/shell-*` tips whose content is already merged; donor branches superseded-but-untriaged (§5.4). Prune to keep the branch list meaningful.

### 6.2 Documentation drift found (code is ahead of or contradicts docs)
| Doc | Drift |
|---|---|
| `AGENTS.md` (both repos, identical) | Describes OMP v1 ("MCP source proxies NOT bridged") — superseded by v2 code on `main` |
| `docs/omp-integration-gap.md` | "Остаток до полного" items 1–4 are already implemented (the same file's v2 section says so) |
| `packages/shared/src/agent/omp-agent.ts` header | Same stale v1 claim as AGENTS.md |
| `packages/shared/CLAUDE.md` | References `mcp/proxy-tool-name.ts`, which exists upstream but not in this repo (logic inlined in `mcp-pool.ts`) |
| `README.md` | Upstream Craft README: install instructions/links point at craft.do infra; "21-step" CLI validation is now 40 steps; no mention of Rox surfaces |
| `docs/cli.md` | Clone URL `github.com/anthropics/craft-agents.git` (wrong repo) |
| Root `package.json` | `server:dev:webui` sets unused `CRAFT_WEBUI_PORT`; `marketing:*`/`docs:dev` scripts point at apps absent from the repo |
| `docs/omp-rpc-notes.md` | Pinned to omp 17.2.9; toolchain installs 17.2.10 (probe showed no contract change, but the pin should track the manifest) |

### 6.3 Environment/bootstrap notes for future agents
- No `.cursor/environment.json` in the repo; a Cloud VM needs manual Bun install (`curl -fsSL https://bun.sh/install | bash`) before `bun install`.
- The headless server auto-installs the full default-on toolchain (~15 tools incl. omp/node/python/ffmpeg, hundreds of MB) on first boot — expect that network/disk cost in CI-like environments; `config.toolchain.disabled` / `toolchain:setDisabled` RPC can trim it.
- `--validate-server` is a genuinely useful smoke harness; its LLM-dependent steps need any provider key (`$LLM_API_KEY` / `--api-key`) — with none, expect step 11+ to fail (and currently: hang, §3.1).
