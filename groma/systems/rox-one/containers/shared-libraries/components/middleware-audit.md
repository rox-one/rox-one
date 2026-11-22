---
type: C4 Component
title: Audit
status: stable
groma:
  id: middleware-audit
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/commands/middleware/audit.ts
    - scanner: typescript
      file: packages/core/src/commands/middleware/index.ts
    - scanner: typescript
      file: packages/core/src/commands/middleware/ratelimit.ts
    - scanner: typescript
      file: packages/core/src/commands/middleware/policy.ts
description: Writes the audit row at every terminal agent governance decision as the outermost command middleware.
---
