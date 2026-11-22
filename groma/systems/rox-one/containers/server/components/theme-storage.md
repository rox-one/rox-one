---
type: C4 Component
title: Theme storage
status: stable
groma:
  id: theme-storage
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/webui/theme-storage.ts
    - scanner: typescript
      file: packages/server-core/src/webui/static-file.ts
      symbol: resolveWebuiFile
    - scanner: typescript
      file: packages/server-core/src/webui/media-ticket.ts
    - scanner: typescript
      file: packages/server-core/src/webui/appearance-rpc.ts
    - scanner: typescript
      file: packages/server-core/src/webui/csp.ts
    - scanner: typescript
      file: packages/server-core/src/webui/node-adapter.ts
      symbol: nodeHttpAdapter
    - scanner: typescript
      file: packages/server-core/src/webui/auth.ts
    - scanner: typescript
      file: packages/server-core/src/webui/cloud-handoff-broker.ts
    - scanner: typescript
      file: packages/server-core/src/webui/index.ts
    - scanner: typescript
      file: packages/server-core/src/webui/http-server.ts
description: Loads validated preset themes and the bound default workspace for the web UI.
---
