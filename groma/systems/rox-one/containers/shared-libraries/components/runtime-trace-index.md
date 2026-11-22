---
type: C4 Component
title: Index
status: stable
groma:
  id: runtime-trace-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/runtime-trace/index.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/projector.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/correlation.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/types.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/legacy.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/fixture.ts
      symbol: createRuntimeTraceFixture
    - scanner: typescript
      file: packages/core/src/runtime-trace/metrics.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/coverage.ts
    - scanner: typescript
      file: packages/core/src/runtime-trace/validation.ts
description: Re-exports runtime trace types, validation, projection, correlation, metrics and coverage helpers.
---
