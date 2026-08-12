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
| 3.1 | OMP backend (`OmpAgent`) | **VERIFIED (protocol) / PARTIAL (turn E2E on clean host)** | Full v2 implementation (G1–G4) matches docs; RPC handshake verified live against omp 17.2.10; no dedicated unit tests; spawn-failure hang bug without credentials |
| 3.2 | Agent runtime controls | **FUNCTIONAL** (mode flip respawn VERIFIED in code+tests) | Modes/thinking/model switching complete for all 3 backends |
| 3.3 | Notes / PKM / Knowledge (SiYuan) | **PARTIAL** | Large implemented core + UI; requires external SiYuan kernel; several phases branch-only |
| 3.4 | Sources / MCP | **FUNCTIONAL** (list/config VERIFIED via CLI steps) | Mature upstream-derived system, full backend parity incl. OMP proxies |
| 3.5 | Secrets / Infisical / toolchain / marketplace | **VERIFIED (toolchain) / STUB (Infisical as secrets backend)** | Toolchain auto-install verified live; Infisical is only an opt-in CLI download, not a secrets integration |
| 3.6 | Session collections & views | **FUNCTIONAL** | Collections/table/board/multi-select landed on main with tests |
| 3.7 | Remote sessions / cloud | **VERIFIED (server+webui+CLI+share API) / PARTIAL (cloud-gateway, modal, iOS)** | Headless server + webui + viewer prod API live; gateways/iOS immature |
| 3.8 | Artifact / design surfaces | **FUNCTIONAL** (dashboard.html = STUB/orphan) | Rich chat artifact rendering; no standalone design canvas |
| 3.9 | White-label / Rox branding / unified shell | **PARTIAL** | Branding layer + Rox Connect + shell scaffolding on main; deep Craft identifiers remain |

Top cross-cutting risks: (1) fresh-install default connection cannot produce a turn without out-of-band `~/.omp` credentials, and the failure mode is a **silent hang**; (2) product docs drift from code in several load-bearing places (§4, §6); (3) the private website repo is a hard dependency for Connect/billing and cannot be audited from here.

---

## 1. Repository relationships

- `rox-one/rox-one` `main` **HEAD == `agisota/craft-agents-oss` `main` HEAD** (`5797f431`). The "donor" is the same code line; treating agisota as legacy means its 7 residual branches (`fix/sessions-*`, `fix/renderer-*`, `feat/shell-ext-activate2`, `fix/rox-connect-onboarding-followup`) are the only unique donor material, and all appear to be merged-PR leftovers (e.g. `fix/sessions-fr38-fr47` = merged PR #64).
- `rox-one/rox-one` carries ~87 branches; the significant **unmerged** series are `feat/knowledge-p1…p7`, `feat/knowledge-w2-knowledge-mode`, `feat/p4-siyuan-surfaces`, `feat/shell-w1…w6` + `feat/shell-plugin-feed`, `feat/runtime-context-finish`, `spec/knowledge-integration`, `spec/unified-shell`, `integration/2026-08-06-pr-bundle` (bulk port of upstream PRs #663–#1005 as `feature/pr-NNN-*`).
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
| CLI integration test | `bun run apps/cli/src/index.ts --validate-server --url ws://127.0.0.1:9100 --token …` | Steps 1–10/40 **pass** (handshake, credentials health, versions, homeDir, workspaces, sessions, connections list, sources list, session create, getMessages). Step 11 `send message + stream` **times out after 60 s** — see OMP finding §3.1.9 |
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

> Placeholders in this section are filled in from the detailed sub-audits; every surface records: implementation files, UI entry point, backend/API, persistence, auth, runtime dependency, test coverage, actual runnable status, missing work.

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
<!-- SECTION 3.2 RUNTIME CONTROLS -->
<!-- SECTION 3.3 KNOWLEDGE -->
<!-- SECTION 3.4 SOURCES -->
<!-- SECTION 3.5 TOOLCHAIN -->
<!-- SECTION 3.6 COLLECTIONS -->
<!-- SECTION 3.7 REMOTE -->
<!-- SECTION 3.8 ARTIFACTS -->
<!-- SECTION 3.9 WHITELABEL -->

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

### 6.1 Functional risks
1. **Fresh-install first turn fails silently (OMP hang)** — §3.1. The default seeded connection targets a runtime whose credentials (`~/.omp/agent/config.yml`) no repo component provisions, and the failure path hangs the turn instead of erroring. This blocks the primary "install → chat" happy path everywhere the Rox gateway config isn't pre-provisioned.
2. **Private-website coupling** — Rox Connect (`ROX_CLOUD_REQUIRED` default true per `docs/ROX_CLOUD_CONNECT.md`) gates the desktop app on `rox.one` device APIs owned by the inaccessible `rox-one-website` repo; no mock/dev server exists in this repo (only `ROX_CLOUD_REQUIRED=0` bypass).
3. **Port pipeline debt** — 80+ `feature/pr-NNN-*` port branches and the knowledge/shell series sit unmerged; several donor branches are superseded-but-not-triaged (§5.4).

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
