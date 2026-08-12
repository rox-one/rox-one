# MCP Components — Lifecycle Classification

Audit of every MCP-flavored component in the repo: who spawns/loads it, under
which backend flags, and its resulting lifecycle class. Classes:

- **ACTIVE** — reachable and exercised on a current runtime path.
- **COMPATIBILITY** — live code path retained for backward/forward compat;
  executes only for specific (declared) configurations.
- **LEGACY** — still built/staged/resolved, but no registered backend or
  runtime caller reaches it. Kept intentionally; do not extend.
- **DEAD** — unreferenced (none found in this audit).

Backend registry context: `AgentProvider = 'anthropic' | 'pi' | 'omp'`
(`packages/shared/src/agent/backend/factory.ts` — `BACKEND_CAPABILITIES`),
drivers in `packages/shared/src/agent/backend/internal/drivers/{anthropic,pi,omp}.ts`.
Codex/Copilot backends are gone from the tree; their MCP artifacts remain.

## ACTIVE

### `packages/shared/src/mcp/client.ts` — `CraftMcpClient`
Single client wrapper around `@modelcontextprotocol/sdk` transports:
Streamable HTTP, legacy SSE (since the truthful-SSE fix), stdio.
- Loaded by: `McpClientPool.connect` (`mcp/mcp-pool.ts`),
  `validateMcpConnection`/`validateStdioMcpConnection` (`mcp/validation.ts`),
  `sources:getMcpTools` handler (`packages/server-core/src/handlers/rpc/sources.ts`).

**SSRF / credential policy (enforced here):**
- **No cross-origin redirect follows.** Both remote transports get a guarded
  fetch (`mcp/guarded-fetch.ts`, `createMcpGuardedFetch`) that forces
  `redirect: 'manual'` and re-follows only same-origin redirects (fetch-spec
  method semantics: 303 → GET, 301/302 → GET for non-GET/HEAD, 307/308
  preserve; capped at 5 hops). A cross-origin redirect target is never
  requested and raises a typed `McpRedirectError`. Rationale: the SDK default
  (`redirect: 'follow'`) lets a hostile/compromised MCP endpoint 302 the
  main/desktop process onto internal targets (cloud metadata, intranet).
  Same-origin allowance keeps legitimate reverse-proxy/trailing-slash
  redirects working — the SDK itself has no internal redirect handling.
- **No credentialed URLs.** `http://user:pass@host` is rejected at save time
  (`McpSourceConfigSchema` in `config/validators.ts`); the client additionally
  strips userinfo defensively so hand-edited configs can't put credentials on
  the wire, and URL logging goes through `formatMcpUrlForLog`
  (origin + pathname only).
- **Stdio env blocklist.** Inherited `process.env` is filtered through
  `isBlockedEnvVar` (exact list + `ROX_SECRET_` prefix for secrets-runtime
  staging vars + `INFISICAL_TOKEN`); explicit source `config.env` entries
  still win (user intent). Duplicate list:
  `packages/session-tools-core/src/runtime/sandbox-env.ts`.

### `packages/shared/src/mcp/mcp-pool.ts` — `McpClientPool`
Owns all MCP source connections in the main process; backends receive proxy
tool defs (`mcp__{slug}__{tool}`) and route calls back through the pool.
- Created per session: `packages/server-core/src/sessions/SessionManager.ts`
  (`managed.mcpPool = new McpClientPool(...)`, all backends).
- Consumed by: PiAgent (`register_tools` frame), OmpAgent
  (`set_host_tools` / `host_tool_call`), ClaudeAgent (in-process SDK servers).

### `packages/shared/src/mcp/validation.ts`
Connection probes behind `source_test` / source settings "test" actions.
- Wired via `claude-context.ts` → session-tools-core `source_test` handler.

### `packages/pi-agent-server`
Subprocess entrypoint for the Pi backend.
- Spawned by: PiAgent via pi driver — `drivers/pi.ts` maps
  `resolvedPaths.piServerPath`; `pi-agent.ts` spawns `node <piServerPath>`.
- Path resolved in `backend/internal/runtime-resolver.ts` (`piServerPath`).

### OMP CLI integration (`omp --mode rpc`)
- Spawned by `OmpAgent` (`packages/shared/src/agent/omp-agent.ts`), binary from
  `OMP_CLI_PATH` env → toolchain → PATH (`toolchain-runtime.ts`).
- Craft session tools + MCP pool proxies bridged via `set_host_tools` /
  `host_tool_call` (see `docs/omp-rpc-notes.md`).

## COMPATIBILITY

### `McpPoolServer` — `packages/shared/src/mcp/pool-server.ts`
HTTP (Streamable HTTP, stateless) facade exposing pool-managed tools to
**external SDK subprocesses that cannot reach the in-process pool**
(Codex/Copilot-era design, per file header).
- Instantiated only in `SessionManager.ts` under
  `if (backendContext.capabilities.needsHttpPoolServer)`.
- `BACKEND_CAPABILITIES` sets `needsHttpPoolServer: false` for **all three**
  registered backends (anthropic/pi/omp) → the server is never started today.
- Kept as the designated seam for any future external-subprocess backend
  (flip the capability flag, `poolServerUrl` is already plumbed into
  `BackendConfig` / `applyBridgeUpdates`). Dormant, not dead.

## LEGACY

### `packages/session-mcp-server`
Standalone stdio MCP server (`--session-id --workspace-root --plans-folder`)
exposing craft session tools (SubmitPlan, source_oauth_trigger, …) to
backends that could not execute them in-process. Codex-era.
- Still built/staged: `scripts/build-server.ts`, `scripts/build/common.ts`,
  `scripts/build/stage-servers.ts`, `scripts/electron-build-*.ts`;
  staged into `resources/session-mcp-server/`.
- Path still resolved: `runtime-resolver.ts` → `sessionServerPath`.
- **No consumer**: the three drivers' `buildRuntime` never read
  `sessionServerPath`; nothing spawns the binary. Session tools are now
  executed in-process: Claude via SDK in-process MCP servers, Pi via
  `register_tools`, OMP via `set_host_tools`/`host_tool_call`.
- Doc comments referencing this architecture: `base-agent.ts`
  (`handleSessionMcpToolCompletion`), `session-tools-core/src/context.ts`,
  `session-tools-core/src/tool-defs.ts`.

### `apps/electron/resources/bridge-mcp-server/`
Committed pre-built bundle (`index.js`, "Usage: bridge-mcp-server --config
<path>") bridging API sources for Codex/Copilot. Listed in
`apps/electron/electron-builder.yml` and `scripts/build-server.ts`.
- Path still resolved: `runtime-resolver.ts` → `bridgeServerPath` — no
  consumer.
- `BaseAgent.applyBridgeUpdates()` is a documented no-op
  ("Override in Codex/Copilot"); no current backend overrides it.
  `SessionManager` still calls it on source changes (harmless no-op).
- Release-note archaeology: `resources/release-notes/0.4.4.md` mentions
  adding both servers to the OSS allow list.

## Notes

- `runtime-resolver.ts` keeps resolving `sessionServerPath`/`bridgeServerPath`
  for packaged-build layout parity; the fields are unread. Removing the
  resolution (not done here) is safe only together with the staging scripts.
- Nothing was deleted. If a Codex/Copilot-class backend is ever re-added,
  `McpPoolServer` + `session-mcp-server` + `bridge-mcp-server` are the pieces
  it was designed around.
