---
type: C4 Component
title: Evaluator
status: stable
groma:
  id: auto-evaluator
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/labels/auto/evaluator.ts
    - scanner: typescript
      file: packages/shared/src/labels/auto/index.ts
    - scanner: typescript
      file: packages/shared/src/labels/auto/types.ts
      symbol: AutoLabelMatch
    - scanner: typescript
      file: packages/shared/src/labels/auto/normalize.ts
      symbol: normalizeValue
    - scanner: typescript
      file: packages/shared/src/labels/auto/validation.ts
description: Scans user messages with label regex rules, normalizes captured values and returns capped auto-label matches.
---
