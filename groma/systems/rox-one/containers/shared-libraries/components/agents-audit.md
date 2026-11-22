---
type: C4 Component
title: Audit
status: stable
groma:
  id: agents-audit
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/agents/audit.ts
    - scanner: typescript
      file: packages/core/src/agents/risk.ts
    - scanner: typescript
      file: packages/core/src/agents/index.ts
    - scanner: typescript
      file: packages/core/src/agents/governance.ts
    - scanner: typescript
      file: packages/core/src/agents/policy.ts
description: Builds append-only, hash-chained audit rows for every terminal agent policy decision, verifiable across stores.
---
