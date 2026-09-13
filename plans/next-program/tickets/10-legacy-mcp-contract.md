# 10 — Contract leftover MCP servers

**What to build:** Packaged builds stop staging `session-mcp-server` and `bridge-mcp-server` once no driver reads those paths. `McpPoolServer` stays as the documented seam for a future external-subprocess backend, or is deleted if product confirms no such backend.

**Blocked by:** None — can start immediately. Wide refactor: expand (stop reading paths) → contract (stop staging) → delete.

**Status:** ready-for-agent

- [ ] Classification in `docs/mcp-components.md` matches the tree after the change
- [ ] anthropic/pi/omp sessions still get pool proxy tools
- [ ] Electron package size no longer includes the unused staged servers, or a written KEEP reason exists
