---
type: C4 Component
title: Rule
status: stable
groma:
  id: rule
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/automation/rule.ts
    - scanner: typescript
      file: packages/core/src/automation/index.ts
    - scanner: typescript
      file: packages/core/src/automation/ids.ts
    - scanner: typescript
      file: packages/core/src/automation/events.ts
    - scanner: typescript
      file: packages/core/src/automation/execution.ts
description: 'Defines the domain rule engine contract: triggers, conditions, idempotency keys and ordered command steps.'
---
