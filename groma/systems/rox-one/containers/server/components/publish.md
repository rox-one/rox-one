---
type: C4 Component
title: Publish
status: stable
groma:
  id: publish
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/devspace/stages/publish.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/stages/structural.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/stages/llm.ts
description: Publishes Dev Space wiki, understanding and C4 artifacts into Notes without overwriting user edits.
---
