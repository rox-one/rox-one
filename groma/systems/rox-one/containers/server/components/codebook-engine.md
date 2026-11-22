---
type: C4 Component
title: Engine
status: stable
groma:
  id: codebook-engine
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/playbooks/codebook/engine.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/codebook/index.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/codebook/runs.ts
description: Executes ordered script, agent and artifact notebook cells as a cancellable local run.
---
