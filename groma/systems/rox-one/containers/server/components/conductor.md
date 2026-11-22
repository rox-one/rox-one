---
type: C4 Component
title: Conductor
status: stable
groma:
  id: conductor
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/conductor.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/privacy.ts
      symbol: sanitizeRuntimeTrace
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/delegation-compat.fixture.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/journal.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/service.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-trace/cancellation.fixture.ts
description: Projects task-spec nodes into runtime-trace tasks with dependencies and acceptance criteria.
---
