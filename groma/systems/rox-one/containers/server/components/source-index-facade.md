---
type: C4 Component
title: Source index facade
status: stable
groma:
  id: source-index-facade
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/sources/source-index-facade.ts
    - scanner: typescript
      file: packages/server-core/src/sources/default-session-sources.ts
      symbol: resolveDefaultSessionSources
    - scanner: typescript
      file: packages/server-core/src/sources/build-servers.ts
      symbol: buildServersFromSources
    - scanner: typescript
      file: packages/server-core/src/sources/builtin-mcp-startup.ts
    - scanner: typescript
      file: packages/server-core/src/sources/source-index.ts
    - scanner: typescript
      file: packages/server-core/src/sources/source-index-watch.ts
  technology: Rust sidecar
description: Selects TypeScript or Rust-sidecar source indexing, search and prompt retrieval.
---
