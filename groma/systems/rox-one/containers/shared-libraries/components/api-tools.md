---
type: C4 Component
title: Api tools
status: stable
groma:
  id: api-tools
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/sources/api-tools.ts
    - scanner: typescript
      file: packages/shared/src/sources/source-stats.ts
    - scanner: typescript
      file: packages/shared/src/sources/builtin-mcp-installer.ts
    - scanner: typescript
      file: packages/shared/src/sources/builtin-sources.ts
    - scanner: typescript
      file: packages/shared/src/sources/builtin-permissions.ts
    - scanner: typescript
      file: packages/shared/src/sources/builtin-mcp.ts
    - scanner: typescript
      file: packages/shared/src/sources/server-builder.ts
    - scanner: typescript
      file: packages/shared/src/sources/storage.ts
    - scanner: typescript
      file: packages/shared/src/sources/index.ts
    - scanner: typescript
      file: packages/shared/src/sources/e2b-tools.ts
    - scanner: typescript
      file: packages/shared/src/sources/credential-manager.ts
    - scanner: typescript
      file: packages/shared/src/sources/builtin-mcp-qmd.ts
    - scanner: typescript
      file: packages/shared/src/sources/local-default-migration.ts
      symbol: updateRegularSourceFile
    - scanner: typescript
      file: packages/shared/src/sources/token-refresh-manager.ts
    - scanner: typescript
      file: packages/shared/src/sources/types.ts
    - scanner: typescript
      file: packages/shared/src/sources/default-microservices.ts
  technology: MCP
description: Creates a per-API MCP tool that forwards arbitrary path, method and params requests with auto-injected authentication.
---
