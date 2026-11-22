---
type: C4 Component
title: Bootstrap
status: stable
groma:
  id: memory-bootstrap
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/memory/bootstrap.ts
    - scanner: typescript
      file: packages/server-core/src/memory/MemoryIndexService.ts
    - scanner: typescript
      file: packages/server-core/src/memory/AuditLog.ts
    - scanner: typescript
      file: packages/server-core/src/memory/WikiClaimStore.ts
    - scanner: typescript
      file: packages/server-core/src/memory/SkillPendingQueue.ts
    - scanner: typescript
      file: packages/server-core/src/memory/fts-index.ts
    - scanner: typescript
      file: packages/server-core/src/memory/skill-usage.ts
    - scanner: typescript
      file: packages/server-core/src/memory/provenance.ts
    - scanner: typescript
      file: packages/server-core/src/memory/episodic-memory.ts
    - scanner: typescript
      file: packages/server-core/src/memory/flush-turn.ts
    - scanner: typescript
      file: packages/server-core/src/memory/MemoryService.ts
    - scanner: typescript
      file: packages/server-core/src/memory/lesson-graph.ts
    - scanner: typescript
      file: packages/server-core/src/memory/StandingIntentStore.ts
    - scanner: typescript
      file: packages/server-core/src/memory/MemoryFileStore.ts
    - scanner: typescript
      file: packages/server-core/src/memory/tool-callbacks.ts
    - scanner: typescript
      file: packages/server-core/src/memory/LessonStore.ts
    - scanner: typescript
      file: packages/server-core/src/memory/forget.ts
    - scanner: typescript
      file: packages/server-core/src/memory/wiki-lint.ts
    - scanner: typescript
      file: packages/server-core/src/memory/provenance-gate.ts
    - scanner: typescript
      file: packages/server-core/src/memory/chunk-index.ts
    - scanner: typescript
      file: packages/server-core/src/memory/decay.ts
    - scanner: typescript
      file: packages/server-core/src/memory/approve-memory-proposal.ts
    - scanner: typescript
      file: packages/server-core/src/memory/MemoryProposalStore.ts
      symbol: MemoryProposalStore
description: Assembles the provenance-gated curated-memory prompt block within a byte budget.
---
