# Ticket 18 — one MCP proxy-name builder (inventory 6.5)

Date: 2026-08-13  
Branch: `rox/next-program-t18-proxy-name-7c33`

`packages/shared/CLAUDE.md` already required `proxyToolName(slug, name)` from `mcp/proxy-tool-name.ts`. The file was never ported. `mcp-pool.ts` kept a local sanitize + `` mcp__${} `` template; pool-server, permissions-config, and base-event-adapter invented the same prefix. Dispatch keys drifted in #864 (regression of #498).

## What landed

- `packages/shared/src/mcp/proxy-tool-name.ts` is the single builder
- `mcp-pool.ts`, `pool-server.ts`, `permissions-config.ts`, `base-event-adapter.ts` import it
- Source-scan test fails if any of those files grows a local `sanitizeToolNamePart` / `` mcp__${ `` template
- Collision behavior stays `_2`, `_3`, … (the live `mcp-pool` tests). CLAUDE.md no longer claims keep-first + warn

## Tests

- RED: `Cannot find module '../proxy-tool-name.ts'`
- GREEN: `packages/shared/src/mcp/__tests__/proxy-tool-name.test.ts`
- Existing `packages/shared/tests/mcp-pool.test.ts` proxy-name cases stay green
