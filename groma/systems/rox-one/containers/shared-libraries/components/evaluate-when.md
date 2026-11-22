---
type: C4 Component
title: Evaluate when
status: stable
groma:
  id: evaluate-when
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/context-keys/evaluate-when.ts
      symbol: evaluateWhen
    - scanner: typescript
      file: packages/core/src/platform/context-keys/service.ts
      symbol: createContextKeyService
    - scanner: typescript
      file: packages/core/src/platform/context-keys/types.ts
    - scanner: typescript
      file: packages/core/src/platform/context-keys/index.ts
description: Evaluates small when-expressions over context keys with comparisons, counters and boolean operators.
---
