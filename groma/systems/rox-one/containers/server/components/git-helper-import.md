---
type: C4 Component
title: Git helper import
status: stable
groma:
  id: git-helper-import
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/workgraph/git-helper-import.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/github-import.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/host-import-runners.ts
      symbol: HostImportRunners
    - scanner: typescript
      file: packages/server-core/src/workgraph/github-oauth-import.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/index.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/inspect-connection.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/connection-test.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/revalidation.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/github-vertical.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/infisical-import.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/create-grant.ts
    - scanner: typescript
      file: packages/server-core/src/workgraph/local-imports.ts
  technology: git
description: Previews and imports git credential-helper entries into the workgraph as connections.
---
