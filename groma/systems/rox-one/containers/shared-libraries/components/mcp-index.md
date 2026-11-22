---
type: C4 Component
title: Index
status: stable
groma:
  id: mcp-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/mcp/index.ts
    - scanner: typescript
      file: packages/shared/src/mcp/pool-server.ts
      symbol: McpPoolServer
    - scanner: typescript
      file: packages/shared/src/mcp/client.ts
    - scanner: typescript
      file: packages/shared/src/mcp/guarded-fetch.ts
    - scanner: typescript
      file: packages/shared/src/mcp/api-source-pool-client.ts
      symbol: ApiSourcePoolClient
    - scanner: typescript
      file: packages/shared/src/mcp/mcp-pool.ts
    - scanner: typescript
      file: packages/shared/src/mcp/proxy-tool-name.ts
    - scanner: typescript
      file: packages/shared/src/mcp/validation.ts
description: Re-exports the MCP client, guarded fetch, connection pool, pool server and proxy-tool-name helpers.
---
