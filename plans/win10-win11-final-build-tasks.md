# Windows 10 / Windows 11 — Final Quality Build: Task & Subtask List

Branch: `win10-win11-final-build` (from `main` @ `f63294b`).
Repo: `rox-one/rox-one` (fork of `agisota/craft-agents-oss`, upstream `craft-ai-agents/craft-agents-oss`).
Target artifact: `apps/electron/release/Rox-x64.exe` (NSIS, per-user) running on Windows 10 22H2 and Windows 11 23H2+.

Conventions:
- Prefix in every header = workstream (`[WIN-BUILD]`, `[APP-ELECTRON]`, `[MOD-AGENT]`, `[MOD-SOURCES]`, `[MOD-KNOWLEDGE]`, `[MOD-COLLECTIONS]`, `[APP-WEBUI]`, `[APP-CLI]`, `[SRV-HEADLESS]`, `[CLOUD-SHARE]`, `[AUTH-CLOUD]`, `[UI-BRAND]`, `[NATIVE-RUST]`, `[OPS-TOOLCHAIN]`, `[APP-ONBOARD]`, `[INT]`, `[TEST]`).
- Refs point to the real codebase paths verified on this branch.
- Each task/subtask ends with Requirements / DoD / Verify.

Architecture baseline (verified locally):
- Monorepo, Bun + TypeScript ESM, `linker=hoisted` (`bunfig.toml`, `scripts/build/common.ts#installDependencies`).
- Primary app: `apps/electron/` (main / preload / renderer React 18 + Vite 6). Top nav `APP_NAV_DESTINATIONS` (`apps/electron/src/renderer/components/app-shell/nav-destinations.ts`): `sessions, notes, sources, skills, memory, tasks, projects, pages, automations, connections, settings`.
- Packaging: `apps/electron/electron-builder.yml` (`win.ns­is x64`, `artifactName Rox-${arch}.${ext}`, EBUSY workaround via `extraResources` for `vendor/bun/bun.exe` + `resources/bin/win32-x64`, SDK core + `claude-agent-sdk-binary` ~210MB, `@vscode/ripgrep`, WA/Discord workers).
- Web version EXISTS: `apps/webui/src/adapter/web-api.ts` reuses `CHANNEL_MAP` from `apps/electron/src/transport/channel-map`, overrides `LOCAL_ONLY` methods; served embedded by `packages/server/src/index.ts` on the RPC port. Share viewer: `apps/viewer/` (`agents.rox.one`). CLI: `apps/cli/src/index.ts`. Headless: `packages/server/` + `packages/server-core/`. Logic: `packages/shared/` (incl. `src/agent/omp-agent.ts` 2291 lines, NDJSON `omp --mode rpc`), `packages/core/`, `packages/ui/`, `packages/pi-agent-server/`, `packages/session-tools-core/`, `packages/cloud-runner/`, `packages/messaging-gateway|messaging-whatsapp-worker|messaging-discord-worker/`, `apps/cloud-gateway/`, `apps/modal-gateway/app.py`, `apps/ios/` (partial), `native/` Rust (`craft-protocol|index|rund|journal|exec`, `apps/craft-native`), toolchain (`packages/shared/src/toolchain/manifest-data.ts`: `omp@17.2.10`, `infisical` opt-in CLI only), `docs/ROX_CLOUD_CONNECT.md` (`ROX_AUTH_BASE_URL=https://rox.one`, `ROX_CLOUD_REQUIRED=true`, `ROX_CLIENT_ID=craft-agents-desktop`).
- No classic microservices. External deps: private `rox-one/rox-one-website` (device auth/cabinet/Neon), `api.rox.one` LLM gateway (`~/.omp/agent/config.yml`), `agents.rox.one` viewer/R2, `agents.craft.do/auth/callback` OAuth relay (still Craft-branded), user-installed SiYuan kernel `127.0.0.1:6806`.

---

## A. [WIN-BUILD] Windows packaging & installer

### [WIN-BUILD-01] Reproducible clean-VM Windows x64 build
Refs: `package.json#electron:build,electron:dist:win`, `scripts/build/common.ts#downloadBun (bun-v1.3.9 baseline),downloadUv (0.10.6),copySDK,verifySDKCopy,copyRipgrep,buildMcpServers,buildElectronApp`, `apps/electron/electron-builder.yml#win,nsis,files,extraResources`, `bunfig.toml`, `scripts/install-app.ps1`.
Requirements: Bun 1.3.x, Node 20, Python 3.11+, VS Build Tools C++ workload; `bun install --linker=hoisted` on Windows (avoids `.bun` symlink/esbuild traverse failures); cross-arch SDK binary fetched via platform build script.
DoD: `bun run electron:build` then `electron-builder --win --publish never` succeed on Win10 22H2 and Win11; `release/Rox-x64.exe` produced; staged `claude.exe` is a real file >50MB (not symlink); `vendor/bun/bun.exe`, `resources/bin/win32-x64/*`, WA/Discord `worker.cjs` present.
Verify: fresh VM snapshot → clone branch → `bun install --linker=hoisted` → `bun run electron:build` → `cd apps/electron; electron-builder --win --publish never` → archive console log + `release/` listing; fail on any EBUSY/verification error.

### [WIN-BUILD-02] NSIS install / upgrade / uninstall / PATH shim
Refs: `apps/electron/electron-builder.yml#nsis (oneClick, perMachine:false, deleteAppDataOnUninstall)`, `scripts/install-app.ps1` (manifest `latest.yml`, sha512, `craft-agents.cmd` shim in `%LOCALAPPDATA%\Craft Agents\bin`).
Requirements: per-user install under `%LOCALAPPDATA%\Programs\`; kill running app before upgrade; checksum-verify download; Start Menu shortcut; user-PATH shim.
DoD: install → upgrade → uninstall leaves no orphan process/dir (except documented user data); `craft-agents` works after terminal restart; installer filename `Rox-x64.exe` (fix stale `Craft-Agents-x64.exe` comment in yml).
Verify: install vN → install vN+1 → `craft-agents` launch → uninstall → assert processes/dirs gone, on Win10 and Win11; screenshot each dialog.

### [WIN-BUILD-03] Signing & SmartScreen story
Refs: `apps/electron/electron-builder.yml#win.icon,artifactName`, `scripts/release.ts`, `scripts/check-version.ts`.
Requirements: decide EV cert vs self-sign vs unsigned; timestamp; document Edge/Chrome SmartScreen text.
DoD: signed exe OR published unsigned-install SOP with screenshots; `latest.yml` version/sha512/size match the shipped exe.
Verify: download released exe on clean VM via Edge → photograph reputation prompt → install succeeds → version in app matches `latest.yml`.

### [WIN-BUILD-04] Bundled runtimes: Bun/uv/ripgrep/Python doc tools
Refs: `scripts/build/common.ts#BUN_VERSION,UV_VERSION`, `apps/electron/resources/bin/win32-x64/`, `apps/electron/resources/bin/*.cmd`, `apps/electron/resources/scripts/**/*`, `packages/server-core/src/services/search.ts` (ripgrep).
Requirements: win-x64 baseline binaries (no AVX2 requirement); `uv.exe`; `rg.exe` from `@vscode/ripgrep` postinstall; CRLF-safe `.cmd` wrappers (`markitdown,pdf-tool,xlsx-tool,doc-diff,img-tool,docx-tool,pptx-tool,ical-tool`).
DoD: offline launch shows Runtime page all-green; every doc tool executes from its packaged path.
Verify: disconnect network → launch → agent uses each doc tool once → outputs correct; `rg --version` works via in-app search.

## B. [APP-ELECTRON] Shell / main / preload / renderer

### [APP-ELECTRON-01] Main process boot, single instance, logging
Refs: `apps/electron/src/main/`, `apps/electron/dist/main.cjs`, `asar:false`, logs `%APPDATA%\@craft-agent\electron\logs\main.log`, `Rox.exe -- --debug`.
Requirements: no ASAR path assumptions; second instance focuses first window; no ERROR on clean boot.
DoD: cold boot <15s on HDD VM; single window on double-launch; debug flag streams verbose logs.
Verify: launch with `-- --debug` → inspect log → launch second instance → assert one window; attach log.

### [APP-ELECTRON-02] Preload / IPC allowlist parity
Refs: `apps/electron/src/preload/`, `apps/electron/src/transport/channel-map`, `scripts/check-raw-sends.sh`, `scripts/check-task-tool-checks.sh`, `package.json#lint:electron`.
Requirements: every renderer channel via preload bridge; no raw `send` bypass.
DoD: `bun run lint:ipc-sends`, `lint:tool-name-checks`, `lint:electron` green.
Verify: run full lint gate + click every rail destination with DevTools console open → zero IPC errors.

### [APP-ELECTRON-03] All renderer surfaces render on Win10/Win11
Refs: `nav-destinations.ts`, `AppShell.tsx`, `ActivityRail`, `MainContentPanel.tsx`, `SessionList.tsx`, `CollectionViewChrome`, `SessionTableHost.tsx`, `KanbanBoardContainer.tsx`.
Requirements: 1366x768 + 1920x1080, 100%/125%/150% scaling; RU default + EN fallback; no clipped text.
DoD: sessions/notes/sources/skills/memory/tasks/projects/pages/automations/connections/settings all open clean; list/board/table toggle works; no `manifest.json 401` / `notification:getEnabled` console errors (fix: serve manifest unauthenticated; stub channel in web adapter).
Verify: OS × resolution × scale matrix with screenshots; console-error-free pass required.

## C. [MOD-AGENT] Backends & runtime controls (P0 for ship)

### [MOD-AGENT-01] Fix OMP pre-ready exit hang
Refs: `packages/shared/src/agent/omp-agent.ts#spawnSubprocess,handleSubprocessExit,ensureSubprocess` (2291 lines), `packages/shared/src/toolchain-runtime.ts#resolveOmpExecutableOrExplain`, `docs/omp-rpc-notes.md`, `docs/omp-integration-gap.md`.
Requirements: reject the ready promise from `handleSubprocessExit`; surface omp stderr (`No models available… code=1`) as typed error + auth prompt; 20s ready-timeout must always settle.
DoD: credential-less host shows actionable error <25s; no `StaleSecurity stuck in processing 120s+`; no silent hang in CLI `send` nor browser chat.
Verify: rename `~/.omp` → send message → error card with gateway setup appears → restore config → streamed turn works; add unit test with mocked early-exit (`bun test packages/shared/src/agent`).

### [MOD-AGENT-02] First-run credential story for default `rox-kimi`
Refs: `packages/shared/src/config/storage.ts#seedDefaultLlmConnection (providerType omp, authType none)`, `packages/shared/src/agent/omp-first-run.ts#buildOmpSpawnCredentialEnv,ensureOmpRoxFirstRun`, `apps/electron/.../onboarding/ProviderSelectStep.tsx,useOnboarding.ts`.
Requirements: detect missing `~/.omp/agent/config.yml`; offer `ROX_API_KEY` env or gateway login; document `ROX_CLOUD_REQUIRED=0` dev bypass.
DoD: fresh `%USERPROFILE%\.craft-agent` + fresh `~/.omp` ends in explicit needs-key state, never fake-ready chat.
Verify: wipe both dirs → launch → onboarding → attempt chat → guided error → add key → successful streamed turn on Win11.

### [MOD-AGENT-03] Modes / thinking / model / steer / abort parity
Refs: `packages/shared/src/agent/mode-manager.ts,mode-types.ts,thinking-levels.ts,permissions-config.ts`, `packages/server-core/.../SessionManager.ts#setSessionPermissionMode,updateSessionModel,cancelProcessing`, `FreeFormInput.tsx#CompactPermissionModeSelector,CompactModelSelector`, `Shift+Tab` cycle; `agent/options.ts:buildClaudeSubprocessEnv` (`CLAUDE_CODE_GIT_BASH_PATH` on Windows, #935).
Requirements: `safe/ask/allow-all`; thinking `off…max`; live model switch on claude/pi/omp; OMP respawn across allow-all boundary documented; Git Bash path honored on Windows.
DoD: mode persists to JSONL header + workspace defaults; abort stops stream <3s; steer semantics per backend documented.
Verify: 3 backends × 3 modes matrix (write blocked in safe, prompt in ask, auto in allow-all); agent test suites green.

### [MOD-AGENT-04] `queryLlm` contract & attachment limits
Refs: `packages/shared/src/agent/llm-tool.ts#buildCallLlmRequest`, `packages/shared/CLAUDE.md#queryLlm backend contract`, `packages/shared/src/agent/__tests__/pi-query-llm.test.ts`, `omp-agent.ts#runMiniCompletion,queryLlm`.
Requirements: honor `model/systemPrompt`; SHOULD honor `outputSchema`; MAY honor `maxTokens/temperature`; MUST NOT fabricate `model`; full `LLMQueryRequest` over IPC.
DoD: effective model truthfully reported; image-attachment limitation explicit (text-flattened with notice).
Verify: `queryLlm({model,maxTokens})` metadata matches request; image send → renders or warns, no crash.

## D. [MOD-SOURCES] Sources / MCP / OAuth on Windows

### [MOD-SOURCES-01] stdio MCP on Windows
Refs: `packages/shared/src/mcp/client.ts,mcp-pool.ts,proxy-tool-name.ts#proxyToolName`, `packages/shared/src/sources/*`, `server-builder.ts`, `session-tool-defs.ts#buildSessionToolDefs`.
Requirements: `.cmd` resolution, quoting, `env` passthrough, `localMcpServers.enabled` gate, single `proxyToolName` builder everywhere (#864/#498).
DoD: `npx`- and `*.cmd`-based servers connect; `sources:getMcpTools` expands platform vars; proxy dispatch key never drifts.
Verify: add both server kinds → list tools → invoke tool → result renders; seeded `notes,exa,firecrawl` visible via `sources:get`.

### [MOD-SOURCES-02] OAuth providers + relay
Refs: `packages/shared/src/auth/*-oauth.ts`, `packages/shared/CLAUDE.md#WebUI source OAuth relay (thecraftagents.com/auth/callback)`, `.env.example#GOOGLE/SLACK/MICROSOFT_OAUTH`, webui `/api/oauth/callback`.
Requirements: Web-application OAuth client with hosted callback; token auto-refresh (OAuth + `api.renewEndpoint` via `TokenRefreshManager`); secrets only in `credentials.enc`.
DoD: Google/Slack/Microsoft connect, survive restart via refresh; relay rebranded or replaced if leaving craft.do.
Verify: connect all three → read data → restart → still connected (refresh exercised).

### [MOD-SOURCES-03] SSE transport decision
Refs: `packages/shared/src/mcp/validation.ts`, `StreamableHTTPClientTransport`.
Requirements: implement legacy SSE or reject `transport:sse` with clear message.
DoD: no silent coerce-to-HTTP failure.
Verify: point at pure-SSE server → tools list OR explicit unsupported error with log line.

## E. [MOD-KNOWLEDGE] Notes / SiYuan / Knowledge

### [MOD-KNOWLEDGE-01] Windows SiYuan kernel + write-back
Refs: `packages/core/src/knowledge/providers/siyuan/*`, `packages/server-core/src/knowledge/bridge-service.ts`, `KnowledgeHome,KnowledgeNotebookTree,KnowledgeDiff,KnowledgeAgentPanel`, `CRAFT_FEATURE_KNOWLEDGE`.
Requirements: default `http://127.0.0.1:6806`; token in CredentialManager; write whitelist only; Windows Firewall prompt documented; content stays in SiYuan, registry in `~/.craft-agent/knowledge/connections.json`.
DoD: search/read/backlinks/propose/approve/apply work; `safe` denies propose; `audit.jsonl` + snapshots written.
Verify: install SiYuan Windows → connect → search → propose → approve → block updated; knowledge test suites green.

### [MOD-KNOWLEDGE-02] Navigator tree / agent CTAs / skills contract
Refs: `KnowledgeNotebookTree.tsx` (static-empty stub), `KnowledgeAgentPanel.tsx` (disabled CTAs), `apps/electron/resources/skills/craft-knowledge/*` (`requiredSources:[siyuan]`, `alwaysAllow: knowledge.search/read/get_backlinks` with no such session tools).
Requirements: notebook-list RPC; wire ask/open-session CTAs; implement `knowledge.*` session tools or remove skill claims.
DoD: zero dead buttons; `@`-mention search works or skill hidden with reason.
Verify: click every Knowledge CTA → real action; `@siyuan` triggers search.

## F. [MOD-COLLECTIONS] Sessions collections & views

### [MOD-COLLECTIONS-01] Filters persistence / list drag / bulk UI dedupe
Refs: `packages/shared/src/sessions/collection-*.ts,lexorank.ts`, `SessionManager.ts#setPriority,setDueDate,setRank,reorderRank`, `collection-display.ts,collection-filters.ts`, `CollectionBulkBar.tsx` vs legacy `MultiSelectPanel`, `matchesLabelFilter` single predicate (`packages/shared/CLAUDE.md`), TASK labels via `applyTaskLabel` only.
Requirements: persist `CollectionFilters` per navigator; wire list-view LexoRank drag; one bulk bar; `groupBy` unifies legacy grouping; bulk max 200, rank excluded.
DoD: filters survive restart/switch; drag reorders in list/board/table; TASK-label flow intact.
Verify: set filter → restart → kept; drag card → order persists; 50-session bulk label/status OK.

## G. [APP-WEBUI] Web UI on Windows

### [APP-WEBUI-01] Serve, auth, adapter parity, rebrand
Refs: `apps/webui/src/adapter/web-api.ts#CHANNEL_MAP,LOCAL_ONLY overrides,notification:getEnabled`, `packages/server/src/index.ts#/api/auth,/api/config`, `CRAFT_SERVER_TOKEN,CRAFT_WEBUI_DIR,CRAFT_BUNDLED_ASSETS_ROOT` (dead knob `CRAFT_WEBUI_PORT`), `scripts/generate-dev-cert.sh`.
Requirements: `bun run server:prod`; argon2id/JWT cookie; `LOCAL_ONLY` stubs; `login.html` Rox + RU-first.
DoD: `http://127.0.0.1:9100/` → login → full SPA parity; no manifest/auth console errors; LAN `wss://` with self-signed cert works.
Verify: Edge/Chrome Win11 → login with token → new chat → all settings pages open; webui tests green.

## H. [APP-CLI] CLI on Windows

### [APP-CLI-01] Full CLI flow + `run` + `--validate-server`
Refs: `apps/cli/src/index.ts` (`ping/health/versions/workspaces/sessions/connections/sources/session/send/cancel/invoke/listen/run`), `run --provider --model --api-key --base-url --workspace-dir --source`.
Requirements: `cmd`/`pwsh` compatible; `--tls-ca` for self-signed; stdin pipes.
DoD: all commands pass; validate 40/40 with valid LLM key (fix `docs/cli.md` 21-step drift).
Verify: `--validate-server --url ws://127.0.0.1:9100 --token …` green; `run "Summarize README"` streams and exits.

## I. [SRV-HEADLESS] Headless server on Windows

### [SRV-HEADLESS-01] Boot / token / lock / TLS / health
Refs: `packages/server/src/index.ts`, `server-core/src/bootstrap/headless-start.ts`, `CRAFT_SERVER_TOKEN(>=16),CRAFT_CONFIG_DIR,CRAFT_RPC_HOST/PORT/TLS_*`, `Dockerfile.server`.
Requirements: refuse non-localhost without TLS; second process on same config dir rejected; seeding (`rox-kimi`, 5 skill packs, `soul.md/rules.md`, toolchain) observed.
DoD: WS + webui on same port; `POST /api/auth` → cookie; unauth `/` → 302 `/login`.
Verify: start with generated token → curl probes + CLI `ping` OK; `0.0.0.0` without TLS → designed fatal.

## J. [CLOUD-SHARE] Viewer share / Cloud Runs / messaging (Windows client)

### [CLOUD-SHARE-01] Share Online hardening + UX
Refs: `apps/viewer/`, `packages/shared/src/branding.ts#VIEWER_URL=https://agents.rox.one`, share `POST/GET/PUT/DELETE /s/api/:id` (R2 `craft-session-shares`, 25MB cap), `RELEASE_NOTES_0.11.5.md`.
Requirements: close unauthenticated write/delete gap (auth or unguessable IDs + rate limits) or document + gate; viewer header Craft → Rox.
DoD: link opens in Edge InPrivate; revoke → 404; no secret leakage in shared JSON.
Verify: share → open `/s/<id>` → matches → delete → 404; header reads Rox.

### [CLOUD-SHARE-02] Cloud Runs: local on Windows, cloud optional
Refs: `packages/cloud-runner/` (`LocalSubprocessProvider`, `stub-runner.js` via `scripts/build/common.ts#copyCloudRunner`), `apps/cloud-gateway/` (CF Worker/DO), `apps/modal-gateway/app.py`, `cloudRuns:*` RPC, `cloud-runs.env`.
Requirements: local runner via bundled bun; cloud legs need `CLOUD_RUNS_TOKEN,LLM_BASE_URL/KEY/MODEL`.
DoD: local run completes with artifacts/share/import/aggregate.
Verify: queue local run → artifacts saved → share/import round-trip; runner tests green.

### [CLOUD-SHARE-03] Messaging workers with system node
Refs: `packages/messaging-gateway/`, `messaging-whatsapp-worker/` (Baileys), `messaging-discord-worker/`, `CRAFT_MESSAGING_NODE_BIN/WA_WORKER/DISCORD_WORKER`, per-workspace `messaging/`, automation `telegramTopic` via `TopicRegistry`.
Requirements: Windows Node path; pairing codes; WeChat unofficial-surface risk notice.
DoD: Telegram connect + round-trip; WA QR shown; Discord connects.
Verify: Telegram send/receive via agent; WA QR scan → round-trip (or documented skip with reason).

## K. [AUTH-CLOUD] Rox Cloud Connect on Windows

### [AUTH-CLOUD-01] Device flow or clean offline mode
Refs: `packages/shared/src/auth/rox-cloud.ts`, `docs/ROX_CLOUD_CONNECT.md`, `onboarding:startRoxConnect|getRoxCloudState|clearRoxCloud` (Electron-only `LOCAL_ONLY`), `service_oauth::global::rox-cloud`, `GET /api/me/balance` (currently no UI caller), private `rox-one/rox-one-website`.
Requirements: `POST {auth}/api/auth/device/start` → `verification_uri_complete` → poll → store; `ROX_CLOUD_REQUIRED=0` pure-engine bypass; rename `ROX_CLIENT_ID` once website accepts Rox id.
DoD: online → approve → `connected` → balance visible in UI; website-inaccessible → explicit blocked message, never hang.
Verify: `ROX_CLOUD_REQUIRED=1` gate → approve → proceeds; `=0` skips; without website access mark BLOCKED.

## L. [UI-BRAND] Branding / i18n / themes / artifacts

### [UI-BRAND-01] Finish Rox rename + i18n parity
Refs: `electron-builder.yml#appId:com.lukilabs.craft-agent,productName:Rox`, `craftagents://` alias, `~/.craft-agent`, `@craft-agent/*`, `CRAFT_*`, `RoxConnectStep.tsx` hardcoded English, `packages/shared/src/i18n/locales/*.json` (10 locales, `fallbackLng:[ru,en]`), `packages/shared/CLAUDE.md#i18n` (parity/sorted/coverage gates), `packages/shared/src/i18n/registry.ts`.
Requirements: appId/productName/deep-link/config-dir/npm-scope/env-prefix migration plan with data migration; every user string via `t()`; keys ASCII-sorted in all locales (`_one/_few/_many` RU rule).
DoD: `lint:i18n:parity/sorted/coverage` + i18n tests green; login RU-first; no user-visible Craft leftovers (relay host `agents.craft.do`, `thecraftagents.com` documented or replaced).
Verify: `rg "Craft Agent" apps/electron/src apps/webui/src packages/ui/src` → only history/comments; RU↔EN switch fully translated.

### [UI-BRAND-02] Themes + chat artifacts + orphan decision
Refs: `packages/shared/src/config/theme.ts`, `resources/themes/*.json`, `MarkdownHtmlBlock/MermaidBlock/DiffBlock`, `MindMapHost.tsx`, `mermaid-validate`, repo-root `dashboard.html` (orphan STUB, zero refs).
Requirements: 15 presets; sandboxed HTML iframe; `dashboard.html` deleted/moved/wired (decide, do not leave orphan).
DoD: HTML/mermaid/diff fullscreen overlays offline-capable; mindmap pins persist (FS + localStorage).
Verify: `html-preview`/`mermaid`/`diff` fences → previews; mindmap from session → pin → reopen OK.

## M. [NATIVE-RUST] Native crates

### [NATIVE-RUST-01] Rust workspace on Windows: build or descope
Refs: `native/Cargo.toml` (`craft-protocol|index|rund|journal|exec`, `apps/craft-native`), `native/rust-toolchain.toml (1.83)`.
Requirements: `cargo build --locked` on Win x64; document whether Electron loads it or standalone.
DoD: green build + `cargo test` pass, or explicit NOT_STARTED/descope note so it never blocks `bun install`.
Verify: `cargo test` log on Win11 attached, or descope record linked.

## N. [OPS-TOOLCHAIN] Toolchain / marketplace / runtime context

### [OPS-TOOLCHAIN-01] Toolchain waves + marketplace trust on Windows
Refs: `packages/shared/src/toolchain/*` (`TOOLCHAIN_INSTALL_COMPLETE_MARKER`, `dependsOn` waves, `System.IO.Compression` zip path on Windows), `manifest-data.ts` (omp npm tarball, `bin/omp` + `bin/omp.cmd`, infisical opt-in, `oh-my-openagent` blocked), `packages/shared/src/marketplace/*` (ed25519 + sha256, `~/.agents/skills`), context docs (`soul.md/rules.md`, `contextDocs:*`), `Settings → Runtime`.
Requirements: wave order (omp after bun+node); sha256 fail-closed; `state.json` + `config.json toolchain.disabled`; PowerShell extraction normalization.
DoD: first boot installs default-on set incl. `omp`; 57 toolchain + marketplace suites green; disabled tools stay disabled.
Verify: wipe `~/.craft-agent/toolchain` → boot → `omp --version` resolves → install marketplace pack → skills listed.

## O. [APP-ONBOARD] Onboarding & provider setup

### [APP-ONBOARD-01] Onboarding completes with every provider class
Refs: `ProviderSelectStep.tsx,useOnboarding.ts`, `AiSettingsPage.tsx`, `model-picker-helpers.ts`, `RuntimeSettingsPage.tsx`, `MarketplaceSettingsPage.tsx`, `KnowledgeSettingsPage.tsx`, `CloudRunsSettingsPage`, `AccountMenu`, Pi catalog `src/config/models-pi.ts`, `createBackend` + driver registry (`AGENTS.md#add provider`: validators → factory → BaseAgent subclass → UI group/label/preset).
Requirements: Anthropic key / Claude Max OAuth / Google AI Studio / ChatGPT Plus Codex OAuth / Copilot OAuth / custom OpenRouter / Vercel AI Gateway / Ollama `http://localhost:11434`; Windows proxy env honored (`getProxyEnvVars`).
DoD: each provider addable, per-workspace default settable, one streamed turn each.
Verify: add each → `ping` turn → reply; custom `baseUrl` works; `midStreamBehavior` via `resolveMidStreamBehavior` only (queue vs steer invariant held).

---

## P. [INT] Integration (cross-surface)

### [INT-01] Chat across 3 backends on Windows
Refs: `[MOD-AGENT-*]` + `[MOD-SOURCES-*]`. Requirements: real keys for claude/pi/omp-rox.
DoD: text turn + tool call + permission prompt + artifact render on EACH backend.
Verify: scripted `list files → edit file → source search → summarize` passes 3/3, logs attached.

### [INT-02] Sources → agent → knowledge → collections loop
Refs: `McpClientPool`, `buildSessionToolDefs`, `knowledge:*` RPC, `collection:*` RPC.
DoD: MCP result → knowledge publish → board card ranked.
Verify: GitHub MCP issue → publish note → board shows card with audit entry.

### [INT-03] Desktop ↔ headless ↔ webui ↔ CLI, same workspace
Refs: `[SRV-HEADLESS-01]` + `[APP-WEBUI-01]` + `[APP-CLI-01]`.
DoD: message created in one client visible in all others.
Verify: CLI create → webui reply → desktop read; `session messages` identical.

### [INT-04] Share → viewer → cloud-run import round-trip
Refs: `[CLOUD-SHARE-01/02]`.
DoD: shared session importable as cloud-run artifact with matching hash.
Verify: share → import → artifact sha256 equal.

### [INT-05] Offline-first (only LLM gateway allowed)
Refs: toolchain, themes, skills, SiYuan-local.
DoD: firewall blocks all except `api.rox.one` (+ gateway) → chat/knowledge/collections still work.
Verify: block egress except gateway → full smoke passes.

## Q. [TEST] Tests, gates, re-verification

### [TEST-01] Unit / typecheck / lint gates on Windows
Refs: `bun test`, `bun run typecheck:all`, `bun run lint`, `bun run rx:validate`, `bun run validate:dev|validate:ci`.
Requirements: run under `pwsh` on Win11; hoisted linker; per-package `tsc --noEmit`.
DoD: `typecheck:all`, `lint`, `rx:validate`, `test:shared:all,connection-fabric,config-isolation,doc-tools` green.
Verify: `bun run validate:dev` full log attached; zero failures.

### [TEST-02] E2E + perf budgets
Refs: `tests/e2e/meeting-agents/playwright.config.ts`, `test:meetings:unit:e2e:eval:live`, `test:perf-budgets`, `scripts/bench/renderer-perf-report.ts`.
Requirements: `ROX_MEETING_E2E_FIXTURE=1`; Chromium/Edge.
DoD: Playwright green; renderer perf CI thresholds met.
Verify: test report + perf report artifacts attached.

### [TEST-03] Manual UAT sign-off (Win10 + Win11)
Requirements: install → onboard (each provider class) → chat → MCP → knowledge publish → board drag → share link → webui login → CLI validate → uninstall.
DoD: matrix signed with screenshots + logs; every fail spawns a new `[WIN-BUILD|APP-*]` subtask; no ship with open P0.
Verify: completed UAT sheet attached to release.

### [TEST-04] Release hygiene
Refs: `scripts/check-version.ts,release.ts,build.ts`, `RELEASE_NOTES_0.11.5.md`, `publish:https://thecraftagents.com/electron/latest`.
Requirements: single version bump; `latest.yml` + sha512 published; `install-app.ps1/.sh` tested; `VIEWER_URL` DNS+TLS verified.
DoD: `irm install-app.ps1 | iex` on clean Win11 installs the released build; exe hash matches manifest.
Verify: clean-VM install from release URL succeeds; version in app equals manifest.
