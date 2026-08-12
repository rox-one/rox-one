# Repo known issues (non-blocking)

Small hygiene items found by the 2026-08-12 integration audit. Listed here because the owning files are code-owned and out of scope for doc-only cleanups.

## Root `package.json` dead knobs

| Location | Issue | Evidence |
|---|---|---|
| scripts `marketing:dev` / `marketing:build` / `marketing:preview` | Reference `apps/marketing/vite.config.ts`, but `apps/marketing` does not exist in this repo | `ls apps/` → `cli cloud-gateway electron ios modal-gateway viewer webui` only; the directory is also excluded in `workspaces` (`"!apps/marketing"`, package.json:21-22). Running any of these scripts fails with a missing-config error. |
| script `docs:dev` | Runs `cd apps/online-docs && npm install && npx mintlify dev`, but `apps/online-docs` does not exist | Same exclusion block (`"!apps/online-docs"`), directory physically absent. |
| script `server:dev:webui` | Sets `CRAFT_WEBUI_PORT=3100`, but **nothing reads `CRAFT_WEBUI_PORT`** | `grep -rn CRAFT_WEBUI_PORT packages apps scripts` → only hit is package.json itself. The webui is embedded on the RPC port (`CRAFT_RPC_PORT`, default `9100`, parsed in `packages/server-core/src/bootstrap/headless-start.ts:396`); the working knob in that script is `CRAFT_WEBUI_DIR=apps/webui/dist` (read in `packages/server/src/index.ts`). |

**Proposed fix (code-owned, not applied here):** delete the five dead scripts and the two stale `workspaces` exclusions, and drop `CRAFT_WEBUI_PORT=3100` from `server:dev:webui`.

## Stale code comment (owned by another workstream)

- `packages/shared/src/agent/omp-agent.ts` header comment (~line 41) still says MCP source-proxy tools are "NOT bridged in v1", contradicted by the v2 G1 implementation in the same file (`registerHostTools()` → `buildSessionToolDefs({ includePoolProxyDefs: true })`, line ~1054). Tracked in the integration audit; fix assigned to the code-owning subagent.
