---
type: C4 Component
title: E2e container lifecycle
status: stable
groma:
  id: e2e-container-lifecycle
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/rovers-core/scripts/e2e-container-lifecycle.ts
    - scanner: typescript
      file: packages/rovers-core/scripts/e2e-engine-cache-isolation.ts
    - scanner: typescript
      file: packages/rovers-core/scripts/e2e-container-command.ts
description: Acceptance script exercising the full container lifecycle over the pinned socket through the authorization gate.
---
