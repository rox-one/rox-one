---
type: C4 Component
title: Index
status: stable
groma:
  id: automation-rules-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/automation/rules/index.ts
    - scanner: typescript
      file: packages/core/src/automation/rules/r2.ts
    - scanner: typescript
      file: packages/core/src/automation/rules/r3.ts
    - scanner: typescript
      file: packages/core/src/automation/rules/r4.ts
    - scanner: typescript
      file: packages/core/src/automation/rules/r1.ts
    - scanner: typescript
      file: packages/core/src/automation/rules/r5.ts
description: Registers the five ordered domain rules and resolves which rules trigger for a given event type.
---
