---
type: C4 Component
title: Runtime
status: stable
groma:
  id: dev-space-runtime
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/dev-space/runtime.ts
    - scanner: typescript
      file: packages/session-tools-core/src/dev-space/scope.ts
description: Registration seam letting devspace session tools read the Dev Space artifact store.
---
