---
type: C4 Component
title: DreamCostTracker
status: stable
groma:
  id: dreamcosttracker
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/memory/repo/DreamCostTracker.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/MemoryRepoService.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/repo-import-parser.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/DreamRunner.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/RepoSourceProvider.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/notify.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/snapshots.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/MemoryRepoMaterializer.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/repo-watcher.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/DreamScheduler.ts
    - scanner: typescript
      file: packages/server-core/src/memory/repo/DreamNotesScanner.ts
description: Prices background memory-dream model calls in USD with per-bank daily ledgers.
---
