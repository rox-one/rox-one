# Repo known issues (non-blocking)

Small hygiene items found by the 2026-08-12 integration audit. Listed here because the owning files are code-owned and out of scope for doc-only cleanups.

## Root `package.json` dead knobs

`marketing:*` and `docs:dev` scripts, and the unused `CRAFT_WEBUI_PORT=3100` knob on `server:dev:webui`, were removed (ticket 08). Leftover `workspaces` exclusions `"!apps/online-docs"` / `"!apps/marketing"` were removed (ticket 16).

## Stale code comment (owned by another workstream)

- `packages/shared/src/agent/omp-agent.ts` header comment (~line 41) still says MCP source-proxy tools are "NOT bridged in v1", contradicted by the v2 G1 implementation in the same file (`registerHostTools()` → `buildSessionToolDefs({ includePoolProxyDefs: true })`, line ~1054). Tracked in the integration audit; fix assigned to the code-owning subagent. *(Fixed on the integration branch by subagent A, commit fcf4da70.)*

## Headless server operational constraints (verified 2026-08-12 by integration reviewer R1)

| Constraint | Behavior | Evidence |
|---|---|---|
| `ROX_SERVER_TOKEN` / `CRAFT_SERVER_TOKEN` minimum length | Tokens shorter than 16 chars are **fatal at boot** (startup throws) — deliberate hardening, but breaks naive copy-paste runbooks using short tokens | `packages/server-core/src/bootstrap/headless-start.ts` `validateTokenEntropy` (`token.length < MIN_TOKEN_LENGTH` → error at startup); use `bun run packages/server/src/index.ts --generate-token` |
| Config-dir single-instance lock | A second server booted against the same `ROX_CONFIG_DIR` / `CRAFT_CONFIG_DIR` refuses to start (`Another server instance is already running (PID …)`); scripted restarts must stop the old process first or use a separate config dir | `packages/server-core/src/bootstrap/lock-identity.ts`; observed live: second instance rejected while the first held `~/.craft-agent` |

Documented in `docs/cli.md` (Connection Options + Troubleshooting) and the README Remote Server section.
